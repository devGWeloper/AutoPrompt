import { readConn, withConn } from "@/lib/db";
import type { OracleConnection, OracleModule } from "@/lib/db";
import { notFound } from "@/lib/http";
import { RUN_COLS, insertReturningId, mapRagasRun } from "@/lib/db/rows";
import { ALL_METRICS, SYSTEM_USER } from "@/lib/types";
import type {
  FlowCurrent,
  RagasMetric,
  RagasRunOut,
  RagasResultRow,
  RunEvent,
} from "@/lib/types";
import { resolveRagasEngine } from "@/lib/config";
import { requireDataset } from "./datasets";
import * as agent from "./externalAgent";
import { avg, chosenMetrics, parseCase, scoreCaseAsync, toScore } from "./ragas";

// ---- current flow (node list) ----

export async function getCurrentFlow(): Promise<FlowCurrent> {
  return readConn(async (conn) => {
    // Distinct NODE_NM ordered by first appearance; latest version per node.
    const res = await conn.execute(
      `SELECT PROMPT_ID, NODE_NM, VERSION_NO, MODEL_NM, CREATED_DT
         FROM PM_NODE_PROMPT_VER
        ORDER BY CREATED_DT DESC, PROMPT_ID DESC`,
    );
    const rows = (res.rows ?? []) as Record<string, unknown>[];
    const latest = new Map<string, { prompt_id: number; version_no: string; model_nm: string | null }>();
    const order: string[] = [];
    // rows are newest-first → first seen per node is the latest.
    for (const r of rows) {
      const nm = String(r.NODE_NM);
      if (!latest.has(nm)) {
        latest.set(nm, {
          prompt_id: Number(r.PROMPT_ID),
          version_no: String(r.VERSION_NO),
          model_nm: r.MODEL_NM != null ? String(r.MODEL_NM) : null,
        });
      }
    }
    // Node order by first appearance (oldest prompt_id first) for a stable list.
    const seen = new Set<string>();
    for (const r of [...rows].sort((a, b) => Number(a.PROMPT_ID) - Number(b.PROMPT_ID))) {
      const nm = String(r.NODE_NM);
      if (!seen.has(nm)) {
        seen.add(nm);
        order.push(nm);
      }
    }
    return {
      nodes: order.map((nm) => {
        const lp = latest.get(nm)!;
        return {
          node_nm: nm,
          latest_prompt_id: lp.prompt_id,
          latest_version_no: lp.version_no,
          latest_model_nm: lp.model_nm,
        };
      }),
    };
  }, { nodes: [] });
}

// ---- run row helper ----

async function fetchRun(conn: OracleConnection, runId: number): Promise<RagasRunOut | null> {
  const res = await conn.execute(`SELECT ${RUN_COLS} FROM PM_RAGAS_RUN WHERE RAGAS_RUN_ID = :id`, { id: runId });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? mapRagasRun(rows[0]) : null;
}

async function promptNode(conn: OracleConnection, promptId: number): Promise<string | null> {
  const res = await conn.execute(`SELECT NODE_NM FROM PM_NODE_PROMPT_VER WHERE PROMPT_ID = :id`, { id: promptId });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? String(rows[0].NODE_NM) : null;
}

// ---- create runs ----

export async function createFlowRagasRun(args: {
  datasetId: number;
  metrics: string[];
  nodeNm?: string | null;
  promptId?: number | null;
}): Promise<RagasRunOut> {
  await requireDataset(args.datasetId);
  return withConn(async (conn, oracle) => {
    if (args.promptId != null) {
      const nm = await promptNode(conn, args.promptId);
      if (nm === null || (args.nodeNm != null && nm !== args.nodeNm)) {
        throw notFound(`prompt version ${args.promptId} not found for node ${JSON.stringify(args.nodeNm)}`);
      }
    }
    const chosen = chosenMetrics(args.metrics);
    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PM_RAGAS_RUN (PROMPT_ID, DATASET_ID, STATUS, METRICS, CREATED_BY)
       VALUES (:pid, :did, 'PENDING', :metrics, :cby) RETURNING RAGAS_RUN_ID INTO :out_id`,
      { pid: args.promptId ?? null, did: args.datasetId, metrics: JSON.stringify(chosen), cby: SYSTEM_USER },
    );
    return (await fetchRun(conn, id))!;
  }, { commit: true });
}

export async function createFlowRagasAbRun(args: {
  datasetId: number;
  nodeNm: string;
  promptIdA: number;
  promptIdB: number;
  metrics: string[];
}): Promise<{ ragas_run_a_id: number; ragas_run_b_id: number }> {
  await requireDataset(args.datasetId);
  return withConn(async (conn, oracle) => {
    for (const pid of [args.promptIdA, args.promptIdB]) {
      const nm = await promptNode(conn, pid);
      if (nm === null || nm !== args.nodeNm) {
        throw notFound(`prompt version ${pid} not found for node ${JSON.stringify(args.nodeNm)}`);
      }
    }
    const chosen = chosenMetrics(args.metrics);
    const ids: number[] = [];
    for (const pid of [args.promptIdA, args.promptIdB]) {
      const id = await insertReturningId(
        conn,
        oracle,
        `INSERT INTO PM_RAGAS_RUN (PROMPT_ID, DATASET_ID, STATUS, METRICS, CREATED_BY)
         VALUES (:pid, :did, 'PENDING', :metrics, :cby) RETURNING RAGAS_RUN_ID INTO :out_id`,
        { pid, did: args.datasetId, metrics: JSON.stringify(chosen), cby: SYSTEM_USER },
      );
      ids.push(id);
    }
    const group = ids[0];
    await conn.execute(`UPDATE PM_RAGAS_RUN SET AB_GROUP_ID = :g WHERE RAGAS_RUN_ID IN (:a, :b)`, {
      g: group,
      a: ids[0],
      b: ids[1],
    });
    return { ragas_run_a_id: ids[0], ragas_run_b_id: ids[1] };
  }, { commit: true });
}

// ---- direct external-API calls (recorded as ENGINE='direct') ----

const DIRECT_ENGINE = "direct";
const DIRECT_SINK_NM = "(직접 호출)";

async function directSinkDatasetId(conn: OracleConnection, oracle: OracleModule): Promise<number> {
  const res = await conn.execute(
    `SELECT DATASET_ID FROM PM_TEST_DATASET WHERE DATASET_NM = :nm AND IS_ACTIVE = 'N' FETCH FIRST 1 ROWS ONLY`,
    { nm: DIRECT_SINK_NM },
  );
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  if (rows.length) return Number(rows[0].DATASET_ID);
  return insertReturningId(
    conn,
    oracle,
    `INSERT INTO PM_TEST_DATASET (DATASET_NM, DESCRIPTION, IS_ACTIVE, CREATED_BY)
     VALUES (:nm, :descr, 'N', :cby) RETURNING DATASET_ID INTO :out_id`,
    { nm: DIRECT_SINK_NM, descr: "직접 호출 기록 전용 (자동 생성, 목록 비표시)", cby: SYSTEM_USER },
  );
}

export async function recordDirectRun(args: {
  message: string;
  baseUrl?: string | null;
  authKey?: string | null;
  userId?: string | null;
}): Promise<agent.AgentAnswer> {
  const data = await agent.runDirect(args);
  await withConn(async (conn, oracle) => {
    const sinkId = await directSinkDatasetId(conn, oracle);
    const runId = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PM_RAGAS_RUN (DATASET_ID, STATUS, ENGINE, CREATED_BY, STARTED_DT, ENDED_DT)
       VALUES (:did, 'DONE', :eng, :by, SYSTIMESTAMP, SYSTIMESTAMP) RETURNING RAGAS_RUN_ID INTO :out_id`,
      { did: sinkId, eng: DIRECT_ENGINE, cby: SYSTEM_USER },
    );
    await conn.execute(
      `INSERT INTO PM_RAGAS_RESULT (RAGAS_RUN_ID, CASE_ID, QUESTION, ANSWER, CONTEXTS)
       VALUES (:rid, NULL, :q, :a, :ctx)`,
      { rid: runId, q: args.message, a: data.response, ctx: JSON.stringify(data.docs) },
    );
  }, { commit: true });
  return data;
}

function messageFromInputs(inputData: string): string {
  let obj: Record<string, string> = {};
  try {
    const parsed = JSON.parse(inputData);
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) obj[k] = String(v);
    }
  } catch {
    /* fall through */
  }
  for (const k of ["message", "question", "query", "input", "text"]) {
    if (obj[k]) return obj[k];
  }
  for (const v of Object.values(obj)) if (v) return v;
  return inputData;
}

// ---- cancel ----

export async function requestCancel(runId: number): Promise<{ status: string }> {
  return withConn(async (conn) => {
    const run = await fetchRun(conn, runId);
    if (!run) throw notFound("ragas run not found");
    if (["DONE", "FAILED", "CANCELLED"].includes(run.status)) {
      throw new (await import("@/lib/http")).ApiError(409, `run already ${run.status}`);
    }
    await conn.execute(`UPDATE PM_RAGAS_RUN SET STATUS = 'CANCELLING' WHERE RAGAS_RUN_ID = :id`, { id: runId });
    return { status: "cancelling" };
  }, { commit: true });
}

// ============================================================
// SSE run execution (replaces the old WebSocket streaming).
// ============================================================

export type Emit = (event: RunEvent) => void;

interface CaseRow {
  case_id: number;
  input_data: string;
  expected_output: string | null;
}

async function loadCases(conn: OracleConnection, datasetId: number): Promise<CaseRow[]> {
  const res = await conn.execute(
    `SELECT CASE_ID, INPUT_DATA, EXPECTED_OUTPUT FROM PM_TEST_CASE WHERE DATASET_ID = :id ORDER BY CASE_ID ASC`,
    { id: datasetId },
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => ({
    case_id: Number(r.CASE_ID),
    input_data: String(r.INPUT_DATA ?? ""),
    expected_output: r.EXPECTED_OUTPUT != null ? String(r.EXPECTED_OUTPUT) : null,
  }));
}

async function isCancelRequested(conn: OracleConnection, runId: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return true;
  const res = await conn.execute(`SELECT STATUS FROM PM_RAGAS_RUN WHERE RAGAS_RUN_ID = :id`, { id: runId });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length > 0 && rows[0].STATUS === "CANCELLING";
}

async function fetchResultRow(conn: OracleConnection, resultId: number): Promise<RagasResultRow> {
  const { RESULT_COLS, mapRagasResult } = await import("@/lib/db/rows");
  const res = await conn.execute(`SELECT ${RESULT_COLS} FROM PM_RAGAS_RESULT WHERE RAGAS_RESULT_ID = :id`, {
    id: resultId,
  });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return mapRagasResult(rows[0]);
}

interface Pending {
  resultId: number;
  caseId: number;
  question: string;
  contexts: string[];
  groundTruth: string | null;
  answer: string | null;
  error: boolean;
}

async function swapActive(conn: OracleConnection, nodeNm: string, promptId: number): Promise<void> {
  await conn.execute(`UPDATE PM_NODE_PROMPT_VER SET IS_ACTIVE = 'N' WHERE NODE_NM = :nm`, { nm: nodeNm });
  await conn.execute(`UPDATE PM_NODE_PROMPT_VER SET IS_ACTIVE = 'Y' WHERE PROMPT_ID = :id`, { id: promptId });
  await conn.commit();
}

async function deactivateNode(conn: OracleConnection, nodeNm: string): Promise<void> {
  await conn.execute(`UPDATE PM_NODE_PROMPT_VER SET IS_ACTIVE = 'N' WHERE NODE_NM = :nm`, { nm: nodeNm });
  await conn.commit();
}

interface RunCtx {
  runId: number;
  engine: "RAGAS" | "FALLBACK";
  metrics: RagasMetric[];
  cases: CaseRow[];
  swapNode: string | null;
  pending: Pending[];
  sums: Record<RagasMetric, number[]>;
  cancelled: boolean;
}

async function setupRun(conn: OracleConnection, oracle: OracleModule, runId: number, emit: Emit): Promise<RunCtx | null> {
  const run = await fetchRun(conn, runId);
  if (!run) return null;
  // Already finished (e.g. an EventSource reconnected after completion) → replay
  // the terminal event and do NOT execute again.
  if (["DONE", "FAILED", "CANCELLED"].includes(run.status)) {
    if (run.status === "DONE") {
      const summary = Object.fromEntries(ALL_METRICS.map((m) => [m, run[m]])) as Record<string, number | null>;
      emit({ event: "DONE", run_id: runId, engine: run.engine, summary });
    } else if (run.status === "CANCELLED") {
      emit({ event: "CANCELLED", run_id: runId });
    } else {
      emit({ event: "FAILED", run_id: runId, error: run.error_msg ?? "failed" });
    }
    return null;
  }
  const engine = resolveRagasEngine();
  await conn.execute(`UPDATE PM_RAGAS_RUN SET STATUS = 'RUNNING', STARTED_DT = SYSTIMESTAMP, ENGINE = :eng WHERE RAGAS_RUN_ID = :id`, {
    eng: engine,
    id: runId,
  });
  await conn.commit();
  const cases = await loadCases(conn, run.dataset_id);
  emit({ event: "RUNNING", run_id: runId, total: cases.length });

  let metrics: RagasMetric[];
  try {
    metrics = chosenMetrics(run.metrics ? (JSON.parse(run.metrics) as string[]) : [...ALL_METRICS]);
  } catch {
    metrics = [...ALL_METRICS];
  }

  let swapNode: string | null = null;
  if (run.prompt_id) {
    const nm = await promptNode(conn, run.prompt_id);
    if (nm) {
      await swapActive(conn, nm, run.prompt_id);
      swapNode = nm;
    }
  }

  const sums = Object.fromEntries(ALL_METRICS.map((m) => [m, [] as number[]])) as Record<RagasMetric, number[]>;
  return { runId, engine, metrics, cases, swapNode, pending: [], sums, cancelled: false };
}

async function phase1(conn: OracleConnection, oracle: OracleModule, ctx: RunCtx, emit: Emit, signal?: AbortSignal): Promise<void> {
  const total = ctx.cases.length;
  let done = 0;
  for (const c of ctx.cases) {
    if (await isCancelRequested(conn, ctx.runId, signal)) {
      ctx.cancelled = true;
      break;
    }
    const fields = parseCase(c.input_data, c.expected_output);
    const message = fields.question || messageFromInputs(c.input_data);
    let answer: string | null = null;
    let error = false;
    let errMsg: string | null = null;
    let contexts = fields.contexts;
    try {
      const data = await agent.flowAnswer(message);
      answer = data.response;
      if (!contexts.length && data.docs.length) contexts = data.docs;
    } catch (e) {
      error = true;
      answer = null;
      errMsg = String(e).slice(0, 1000);
    }
    const resultId = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PM_RAGAS_RESULT (RAGAS_RUN_ID, CASE_ID, QUESTION, CONTEXTS, GROUND_TRUTH, ANSWER, ERROR_MSG)
       VALUES (:rid, :cid, :q, :ctx, :gt, :a, :err) RETURNING RAGAS_RESULT_ID INTO :out_id`,
      {
        rid: ctx.runId,
        cid: c.case_id,
        q: fields.question,
        ctx: JSON.stringify(contexts),
        gt: fields.groundTruth,
        a: answer,
        err: errMsg,
      },
    );
    await conn.commit();
    ctx.pending.push({
      resultId,
      caseId: c.case_id,
      question: fields.question,
      contexts,
      groundTruth: fields.groundTruth,
      answer,
      error,
    });
    done++;
    emit({ event: "ANSWER", run_id: ctx.runId, done, total, case_id: c.case_id, result: await fetchResultRow(conn, resultId) });
  }
}

async function phase2(conn: OracleConnection, ctx: RunCtx, emit: Emit, signal?: AbortSignal): Promise<void> {
  const total = ctx.cases.length;
  let done = 0;
  for (const p of ctx.pending) {
    if (await isCancelRequested(conn, ctx.runId, signal)) {
      ctx.cancelled = true;
      break;
    }
    done++;
    if (p.answer !== null && !p.error) {
      try {
        const cs = await scoreCaseAsync({
          question: p.question,
          answer: p.answer,
          contexts: p.contexts,
          groundTruth: p.groundTruth,
          metrics: ctx.metrics,
          engine: ctx.engine,
        });
        const sets: string[] = [];
        const binds: Record<string, unknown> = { id: p.resultId };
        let stored = false;
        for (const m of ctx.metrics) {
          const dec = toScore(cs[m] ?? null);
          if (dec !== null) {
            sets.push(`${m.toUpperCase()} = :${m}`);
            binds[m] = dec;
            ctx.sums[m].push(dec);
            stored = true;
          }
        }
        if (stored) {
          await conn.execute(`UPDATE PM_RAGAS_RESULT SET ${sets.join(", ")} WHERE RAGAS_RESULT_ID = :id`, binds);
        } else {
          await conn.execute(`UPDATE PM_RAGAS_RESULT SET ERROR_MSG = :err WHERE RAGAS_RESULT_ID = :id`, {
            err: "scorer returned no finite metric scores",
            id: p.resultId,
          });
        }
      } catch (e) {
        // Per-case scoring failure (e.g. LLM/embedding call failed) — record and continue.
        await conn.execute(`UPDATE PM_RAGAS_RESULT SET ERROR_MSG = :err WHERE RAGAS_RESULT_ID = :id`, {
          err: String(e).slice(0, 1000),
          id: p.resultId,
        });
      }
      await conn.commit();
    }
    emit({ event: "SCORE", run_id: ctx.runId, done, total, case_id: p.caseId, result: await fetchResultRow(conn, p.resultId) });
  }
}

async function finalize(conn: OracleConnection, ctx: RunCtx, emit: Emit): Promise<void> {
  if (ctx.cancelled) {
    // Drop partial scores; keep answers.
    const nulls = ALL_METRICS.map((m) => `${m.toUpperCase()} = NULL`).join(", ");
    await conn.execute(`UPDATE PM_RAGAS_RESULT SET ${nulls} WHERE RAGAS_RUN_ID = :id`, { id: ctx.runId });
    await conn.execute(`UPDATE PM_RAGAS_RUN SET STATUS = 'CANCELLED', ENDED_DT = SYSTIMESTAMP WHERE RAGAS_RUN_ID = :id`, {
      id: ctx.runId,
    });
    await conn.commit();
    emit({ event: "CANCELLED", run_id: ctx.runId });
    return;
  }
  const sets: string[] = [];
  const binds: Record<string, unknown> = { id: ctx.runId };
  const summary: Record<string, number | null> = {};
  for (const m of ALL_METRICS) {
    const a = avg(ctx.sums[m]);
    sets.push(`${m.toUpperCase()} = :${m}`);
    binds[m] = a;
    summary[m] = a;
  }
  await conn.execute(
    `UPDATE PM_RAGAS_RUN SET STATUS = 'DONE', ENDED_DT = SYSTIMESTAMP, ${sets.join(", ")} WHERE RAGAS_RUN_ID = :id`,
    binds,
  );
  await conn.commit();
  emit({ event: "DONE", run_id: ctx.runId, engine: ctx.engine, summary });
}

async function recordFailure(conn: OracleConnection, runId: number, msg: string, emit: Emit): Promise<void> {
  try {
    await conn.execute(
      `UPDATE PM_RAGAS_RUN SET STATUS = 'FAILED', ERROR_MSG = :err, ENDED_DT = SYSTIMESTAMP WHERE RAGAS_RUN_ID = :id`,
      { err: msg.slice(0, 1000), id: runId },
    );
    await conn.execute(`INSERT INTO PM_RAGAS_RESULT (RAGAS_RUN_ID, ERROR_MSG) VALUES (:id, :err)`, {
      id: runId,
      err: msg.slice(0, 1000),
    });
    await conn.commit();
  } catch {
    /* best effort */
  }
  emit({ event: "FAILED", run_id: runId, error: msg });
}

/** Execute a single flow RAGAS run, streaming events via ``emit``. */
export async function executeRun(runId: number, emit: Emit, signal?: AbortSignal): Promise<void> {
  await withConn(async (conn, oracle) => {
    let ctx: RunCtx | null = null;
    try {
      ctx = await setupRun(conn, oracle, runId, emit);
      if (!ctx) return;
      try {
        await phase1(conn, oracle, ctx, emit, signal);
        if (!ctx.cancelled) await phase2(conn, ctx, emit, signal);
      } finally {
        if (ctx.swapNode) await deactivateNode(conn, ctx.swapNode);
      }
      await finalize(conn, ctx, emit);
    } catch (e) {
      await recordFailure(conn, runId, String(e), emit);
    }
  });
}

/** Resolve an A/B group's two run ids and execute them (used by the SSE route). */
export async function executeAbGroup(groupId: number, emit: Emit, signal?: AbortSignal): Promise<void> {
  const ids = await readConn(async (conn) => {
    const res = await conn.execute(
      `SELECT RAGAS_RUN_ID FROM PM_RAGAS_RUN WHERE AB_GROUP_ID = :g ORDER BY RAGAS_RUN_ID ASC`,
      { g: groupId },
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => Number(r.RAGAS_RUN_ID));
  }, [] as number[]);
  if (ids.length !== 2) {
    emit({ event: "FAILED", run_id: groupId, error: "ab pair not found" });
    return;
  }
  await executeAbRun(ids[0], ids[1], emit, signal);
}

/** Execute an A/B pair with phases interleaved: A answers → B answers → A scores → B scores. */
export async function executeAbRun(aId: number, bId: number, emit: Emit, signal?: AbortSignal): Promise<void> {
  await withConn(async (conn, oracle) => {
    const ctxs: (RunCtx | null)[] = [];
    try {
      for (const id of [aId, bId]) ctxs.push(await setupRun(conn, oracle, id, emit));
      // Phase 1 — answers for A, then B (each under its own active-prompt swap).
      for (const ctx of ctxs) {
        if (!ctx) continue;
        try {
          await phase1(conn, oracle, ctx, emit, signal);
        } finally {
          if (ctx.swapNode) await deactivateNode(conn, ctx.swapNode);
        }
      }
      // Phase 2 — scores for A, then B.
      for (const ctx of ctxs) {
        if (!ctx || ctx.cancelled) continue;
        await phase2(conn, ctx, emit, signal);
      }
      for (const ctx of ctxs) {
        if (!ctx) continue;
        await finalize(conn, ctx, emit);
      }
    } catch (e) {
      for (const id of [aId, bId]) await recordFailure(conn, id, String(e), emit);
    }
  });
}
