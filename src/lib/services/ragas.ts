import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http";
import { hasColumn } from "@/lib/db/optionalColumn";
import {
  resultCols,
  effectiveExactExpr,
  runCols,
  mapRagasResult,
  mapRagasRun,
  mapRagasRunSummary,
} from "@/lib/db/rows";
import { ALL_METRICS, EXACT_MATCH, SYSTEM_USER } from "@/lib/types";
import type { LlmMetric, RagasMetric, RagasRunDetail, RagasRunSummary } from "@/lib/types";
import { writeAudit } from "./audit";
import { deleteCallConfigs } from "./callConfig";
import { isLive } from "./runRegistry";

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
  metrics: LlmMetric[];
}): CaseScore {
  const ctx = args.contexts.join("\n");
  const gt = args.groundTruth ?? "";
  const computed: Record<LlmMetric, number | null> = {
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

/** Score a case with the chosen engine: LLM-judge ("RAGAS") or lexical fallback.
 * Only RAGAS metrics belong here — 정답 일치 is computed separately (no LLM). */
export async function scoreCaseAsync(args: {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string | null;
  metrics: LlmMetric[];
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

/** The subset that needs the judge LLM (everything except 정답 일치). */
export function llmMetrics(metrics: RagasMetric[]): LlmMetric[] {
  return metrics.filter((m): m is LlmMetric => m !== EXACT_MATCH);
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
    `SELECT PROMPT_ID, NODE_NM, VERSION_NO FROM PTX_PROMPT_HIS WHERE PROMPT_ID IN (${names.join(", ")})`,
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
    // Scalar subqueries (not joins) so the run's bare column names stay unambiguous.
    // FIRST_QUESTION labels direct calls in the list (their run has no node/dataset
    // identity) and feeds the client-side search; 200 chars is plenty for both.
    // CASE_CNT 은 제목의 '5건' — 데이터셋 이름만으로는 폴더 하나만 돌린 실행과
    // 전체를 돌린 실행이 같아 보인다. 목록 한 번에 두 서브쿼리지만 둘 다 RUN_ID
    // 인덱스만 타므로 행당 비용은 사실상 같다.
    // DATASET_DESC 는 데이터셋의 설명 — 이 실행이 "무엇을 시험한 것인가". 실행에
    // 스냅샷으로 찍히는 값이 아니라 지금의 데이터셋에서 읽어 오므로, 설명을 고치면
    // 지난 기록의 설명도 같이 바뀌고 데이터셋이 지워지면 비어 있다.
    const res = await conn.execute(
      `SELECT ${await runCols(conn)},
              (SELECT DBMS_LOB.SUBSTR(x.QUESTION_CTN, 200, 1) FROM PTX_RUN_DET x
                WHERE x.RESULT_ID =
                      (SELECT MIN(y.RESULT_ID) FROM PTX_RUN_DET y
                        WHERE y.RUN_ID = PTX_RUN_MAS.RUN_ID)) AS FIRST_QUESTION,
              (SELECT COUNT(*) FROM PTX_RUN_DET z
                WHERE z.RUN_ID = PTX_RUN_MAS.RUN_ID) AS CASE_CNT,
              (SELECT w.DESC_CTN FROM PTX_DATASET_MAS w
                WHERE w.DATASET_ID = PTX_RUN_MAS.DATASET_ID) AS DATASET_DESC
         FROM PTX_RUN_MAS ORDER BY RUN_ID DESC`,
    );
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
    const runRes = await conn.execute(`SELECT ${await runCols(conn)} FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
    const runRows = (runRes.rows ?? []) as Record<string, unknown>[];
    if (runRows.length === 0) return null;
    const run = mapRagasRun(runRows[0]);
    const resultsRes = await conn.execute(
      `SELECT ${await resultCols(conn)} FROM PTX_RUN_DET WHERE RUN_ID = :id ORDER BY RESULT_ID ASC`,
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
  // A run that is still executing must not have its record pulled out from
  // under it: the execution keeps writing to rows that no longer exist, its
  // stream never reaches a terminal event, and the panel that started it is
  // left showing nothing but a Cancel button for a run it can no longer
  // cancel. Stop it first, then delete it.
  if (isLive(runId)) {
    throw conflict("실행 중인 기록입니다 — 먼저 취소한 뒤 삭제하세요");
  }
  await withConn(async (conn) => {
    const res = await conn.execute(`SELECT RUN_ID FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
    if (((res.rows ?? []) as unknown[]).length === 0) throw notFound("ragas run not found");
    // The captured intermediate variables belong to this run's calls, but there is
    // no FK to cascade through (the agent writes them before the run row exists),
    // so clear them by TRACE_ID first — while PTX_RUN_DET still holds the ids.
    await conn.execute(
      `DELETE FROM PTX_TRACE_HIS WHERE TRACE_ID IN
         (SELECT TRACE_ID FROM PTX_RUN_DET WHERE RUN_ID = :id AND TRACE_ID IS NOT NULL)`,
      { id: runId },
    );
    // Same for the model config staged for this run's calls — no FK either, since
    // a manual call stages its row before the run row exists.
    await deleteCallConfigs(conn, runId);
    // PTX_RUN_DET.RUN_ID is ON DELETE CASCADE — the per-case rows go with the run.
    await conn.execute(`DELETE FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
    await writeAudit(conn, {
      targetTable: "PTX_RUN_MAS",
      targetId: runId,
      action: "DELETE",
      before: { ragas_run_id: runId },
      after: null,
      createdBy: SYSTEM_USER,
    });
  }, { commit: true });
}

/**
 * 케이스 한 건을 사람이 손으로 통과시키거나, 그 처리를 되돌린다.
 *
 * 채점 결과(EXACT_VAL)는 건드리지 않는다 — 원래 무엇이 걸렸던 건지가 남아야
 * 정답지를 고칠지 판단할 수 있다. 대신 PASS_YN 을 세우고, 실행 단위 '정답 일치'
 * 를 사람의 판단까지 반영해 다시 낸다(불일치 재실행 대상도 같은 식을 쓴다).
 *
 * 끝난 실행에서만 된다. 돌아가는 중인 실행은 이 행을 곧 지우고 다시 쓸 수 있어,
 * 방금 누른 통과가 소리 없이 사라진다.
 */
export async function setResultPass(
  runId: number,
  resultId: number,
  pass: boolean,
): Promise<{ passed: boolean; exact_match: number | null }> {
  return withConn(async (conn) => {
    if (!(await hasColumn(conn, "PTX_RUN_DET", "PASS_YN"))) {
      throw badRequest("이 DB 에는 수동 통과 컬럼이 없습니다 — sql/migrate_run_det_pass.sql 을 적용하세요");
    }
    const runRes = await conn.execute(`SELECT STATUS_CD FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
    const runRow = ((runRes.rows ?? []) as Record<string, unknown>[])[0];
    if (!runRow) throw notFound("ragas run not found");
    const status = String(runRow.STATUS_CD);
    if (status === "RUNNING" || status === "PENDING" || status === "CANCELLING") {
      throw badRequest("아직 끝나지 않은 실행입니다");
    }
    const upd = await conn.execute(
      `UPDATE PTX_RUN_DET
          SET PASS_YN = :yn, PASS_TM = ${pass ? "SYSTIMESTAMP" : "NULL"}
        WHERE RESULT_ID = :rid AND RUN_ID = :runId`,
      { yn: pass ? "Y" : null, rid: resultId, runId },
    );
    if (!upd.rowsAffected) throw notFound("result not found");

    // 실행 단위 '정답 일치' 를 다시 낸다 — 통과 한 건이 늘면 기록의 점수도 같이
    // 움직여야 목록과 상세가 서로 다른 말을 하지 않는다.
    const exact = await effectiveExactExpr(conn);
    await conn.execute(
      `UPDATE PTX_RUN_MAS
          SET EXACT_VAL = (SELECT AVG(${exact}) FROM PTX_RUN_DET WHERE RUN_ID = :id)
        WHERE RUN_ID = :id`,
      { id: runId },
    );
    const after = await conn.execute(
      `SELECT EXACT_VAL FROM PTX_RUN_MAS WHERE RUN_ID = :id`,
      { id: runId },
    );
    const row = ((after.rows ?? []) as Record<string, unknown>[])[0] ?? {};
    const v = row.EXACT_VAL;
    return { passed: pass, exact_match: v == null ? null : Number(v) };
  }, { commit: true });
}
