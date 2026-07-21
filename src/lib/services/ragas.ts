import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { notFound } from "@/lib/http";
import {
  RESULT_COLS,
  RUN_COLS,
  mapRagasResult,
  mapRagasRun,
  mapRagasRunSummary,
} from "@/lib/db/rows";
import { ALL_METRICS, SYSTEM_USER } from "@/lib/types";
import type { RagasMetric, RagasRunDetail, RagasRunSummary } from "@/lib/types";
import { writeAudit } from "./audit";

// ============================================================
// Fallback scorer — deterministic token-overlap heuristics (dependency-free).
// The real Python `ragas` engine is not portable to Node; this checkout uses the
// fallback only (see plan A). Lexical approximation, not semantic judgement.
// ============================================================

const WORD_RE = /[a-z0-9가-힣]+/g;

// Korean particles (josa) stripped so "프롬프트를"/"프롬프트는"/"프롬프트" collapse to
// one stem. Ordered longest-first.
const JOSA = [
  "으로써", "으로서", "이라고", "에게서", "으로", "로서", "로써", "이라", "라고", "에서",
  "에게", "께서", "라는", "이나", "에는", "에도", "이다", "처럼", "보다", "까지", "부터",
  "마저", "조차", "한테", "은", "는", "이", "가", "을", "를", "과", "와", "의", "에",
  "도", "만", "로", "랑", "나", "야",
];

function stripJosa(tok: string): string {
  for (const j of JOSA) {
    if (tok.length >= j.length + 2 && tok.endsWith(j)) return tok.slice(0, tok.length - j.length);
  }
  return tok;
}

function tokens(text: string | null): Set<string> {
  const out = new Set<string>();
  const matches = (text ?? "").toLowerCase().match(WORD_RE) ?? [];
  for (const t of matches) out.add(stripJosa(t));
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Fraction of a's unique tokens that also appear in b. */
function coverage(a: string | null, b: string | null): number {
  const ta = tokens(a);
  if (ta.size === 0) return 0;
  const tb = tokens(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return round4(inter / ta.size);
}

/** Token-overlap F1 (symmetric). */
function f1(a: string | null, b: string | null): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (inter === 0) return 0;
  return round4((2 * inter) / (ta.size + tb.size));
}

export type CaseScore = Partial<Record<RagasMetric, number | null>>;

/** Score one case with the fallback heuristics, returning only ``metrics``. */
export function scoreCase(args: {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string | null;
  metrics: RagasMetric[];
}): CaseScore {
  const ctx = args.contexts.join("\n");
  const gt = args.groundTruth ?? "";
  const computed: Record<RagasMetric, number | null> = {
    faithfulness: coverage(args.answer, ctx),
    answer_relevancy: coverage(args.question, args.answer),
    context_precision: gt ? coverage(ctx, gt) : null,
    context_recall: gt ? coverage(gt, ctx) : null,
    answer_correctness: gt ? f1(args.answer, gt) : null,
  };
  const out: CaseScore = {};
  for (const m of args.metrics) out[m] = computed[m];
  return out;
}

/** Score a case with the chosen engine: LLM-judge ("RAGAS") or lexical fallback. */
export async function scoreCaseAsync(args: {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string | null;
  metrics: RagasMetric[];
  engine: "RAGAS" | "FALLBACK";
}): Promise<CaseScore> {
  if (args.engine === "RAGAS") {
    const { scoreWithLlm } = await import("./ragas/engine");
    return scoreWithLlm({
      question: args.question,
      answer: args.answer,
      contexts: args.contexts,
      groundTruth: args.groundTruth,
      metrics: args.metrics,
    });
  }
  return scoreCase(args);
}

// ---- helpers (ragas_service.py) ----

/** Extract RAGAS fields from a test case's input_data JSON. */
export function parseCase(inputData: string, expectedOutput: string | null): {
  question: string;
  contexts: string[];
  groundTruth: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputData);
  } catch {
    parsed = {};
  }
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  let contexts = obj.contexts;
  if (typeof contexts === "string") contexts = [contexts];
  else if (!Array.isArray(contexts)) contexts = [];
  const gt = obj.ground_truth;
  return {
    question: String(obj.question ?? ""),
    contexts: (contexts as unknown[]).map((c) => String(c)),
    groundTruth: (gt as string | undefined) || expectedOutput,
  };
}

/** Convert a raw metric score to a DB-safe number, or null for non-finite. */
export function toScore(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const f = Number(v);
  if (!Number.isFinite(f)) return null;
  return round4(f);
}

export function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return round4(values.reduce((a, b) => a + b, 0) / values.length);
}

export function chosenMetrics(metrics: string[]): RagasMetric[] {
  const set = new Set(metrics);
  const chosen = ALL_METRICS.filter((m) => set.has(m));
  return (chosen.length ? chosen : [...ALL_METRICS]) as RagasMetric[];
}

// ---- prompt label resolution ----

/** {prompt_id: [node_nm, version_no]} for A/B labelling (one batched query). */
export async function resolvePromptLabels(
  conn: OracleConnection,
  promptIds: (number | null)[],
): Promise<Map<number, { node_nm: string; version_no: string }>> {
  const ids = [...new Set(promptIds.filter((p): p is number => !!p))];
  const map = new Map<number, { node_nm: string; version_no: string }>();
  if (ids.length === 0) return map;
  const binds: Record<string, unknown> = {};
  const names = ids.map((id, i) => {
    binds[`p${i}`] = id;
    return `:p${i}`;
  });
  const res = await conn.execute(
    `SELECT PROMPT_ID, NODE_NM, VERSION_NO FROM PM_NODE_PROMPT_VER WHERE PROMPT_ID IN (${names.join(", ")})`,
    binds,
  );
  for (const r of (res.rows ?? []) as Record<string, unknown>[]) {
    map.set(Number(r.PROMPT_ID), { node_nm: String(r.NODE_NM), version_no: String(r.VERSION_NO) });
  }
  return map;
}

// ---- read ops ----

export async function listRuns(): Promise<RagasRunSummary[]> {
  return readConn(async (conn) => {
    const res = await conn.execute(`SELECT ${RUN_COLS} FROM PM_RAGAS_RUN ORDER BY RAGAS_RUN_ID DESC`);
    const rows = (res.rows ?? []) as Record<string, unknown>[];
    const summaries = rows.map(mapRagasRunSummary);
    const labels = await resolvePromptLabels(conn, rows.map((r) => (r.PROMPT_ID != null ? Number(r.PROMPT_ID) : null)));
    for (const s of summaries) {
      if (s.prompt_id) {
        const l = labels.get(s.prompt_id);
        if (l) {
          s.node_nm = l.node_nm;
          s.version_no = l.version_no;
        }
      }
    }
    return summaries;
  }, []);
}

export async function getRunDetail(runId: number): Promise<RagasRunDetail> {
  const detail = await readConn(async (conn) => {
    const runRes = await conn.execute(`SELECT ${RUN_COLS} FROM PM_RAGAS_RUN WHERE RAGAS_RUN_ID = :id`, { id: runId });
    const runRows = (runRes.rows ?? []) as Record<string, unknown>[];
    if (runRows.length === 0) return null;
    const run = mapRagasRun(runRows[0]);
    const resultsRes = await conn.execute(
      `SELECT ${RESULT_COLS} FROM PM_RAGAS_RESULT WHERE RAGAS_RUN_ID = :id ORDER BY RAGAS_RESULT_ID ASC`,
      { id: runId },
    );
    const results = ((resultsRes.rows ?? []) as Record<string, unknown>[]).map(mapRagasResult);
    if (run.prompt_id) {
      const labels = await resolvePromptLabels(conn, [run.prompt_id]);
      const l = labels.get(run.prompt_id);
      if (l) {
        run.node_nm = l.node_nm;
        run.version_no = l.version_no;
      }
    }
    return { ...run, results } as RagasRunDetail;
  }, null);
  if (detail === null) throw notFound("ragas run not found");
  return detail;
}

export async function deleteRun(runId: number): Promise<void> {
  await withConn(async (conn) => {
    const res = await conn.execute(`SELECT RAGAS_RUN_ID FROM PM_RAGAS_RUN WHERE RAGAS_RUN_ID = :id`, { id: runId });
    if (((res.rows ?? []) as unknown[]).length === 0) throw notFound("ragas run not found");
    await conn.execute(`DELETE FROM PM_RAGAS_RESULT WHERE RAGAS_RUN_ID = :id`, { id: runId });
    await conn.execute(`DELETE FROM PM_RAGAS_RUN WHERE RAGAS_RUN_ID = :id`, { id: runId });
    await writeAudit(conn, {
      targetTable: "PM_RAGAS_RUN",
      targetId: runId,
      action: "DELETE",
      before: { ragas_run_id: runId },
      after: null,
      createdBy: SYSTEM_USER,
    });
  }, { commit: true });
}
