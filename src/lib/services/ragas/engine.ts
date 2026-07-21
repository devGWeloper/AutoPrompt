import type { RagasMetric } from "@/lib/types";
import { chatJson, cosine, embed, embeddingConfigured } from "./llmClient";

// LLM-judge RAGAS engine (OpenAI-compatible). Reimplements the RAGAS metrics as
// direct LLM/embedding calls since the Python `ragas` library can't run in Node.
// These are faithful approximations of RAGAS's definitions, one case at a time.
// Any metric that needs context / ground_truth it doesn't have returns null.

export type CaseScore = Partial<Record<RagasMetric, number | null>>;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

interface Fields {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string | null;
}

/** faithfulness — fraction of the answer's atomic claims supported by context. */
async function faithfulness(f: Fields): Promise<number | null> {
  const ctx = f.contexts.join("\n\n");
  if (!ctx.trim()) return null;
  const r = await chatJson<{ statements?: { statement: string; supported: boolean }[] }>(
    "You are a strict RAGAS faithfulness judge. Reply with JSON only.",
    `CONTEXT:\n${ctx}\n\nANSWER:\n${f.answer}\n\n` +
      `Extract the atomic factual claims made in ANSWER. For each claim decide if it can be ` +
      `directly inferred from CONTEXT. Reply JSON: ` +
      `{"statements":[{"statement":"...","supported":true|false}]}. ` +
      `If ANSWER contains no factual claims, reply {"statements":[]}.`,
  );
  const st = r.statements ?? [];
  if (st.length === 0) return null;
  return round4(st.filter((s) => s.supported).length / st.length);
}

/** answer_relevancy — mean cosine similarity between the question and questions
 * the answer would answer (embedding-based; null if embeddings unavailable). */
async function answerRelevancy(f: Fields): Promise<number | null> {
  if (!embeddingConfigured()) return null;
  const r = await chatJson<{ questions?: string[] }>(
    "You generate questions that a given answer would answer. Reply with JSON only.",
    `ANSWER:\n${f.answer}\n\nGenerate 3 concise, diverse questions for which the ANSWER above ` +
      `is a correct and complete answer. Reply JSON: {"questions":["...","...","..."]}.`,
  );
  const qs = (r.questions ?? []).filter((q) => typeof q === "string" && q.trim()).slice(0, 5);
  if (qs.length === 0) return null;
  const vecs = await embed([f.question, ...qs]);
  if (vecs.length < 2) return null;
  const qv = vecs[0];
  const sims = vecs.slice(1).map((v) => cosine(qv, v));
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  return round4(clamp01(mean));
}

/** context_precision — rank-weighted precision of relevant context chunks. */
async function contextPrecision(f: Fields): Promise<number | null> {
  const gt = f.groundTruth ?? "";
  if (!gt.trim() || f.contexts.length === 0) return null;
  const r = await chatJson<{ verdicts?: number[] }>(
    "You judge whether each context chunk is useful. Reply with JSON only.",
    `QUESTION:\n${f.question}\n\nGROUND TRUTH ANSWER:\n${gt}\n\n` +
      `CONTEXT CHUNKS (in order):\n${f.contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n")}\n\n` +
      `For each chunk output 1 if it is relevant/useful for producing the GROUND TRUTH ANSWER, else 0. ` +
      `Reply JSON: {"verdicts":[1,0,...]} with exactly ${f.contexts.length} values in order.`,
  );
  const v = (r.verdicts ?? []).map((x) => (x ? 1 : 0));
  while (v.length < f.contexts.length) v.push(0);
  let num = 0;
  let hits = 0;
  for (let k = 0; k < f.contexts.length; k++) {
    if (v[k]) {
      hits++;
      num += hits / (k + 1);
    }
  }
  const denom = v.slice(0, f.contexts.length).filter((x) => x).length;
  return denom ? round4(num / denom) : 0;
}

/** context_recall — fraction of ground-truth statements attributable to context. */
async function contextRecall(f: Fields): Promise<number | null> {
  const ctx = f.contexts.join("\n\n");
  const gt = f.groundTruth ?? "";
  if (!gt.trim() || !ctx.trim()) return null;
  const r = await chatJson<{ statements?: { statement: string; attributed: boolean }[] }>(
    "You judge whether each ground-truth statement is supported by context. Reply with JSON only.",
    `CONTEXT:\n${ctx}\n\nGROUND TRUTH ANSWER:\n${gt}\n\n` +
      `Break the GROUND TRUTH ANSWER into atomic statements. For each decide if it can be attributed ` +
      `to (supported by) the CONTEXT. Reply JSON: ` +
      `{"statements":[{"statement":"...","attributed":true|false}]}.`,
  );
  const st = r.statements ?? [];
  if (st.length === 0) return null;
  return round4(st.filter((s) => s.attributed).length / st.length);
}

/** answer_correctness — 0.75·(statement F1 vs ground truth) + 0.25·(semantic sim). */
async function answerCorrectness(f: Fields): Promise<number | null> {
  const gt = f.groundTruth ?? "";
  if (!gt.trim()) return null;
  const r = await chatJson<{ TP?: string[]; FP?: string[]; FN?: string[] }>(
    "You compare an answer to the ground truth by classifying statements. Reply with JSON only.",
    `GROUND TRUTH:\n${gt}\n\nANSWER:\n${f.answer}\n\n` +
      `Classify factual statements: TP = present in ANSWER and supported by GROUND TRUTH; ` +
      `FP = present in ANSWER but NOT supported by GROUND TRUTH; ` +
      `FN = present in GROUND TRUTH but MISSING from ANSWER. ` +
      `Reply JSON: {"TP":["..."],"FP":["..."],"FN":["..."]}.`,
  );
  const tp = (r.TP ?? []).length;
  const fp = (r.FP ?? []).length;
  const fn = (r.FN ?? []).length;
  const denom = tp + 0.5 * (fp + fn);
  const f1 = denom > 0 ? tp / denom : 0;

  if (embeddingConfigured()) {
    const vecs = await embed([f.answer, gt]);
    if (vecs.length >= 2) {
      const sem = clamp01(cosine(vecs[0], vecs[1]));
      return round4(clamp01(0.75 * f1 + 0.25 * sem));
    }
  }
  return round4(clamp01(f1));
}

const COMPUTE: Record<RagasMetric, (f: Fields) => Promise<number | null>> = {
  faithfulness,
  answer_relevancy: answerRelevancy,
  context_precision: contextPrecision,
  context_recall: contextRecall,
  answer_correctness: answerCorrectness,
};

/** Score one case with the LLM-judge engine, computing only ``metrics``. */
export async function scoreWithLlm(args: {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string | null;
  metrics: RagasMetric[];
}): Promise<CaseScore> {
  const f: Fields = {
    question: args.question,
    answer: args.answer,
    contexts: args.contexts,
    groundTruth: args.groundTruth,
  };
  const out: CaseScore = {};
  for (const m of args.metrics) {
    out[m] = await COMPUTE[m](f);
  }
  return out;
}
