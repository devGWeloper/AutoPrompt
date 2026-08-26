import { readConn, withConn } from "@/lib/db";
import type { OracleConnection, OracleModule } from "@/lib/db";
import { ApiError, badRequest, errorText, notFound } from "@/lib/http";
import { METRIC_COLS, RUN_COLS, insertReturningId, mapRagasRun } from "@/lib/db/rows";
import { ALL_METRICS, DIRECT_SINK_NM, EXACT_MATCH, SYSTEM_USER } from "@/lib/types";
import type {
  EndpointHeader,
  FlowCurrent,
  LlmMetric,
  ModelSelection,
  RagasMetric,
  RagasRunOut,
  RagasResultRow,
  RunEvent,
} from "@/lib/types";
import { exactMatchScore } from "@/lib/exactMatch";
import { resolveRagasEngine } from "@/lib/config";
import { requireDataset } from "./datasets";
import { resolveEndpoint } from "./endpoints";
import { currentModelSnapshot, explicitSnapshot, modelSnapshot } from "./models";
import { stageCallConfig, writeCallConfig } from "./callConfig";
import * as agent from "./externalAgent";
import { readTraceVar } from "./trace";
import * as registry from "./runRegistry";
import { avg, chosenMetrics, llmMetrics, parseCase, scoreCaseAsync, toScore } from "./ragas";
import type { CaseScore } from "./ragas";

// ---- current flow (node list) ----

export async function getCurrentFlow(): Promise<FlowCurrent> {
  return readConn(async (conn) => {
    // Distinct NODE_NM ordered by first appearance; latest version per node.
    const res = await conn.execute(
      `SELECT PROMPT_ID, NODE_NM, VERSION_NO, MODEL_NM, CRT_TM
         FROM PTX_PROMPT_HIS
        ORDER BY CRT_TM DESC, PROMPT_ID DESC`,
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

/**
 * What this run pins its models to. A run tab always sends a selection — every
 * role, exactly as shown — so that is taken literally. Only a caller that sends
 * none at all falls back to the saved role defaults.
 */
async function runModels(
  conn: OracleConnection,
  sel: ModelSelection | null | undefined,
): Promise<string | null> {
  return sel ? explicitSnapshot(sel) : modelSnapshot(conn);
}

async function fetchRun(conn: OracleConnection, runId: number): Promise<RagasRunOut | null> {
  const res = await conn.execute(`SELECT ${RUN_COLS} FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? mapRagasRun(rows[0]) : null;
}

async function promptNode(conn: OracleConnection, promptId: number): Promise<string | null> {
  const res = await conn.execute(`SELECT NODE_NM FROM PTX_PROMPT_HIS WHERE PROMPT_ID = :id`, { id: promptId });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? String(rows[0].NODE_NM) : null;
}

/**
 * Settle which folder a run covers. null = the whole dataset.
 *
 * An empty folder is refused rather than started: a run over zero cases
 * finishes instantly with no rows and every score null, which reads in the
 * records list exactly like a run that failed.
 */
async function runCaseType(
  conn: OracleConnection,
  datasetId: number,
  requested: string | null | undefined,
): Promise<string | null> {
  const ct = (requested ?? "").trim();
  if (!ct) return null;
  const res = await conn.execute(
    `SELECT COUNT(*) AS N FROM PTX_DATASET_DET
      WHERE DATASET_ID = :id AND NVL(TYPE_CD, 'NORMAL') = :ct`,
    { id: datasetId, ct },
  );
  const n = Number(((res.rows ?? []) as Record<string, unknown>[])[0]?.N ?? 0);
  if (n === 0) throw badRequest(`'${ct}' 폴더에 케이스가 없습니다`);
  return ct;
}

// ---- create runs ----

export async function createFlowRagasRun(args: {
  datasetId: number;
  caseType?: string | null;
  metrics: string[];
  nodeNm?: string | null;
  promptId?: number | null;
  score?: boolean;
  models?: ModelSelection | null;
}): Promise<RagasRunOut> {
  await requireDataset(args.datasetId);
  return withConn(async (conn, oracle) => {
    const caseType = await runCaseType(conn, args.datasetId, args.caseType);
    if (args.promptId != null) {
      const nm = await promptNode(conn, args.promptId);
      if (nm === null || (args.nodeNm != null && nm !== args.nodeNm)) {
        throw notFound(`prompt version ${args.promptId} not found for node ${JSON.stringify(args.nodeNm)}`);
      }
    }
    // METRIC_CTN='[]' marks a no-scoring run (answers only); chosenMetrics never
    // returns [] so the marker can't collide with a real selection.
    const chosen = args.score === false ? [] : chosenMetrics(args.metrics);
    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_RUN_MAS (PROMPT_ID, DATASET_ID, DATASET_NM, TYPE_CD, STATUS_CD, METRIC_CTN, MODEL_CTN, USER_ID)
       VALUES (:pid, :did, (SELECT DATASET_NM FROM PTX_DATASET_MAS WHERE DATASET_ID = :did),
               :ctype, 'PENDING', :metrics, :models, :cby) RETURNING RUN_ID INTO :out_id`,
      {
        pid: args.promptId ?? null,
        did: args.datasetId,
        ctype: caseType,
        metrics: JSON.stringify(chosen),
        models: await runModels(conn, args.models),
        cby: SYSTEM_USER,
      },
    );
    return (await fetchRun(conn, id))!;
  }, { commit: true });
}

export async function createFlowRagasAbRun(args: {
  datasetId: number;
  caseType?: string | null;
  nodeNm?: string | null;
  promptIdA?: number | null;
  promptIdB?: number | null;
  metrics: string[];
  score?: boolean;
  modelsA?: ModelSelection | null;
  modelsB?: ModelSelection | null;
}): Promise<{ ragas_run_a_id: number; ragas_run_b_id: number }> {
  await requireDataset(args.datasetId);
  return withConn(async (conn, oracle) => {
    // Both sides get the same category — an A/B over two different case
    // sets would not be a comparison.
    const caseType = await runCaseType(conn, args.datasetId, args.caseType);
    // Prompt versions are optional: an A/B may instead pin each side to its own
    // endpoint (base_url passed on the run's stream), in which case there is no
    // version to swap and PROMPT_ID stays null.
    for (const pid of [args.promptIdA, args.promptIdB]) {
      if (pid == null) continue;
      const nm = await promptNode(conn, pid);
      if (nm === null || (args.nodeNm != null && nm !== args.nodeNm)) {
        throw notFound(`prompt version ${pid} not found for node ${JSON.stringify(args.nodeNm)}`);
      }
    }
    const chosen = args.score === false ? [] : chosenMetrics(args.metrics);
    // Each side pins its own models, which is the only way a model-vs-model
    // comparison can work: one shared setting would hand both sides the same
    // value. The Compare tab pre-fills both from the defaults, so leaving them alone
    // varies the prompt/endpoint and nothing else.
    const ids: number[] = [];
    for (const [pid, models] of [
      [args.promptIdA ?? null, await runModels(conn, args.modelsA)],
      [args.promptIdB ?? null, await runModels(conn, args.modelsB)],
    ] as [number | null, string | null][]) {
      const id = await insertReturningId(
        conn,
        oracle,
        `INSERT INTO PTX_RUN_MAS (PROMPT_ID, DATASET_ID, DATASET_NM, TYPE_CD, STATUS_CD, METRIC_CTN, MODEL_CTN, USER_ID)
         VALUES (:pid, :did, (SELECT DATASET_NM FROM PTX_DATASET_MAS WHERE DATASET_ID = :did),
                 :ctype, 'PENDING', :metrics, :models, :cby) RETURNING RUN_ID INTO :out_id`,
        {
          pid, did: args.datasetId, ctype: caseType,
          metrics: JSON.stringify(chosen), models, cby: SYSTEM_USER,
        },
      );
      ids.push(id);
    }
    const group = ids[0];
    await conn.execute(`UPDATE PTX_RUN_MAS SET AB_GROUP_ID = :g WHERE RUN_ID IN (:a, :b)`, {
      g: group,
      a: ids[0],
      b: ids[1],
    });
    return { ragas_run_a_id: ids[0], ragas_run_b_id: ids[1] };
  }, { commit: true });
}

// ---- direct external-API calls (recorded as ENGINE_CD='direct') ----

const DIRECT_ENGINE = "direct";
/** ENGINE_CD value for a run scored only by 정답 일치 (no judge LLM involved). */
const EXACT_ENGINE = "exact";

async function directSinkDatasetId(conn: OracleConnection, oracle: OracleModule): Promise<number> {
  const res = await conn.execute(
    `SELECT DATASET_ID FROM PTX_DATASET_MAS WHERE DATASET_NM = :nm AND ACTIVE_YN = 'N' FETCH FIRST 1 ROWS ONLY`,
    { nm: DIRECT_SINK_NM },
  );
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  if (rows.length) return Number(rows[0].DATASET_ID);
  return insertReturningId(
    conn,
    oracle,
    `INSERT INTO PTX_DATASET_MAS (DATASET_NM, DESC_CTN, ACTIVE_YN, USER_ID)
     VALUES (:nm, :descr, 'N', :cby) RETURNING DATASET_ID INTO :out_id`,
    { nm: DIRECT_SINK_NM, descr: "직접 호출 기록 전용 (자동 생성, 목록 비표시)", cby: SYSTEM_USER },
  );
}

/** Make the one call, with the requested prompt version swapped active for its
 * duration. Same swap a dataset run performs — a manual message aimed at a
 * version has to hit the same agent state a dataset run would. Without a
 * version there is nothing to swap: the endpoint answers as it stands. */
async function callForPrompt(
  args: Parameters<typeof agent.runDirect>[0] & { promptId?: number | null },
): Promise<agent.AgentAnswer> {
  if (args.promptId == null) return agent.runDirect(args);
  return withConn(async (conn) => {
    const nm = await promptNode(conn, args.promptId!);
    if (nm === null) throw notFound(`prompt version ${args.promptId} not found`);
    await swapActive(conn, nm, args.promptId!);
    try {
      return await agent.runDirect(args);
    } finally {
      await deactivateNode(conn, nm);
    }
  });
}

export interface DirectRunResult extends agent.AgentAnswer {
  run_id: number;
  scores: CaseScore | null;
  score_error: string | null;
  /** Intermediate variable the agent captured for this call, if any. Same
   * mechanism a dataset run uses: a row in PTX_TRACE_HIS under our TRACE_ID.
   * null when the node wrote nothing — then the answer is all there is. */
  trace_var_nm: string | null;
  trace_value: string | null;
  /** Wall time of the endpoint call, in ms. Scoring is not counted. */
  elapsed_ms: number;
}

export interface DirectRunArgs {
  message: string;
  promptId?: number | null;
  /** Which registered endpoint (PTX_ENDPOINT_MAS) answers. Resolved into the URL
   * and headers below before the call — the screen only ever sends the id. */
  endpointId?: number | null;
  baseUrl?: string | null;
  headers?: EndpointHeader[] | null;
  authKey?: string | null;
  userId?: string | null;
  side?: agent.FlowSide | null;
  score?: boolean;
  metrics?: string[];
  expectedOutput?: string | null;
  models?: ModelSelection | null;
}

export async function recordDirectRun(argsIn: DirectRunArgs): Promise<DirectRunResult> {
  // A picked endpoint decides both the URL and the headers, so it is resolved
  // once here rather than re-read at each layer below.
  const picked = await resolveEndpoint(argsIn.endpointId);
  if (argsIn.endpointId != null && !picked) {
    throw notFound(`등록되지 않은 API입니다: ${argsIn.endpointId}`);
  }
  const args: DirectRunArgs = picked
    ? { ...argsIn, baseUrl: picked.url, headers: picked.headers }
    : argsIn;
  // What the run tab had on screen. No selection at all (a caller outside the
  // tabs) falls back to the saved role defaults.
  const models = args.models ? explicitSnapshot(args.models) : await currentModelSnapshot();
  // Issued up front so the config can be staged under it before the call. The run
  // row does not exist yet — RUN_ID is backfilled once it does.
  const callId = agent.nextTraceId();
  await stageCallConfig(callId, null, models);
  // Same measurement a dataset case gets: the endpoint call alone.
  const startedAt = Date.now();
  const data = await callForPrompt({ ...args, traceId: callId });
  const elapsedMs = Date.now() - startedAt;
  // Read before scoring: when the node captured a variable, that is what the
  // case is judged on, exactly as in a dataset run.
  const captured = await readConn((conn) => readTraceVar(conn, callId), null);
  // Optional inline scoring — a single case whose ground truth is whatever the
  // caller typed as the expected answer (blank → gt-based metrics stay null).
  const groundTruth = args.expectedOutput?.trim() ? args.expectedOutput : null;
  const metrics: RagasMetric[] = args.score ? chosenMetrics(args.metrics ?? []) : [];
  const llm = llmMetrics(metrics);
  let scores: CaseScore | null = null;
  let scoreErr: string | null = null;
  let engine: "RAGAS" | "FALLBACK" | null = null;
  if (llm.length) {
    engine = resolveRagasEngine();
    try {
      scores = await scoreCaseAsync({
        question: args.message,
        answer: data.response,
        contexts: data.docs,
        groundTruth,
        metrics: llm,
        engine,
      });
    } catch (e) {
      scoreErr = errorText(e).slice(0, 1000);
    }
  }
  // unwrapBody must stay off for a captured variable — its own `body` key is
  // real data, not the endpoint envelope.
  const em = metrics.includes(EXACT_MATCH)
    ? exactMatchScore(captured ? captured.ctn : data.response, groundTruth, { unwrapBody: !captured })
    : null;
  const dec = (m: LlmMetric) => (scores ? toScore(scores[m] ?? null) : null);
  const runId = await withConn(async (conn, oracle) => {
    const sinkId = await directSinkDatasetId(conn, oracle);
    const runId = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_RUN_MAS (PROMPT_ID, DATASET_ID, DATASET_NM, STATUS_CD, ENGINE_CD, METRIC_CTN, MODEL_CTN, USER_ID, START_TM, END_TM,
                                 EXACT_VAL, FAITH_VAL, ANS_RELEVANCY_VAL, CNTX_PRECISION_VAL, CNTX_RECALL_VAL, ANS_CORRECTNESS_VAL)
       VALUES (:pid, :did, :dnm, 'DONE', :eng, :met, :models, :cby, SYSTIMESTAMP, SYSTIMESTAMP, :em, :f, :ar, :cp, :cr, :ac)
       RETURNING RUN_ID INTO :out_id`,
      {
        // Which version answered — a manual call aimed at a version is otherwise
        // indistinguishable in Records from one aimed at the endpoint.
        pid: args.promptId ?? null,
        did: sinkId,
        dnm: DIRECT_SINK_NM,
        eng: engine ?? (metrics.length ? EXACT_ENGINE : DIRECT_ENGINE),
        met: metrics.length ? JSON.stringify(metrics) : "[]",
        models,
        cby: SYSTEM_USER,
        em,
        f: dec("faithfulness"),
        ar: dec("answer_relevancy"),
        cp: dec("context_precision"),
        cr: dec("context_recall"),
        ac: dec("answer_correctness"),
      },
    );
    await conn.execute(
      `INSERT INTO PTX_RUN_DET (RUN_ID, CASE_ID, QUESTION_CTN, ANSWER_CTN, CNTX_CTN, TRUTH_CTN, ERROR_CTN, ELAPSED_MS,
                                    TRACE_ID, TRACE_VAR_NM, TRACE_CTN,
                                    EXACT_VAL, FAITH_VAL, ANS_RELEVANCY_VAL, CNTX_PRECISION_VAL, CNTX_RECALL_VAL, ANS_CORRECTNESS_VAL)
       VALUES (:rid, NULL, :q, :a, :ctx, :gt, :err, :el, :tid, :tvar, :tctn, :em, :f, :ar, :cp, :cr, :ac)`,
      {
        rid: runId,
        q: args.message,
        a: data.response,
        tid: callId,
        tvar: captured?.varNm ?? null,
        // Snapshot — PTX_TRACE_HIS gets purged on retention, run records do not.
        tctn: captured?.ctn ?? null,
        ctx: JSON.stringify(data.docs),
        gt: groundTruth,
        err: scoreErr,
        el: elapsedMs,
        em,
        f: dec("faithfulness"),
        ar: dec("answer_relevancy"),
        cp: dec("context_precision"),
        cr: dec("context_recall"),
        ac: dec("answer_correctness"),
      },
    );
    // Backfill the staged row now that there is a run to attach it to, so it is
    // cleaned up with the record instead of lingering as an orphan.
    await conn.execute(`UPDATE PTX_CALL_MAS SET RUN_ID = :rid WHERE TRACE_ID = :t`, {
      rid: runId,
      t: callId,
    });
    return runId;
  }, { commit: true });
  // score_error rides back with the answer: the call succeeded, so failing
  // silently here would show a blank score block with no reason.
  const trace = { trace_var_nm: captured?.varNm ?? null, trace_value: captured?.ctn ?? null };
  if (!metrics.length) {
    return { ...data, ...trace, run_id: runId, elapsed_ms: elapsedMs, scores: null, score_error: null };
  }
  return {
    ...data,
    ...trace,
    run_id: runId,
    elapsed_ms: elapsedMs,
    scores: { ...(scores ?? {}), ...(metrics.includes(EXACT_MATCH) ? { exact_match: em } : {}) },
    score_error: scoreErr,
  };
}

/** One typed message, answered by two targets and recorded as an A/B pair.
 * Sequential on purpose: a prompt-version side swaps ACTIVE_YN globally, so
 * overlapping the calls would let B answer under A's prompt. The two runs are
 * linked by AB_GROUP_ID so Records reads them as one comparison. */
export async function recordDirectAbRun(args: {
  message: string;
  score?: boolean;
  metrics?: string[];
  expectedOutput?: string | null;
  a: Pick<DirectRunArgs, "promptId" | "endpointId" | "baseUrl" | "authKey" | "userId" | "models">;
  b: Pick<DirectRunArgs, "promptId" | "endpointId" | "baseUrl" | "authKey" | "userId" | "models">;
}): Promise<{ a: DirectRunResult; b: DirectRunResult }> {
  const common = {
    message: args.message,
    score: args.score,
    metrics: args.metrics,
    expectedOutput: args.expectedOutput,
  };
  // Say which side broke. Both sides run the same message, so an unlabelled
  // "답변 호출 실패" leaves the user guessing which endpoint or version is at fault.
  const sideRun = async (tag: string, a: DirectRunArgs) => {
    try {
      return await recordDirectRun(a);
    } catch (e) {
      throw new ApiError(502, `${tag} — ${errorText(e)}`);
    }
  };
  const a = await sideRun("A", { ...common, ...args.a, side: "a" });
  const b = await sideRun("B", { ...common, ...args.b, side: "b" });
  await withConn(async (conn) => {
    await conn.execute(`UPDATE PTX_RUN_MAS SET AB_GROUP_ID = :g WHERE RUN_ID IN (:a, :b)`, {
      g: a.run_id,
      a: a.run_id,
      b: b.run_id,
    });
  }, { commit: true });
  return { a, b };
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
    await conn.execute(`UPDATE PTX_RUN_MAS SET STATUS_CD = 'CANCELLING' WHERE RUN_ID = :id`, { id: runId });
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

/** caseType null = the whole dataset. NVL: rows predating the category default
 * can hold NULL, and those are 미분류 like any other uncategorised case. */
async function loadCases(
  conn: OracleConnection,
  datasetId: number,
  caseType: string | null,
): Promise<CaseRow[]> {
  const res = await conn.execute(
    `SELECT CASE_ID, INPUT_CTN, EXPECT_CTN FROM PTX_DATASET_DET
      WHERE DATASET_ID = :id${caseType ? " AND NVL(TYPE_CD, 'NORMAL') = :ct" : ''}
      ORDER BY CASE_ID ASC`,
    caseType ? { id: datasetId, ct: caseType } : { id: datasetId },
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => ({
    case_id: Number(r.CASE_ID),
    input_data: String(r.INPUT_CTN ?? ""),
    expected_output: r.EXPECT_CTN != null ? String(r.EXPECT_CTN) : null,
  }));
}

async function isCancelRequested(conn: OracleConnection, runId: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return true;
  const res = await conn.execute(`SELECT STATUS_CD FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length > 0 && rows[0].STATUS_CD === "CANCELLING";
}

async function fetchResultRow(conn: OracleConnection, resultId: number): Promise<RagasResultRow> {
  const { RESULT_COLS, mapRagasResult } = await import("@/lib/db/rows");
  const res = await conn.execute(`SELECT ${RESULT_COLS} FROM PTX_RUN_DET WHERE RESULT_ID = :id`, {
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
  await conn.execute(`UPDATE PTX_PROMPT_HIS SET ACTIVE_YN = 'N' WHERE NODE_NM = :nm`, { nm: nodeNm });
  await conn.execute(`UPDATE PTX_PROMPT_HIS SET ACTIVE_YN = 'Y' WHERE PROMPT_ID = :id`, { id: promptId });
  await conn.commit();
}

async function deactivateNode(conn: OracleConnection, nodeNm: string): Promise<void> {
  await conn.execute(`UPDATE PTX_PROMPT_HIS SET ACTIVE_YN = 'N' WHERE NODE_NM = :nm`, { nm: nodeNm });
  await conn.commit();
}

interface RunCtx {
  runId: number;
  engine: "RAGAS" | "FALLBACK";
  /** false = answers-only run (METRIC_CTN='[]'): phase2 is skipped entirely. */
  score: boolean;
  metrics: RagasMetric[];
  /** Metrics that need the judge LLM — empty for a 정답 일치 only run. */
  llm: LlmMetric[];
  /** true when 정답 일치 is selected (scored inline in phase 1). */
  exact: boolean;
  /** Endpoint URL this run calls; null = the side's config URL. */
  baseUrl: string | null;
  /** Headers of the registered endpoint this run picked, when it picked one. */
  headers: EndpointHeader[] | null;
  /** Which configured endpoint this run calls (agent.a.url / agent.b.url). */
  side: agent.FlowSide | null;
  /** role→model JSON stamped on the run row at creation, replayed on every call
   * of this run. Read back from the row rather than recomputed so a mid-run edit
   * to the role defaults cannot change what half the cases ran under. */
  models: string | null;
  cases: CaseRow[];
  swapNode: string | null;
  /** Has any case captured an intermediate variable? null until the first case
   * answers. false skips the commit-race wait for the rest of the run. */
  traceSeen: boolean | null;
  pending: Pending[];
  sums: Record<RagasMetric, number[]>;
  cancelled: boolean;
}

async function setupRun(
  conn: OracleConnection,
  oracle: OracleModule,
  runId: number,
  emit: Emit,
  baseUrl: string | null,
  headers: EndpointHeader[] | null,
  side: agent.FlowSide | null,
): Promise<RunCtx | null> {
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
  // METRIC_CTN='[]' = answers-only run: skip scoring later and leave ENGINE_CD empty.
  let parsedMetrics: string[] | null = null;
  try {
    parsedMetrics = run.metrics ? (JSON.parse(run.metrics) as string[]) : null;
  } catch {
    parsedMetrics = null;
  }
  const score = !(parsedMetrics && parsedMetrics.length === 0);
  const metrics = score ? chosenMetrics(parsedMetrics ?? [...ALL_METRICS]) : [];
  const llm = llmMetrics(metrics);
  const exact = metrics.includes(EXACT_MATCH);
  const engine = resolveRagasEngine();
  // A run scored only by 정답 일치 never touches the judge LLM, so it records
  // ENGINE_CD='exact' rather than claiming RAGAS/FALLBACK.
  await conn.execute(
    `UPDATE PTX_RUN_MAS SET STATUS_CD = 'RUNNING', START_TM = SYSTIMESTAMP${score ? ", ENGINE_CD = :eng" : ""} WHERE RUN_ID = :id`,
    score ? { eng: llm.length ? engine : EXACT_ENGINE, id: runId } : { id: runId },
  );
  await conn.commit();
  const cases = await loadCases(conn, run.dataset_id, run.case_type);
  emit({ event: "RUNNING", run_id: runId, total: cases.length, metrics });

  // No prompt version on the run (A/B pinned to two endpoints) → nothing to swap:
  // the endpoint itself is the version under test.
  let swapNode: string | null = null;
  if (run.prompt_id) {
    const nm = await promptNode(conn, run.prompt_id);
    if (nm) {
      await swapActive(conn, nm, run.prompt_id);
      swapNode = nm;
    }
  }

  const sums = Object.fromEntries(ALL_METRICS.map((m) => [m, [] as number[]])) as Record<RagasMetric, number[]>;
  return {
    runId, engine, score, metrics, llm, exact, baseUrl, headers, side, cases, swapNode,
    models: run.model_snapshot,
    traceSeen: null, pending: [], sums, cancelled: false,
  };
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
    let traceId: string | null = null;
    // The id is issued here, not inside the client, because the model config has
    // to be staged (and committed) under it before the request goes out.
    const callId = agent.nextTraceId();
    await writeCallConfig(conn, callId, ctx.runId, ctx.models);
    // Timed around the endpoint call alone — the config staging above and the
    // trace read below are ours, not the agent's, and would muddy the number.
    const startedAt = Date.now();
    let elapsedMs: number;
    try {
      const data = await agent.flowAnswer(message, ctx.baseUrl, ctx.side, callId, ctx.headers);
      elapsedMs = Date.now() - startedAt;
      answer = data.response;
      traceId = data.traceId ?? null;
      if (!contexts.length && data.docs.length) contexts = data.docs;
    } catch (e) {
      // A failure took time too — for a timeout that time IS the finding.
      elapsedMs = Date.now() - startedAt;
      error = true;
      answer = null;
      errMsg = errorText(e).slice(0, 1000);
      traceId = agent.errorTraceId(e);
    }
    // Some nodes are judged on a variable the response never carries — the agent
    // committed it to PTX_TRACE_HIS under this TRACE_ID. A row existing IS the
    // signal; nothing is configured per node or per case. Only the first case
    // waits out the commit race, so runs that never capture anything (the nodes
    // judged on their final answer) pay that wait once, not per case.
    const captured = await readTraceVar(conn, traceId, ctx.traceSeen !== false);
    if (captured) ctx.traceSeen = true;
    else if (ctx.traceSeen === null) ctx.traceSeen = false;
    else if (ctx.traceSeen && errMsg === null) {
      // The node records on every call, so a run that captured before and not now
      // died ahead of the capture. Say so — otherwise the answer is scored against
      // a ground truth meant for the variable and the X looks unexplained.
      errMsg = "트레이스 없음 — 최종 답변으로 채점됨";
    }
    // 정답 일치 needs no LLM, so it is decided here with the answer instead of
    // waiting for the scoring phase. A captured variable is scored even when the
    // call failed: the node may have committed it before dying downstream.
    const em =
      ctx.exact && (captured !== null || !error)
        ? exactMatchScore(captured ? captured.ctn : answer, fields.groundTruth, { unwrapBody: !captured })
        : null;
    if (em !== null) ctx.sums[EXACT_MATCH].push(em);
    const resultId = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_RUN_DET (RUN_ID, CASE_ID, QUESTION_CTN, CNTX_CTN, TRUTH_CTN, ANSWER_CTN, ERROR_CTN, EXACT_VAL,
                                TRACE_ID, TRACE_VAR_NM, TRACE_CTN, ELAPSED_MS)
       VALUES (:rid, :cid, :q, :ctx, :gt, :a, :err, :em, :tid, :tvar, :tctn, :el) RETURNING RESULT_ID INTO :out_id`,
      {
        rid: ctx.runId,
        cid: c.case_id,
        q: fields.question,
        ctx: JSON.stringify(contexts),
        gt: fields.groundTruth,
        a: answer,
        err: errMsg,
        em,
        tid: traceId,
        tvar: captured?.varNm ?? null,
        // Snapshot — PTX_TRACE_HIS gets purged on retention, run records do not.
        tctn: captured?.ctn ?? null,
        el: elapsedMs,
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

/** Why a case ended up with no RAGAS score even though nothing errored.
 * faithfulness needs contexts; context_precision/recall need both contexts and a
 * ground truth; answer_correctness needs a ground truth; answer_relevancy needs
 * the embedding endpoint. */
function skipReason(contexts: string[], groundTruth: string | null): string {
  const missing: string[] = [];
  if (contexts.join("").trim() === "") missing.push("contexts");
  if (!(groundTruth ?? "").trim()) missing.push("정답(ground truth)");
  const why = missing.length
    ? `케이스에 ${missing.join(" · ")}이(가) 없어 해당 지표를 건너뛰었습니다.`
    : "심판이 유효한 점수를 반환하지 않았습니다.";
  return `채점된 지표가 없습니다 — ${why}`;
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
          metrics: ctx.llm,
          engine: ctx.engine,
        });
        const sets: string[] = [];
        const binds: Record<string, unknown> = { id: p.resultId };
        let stored = false;
        for (const m of ctx.llm) {
          const dec = toScore(cs[m] ?? null);
          if (dec !== null) {
            sets.push(`${METRIC_COLS[m]} = :${m}`);
            binds[m] = dec;
            ctx.sums[m].push(dec);
            stored = true;
          }
        }
        if (stored) {
          await conn.execute(`UPDATE PTX_RUN_DET SET ${sets.join(", ")} WHERE RESULT_ID = :id`, binds);
        } else {
          // Nothing threw, so every selected metric simply had nothing to work
          // with. Say which input was missing — a blank score column with no
          // explanation reads as "RAGAS is broken".
          await conn.execute(`UPDATE PTX_RUN_DET SET ERROR_CTN = :err WHERE RESULT_ID = :id`, {
            err: skipReason(p.contexts, p.groundTruth),
            id: p.resultId,
          });
        }
      } catch (e) {
        // Per-case scoring failure (e.g. LLM/embedding call failed) — record and continue.
        await conn.execute(`UPDATE PTX_RUN_DET SET ERROR_CTN = :err WHERE RESULT_ID = :id`, {
          err: errorText(e).slice(0, 1000),
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
    // Per-case scores computed before the stop stay exactly as they are — they
    // were real judgements on real answers, and throwing them away is what makes
    // a cancelled run useless to look at afterwards.
    //
    // The run-level averages stay NULL on purpose: an average over whatever
    // prefix happened to finish is not this dataset's score, and in Records it
    // would sit in the same column as fully scored runs.
    await conn.execute(`UPDATE PTX_RUN_MAS SET STATUS_CD = 'CANCELLED', END_TM = SYSTIMESTAMP WHERE RUN_ID = :id`, {
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
    sets.push(`${METRIC_COLS[m]} = :${m}`);
    binds[m] = a;
    summary[m] = a;
  }
  await conn.execute(
    `UPDATE PTX_RUN_MAS SET STATUS_CD = 'DONE', END_TM = SYSTIMESTAMP, ${sets.join(", ")} WHERE RUN_ID = :id`,
    binds,
  );
  await conn.commit();
  emit({
    event: "DONE",
    run_id: ctx.runId,
    engine: ctx.score ? (ctx.llm.length ? ctx.engine : EXACT_ENGINE) : null,
    summary,
  });
}

async function recordFailure(conn: OracleConnection, runId: number, msg: string, emit: Emit): Promise<void> {
  try {
    await conn.execute(
      `UPDATE PTX_RUN_MAS SET STATUS_CD = 'FAILED', ERROR_CTN = :err, END_TM = SYSTIMESTAMP WHERE RUN_ID = :id`,
      { err: msg.slice(0, 1000), id: runId },
    );
    await conn.execute(`INSERT INTO PTX_RUN_DET (RUN_ID, ERROR_CTN) VALUES (:id, :err)`, {
      id: runId,
      err: msg.slice(0, 1000),
    });
    await conn.commit();
  } catch {
    /* best effort */
  }
  emit({ event: "FAILED", run_id: runId, error: msg });
}

/** What endpoint a run talks to: the registered one it picked, or — when it
 * picked none — the side's configured endpoint. */
export interface RunEndpointOpts {
  endpointId?: number | null;
  baseUrl?: string | null;
  side?: agent.FlowSide | null;
}

/** Execute a single flow RAGAS run, streaming events via ``emit``. */
export async function executeRun(
  runId: number,
  emit: Emit,
  signal?: AbortSignal,
  opts?: RunEndpointOpts,
): Promise<void> {
  // Resolved once per run: every case of the run then calls the same endpoint
  // with the same headers, even if the registry is edited mid-run.
  const picked = await resolveEndpoint(opts?.endpointId);
  await withConn(async (conn, oracle) => {
    let ctx: RunCtx | null = null;
    try {
      ctx = await setupRun(
        conn,
        oracle,
        runId,
        emit,
        picked?.url ?? opts?.baseUrl ?? null,
        picked?.headers ?? null,
        opts?.side ?? null,
      );
      if (!ctx) return;
      try {
        await phase1(conn, oracle, ctx, emit, signal);
        if (!ctx.cancelled && ctx.score && ctx.llm.length) await phase2(conn, ctx, emit, signal);
      } finally {
        if (ctx.swapNode) await deactivateNode(conn, ctx.swapNode);
      }
      await finalize(conn, ctx, emit);
    } catch (e) {
      await recordFailure(conn, runId, errorText(e), emit);
    }
  });
}

/** A run left RUNNING with nothing driving it — the process that owned it is
 * gone. Re-executing would append a second set of PTX_RUN_DET rows, so it is
 * failed instead and the answers already stored stay readable. */
const INTERRUPTED = "실행이 중단되었습니다 (서버 재시작 등). 다시 실행해 주세요.";

async function runStatus(runId: number): Promise<string | null> {
  return readConn(async (conn) => {
    const res = await conn.execute(`SELECT STATUS_CD FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
    const rows = (res.rows ?? []) as Record<string, unknown>[];
    return rows.length ? String(rows[0].STATUS_CD) : null;
  }, null as string | null);
}

async function markInterrupted(runId: number): Promise<void> {
  await withConn(async (conn) => {
    await conn.execute(
      `UPDATE PTX_RUN_MAS SET STATUS_CD = 'FAILED', ERROR_CTN = :err, END_TM = SYSTIMESTAMP
        WHERE RUN_ID = :id AND STATUS_CD NOT IN ('DONE', 'FAILED', 'CANCELLED')`,
      { err: INTERRUPTED, id: runId },
    );
  }, { commit: true });
}

/**
 * Drive one SSE connection for ``runId``: start the run if it hasn't started,
 * attach to it if it is already going, or replay its ending if it has finished.
 *
 * The returned promise settles when the run reaches a terminal event or the
 * client disconnects (``signal``). Disconnecting only detaches this listener —
 * the run itself keeps going, which is what makes a refresh survivable.
 */
export async function streamRun(
  runId: number,
  emit: Emit,
  signal?: AbortSignal,
  opts?: RunEndpointOpts,
): Promise<void> {
  if (!registry.isLive(runId)) {
    const status = await runStatus(runId);
    if (status === null) {
      emit({ event: "FAILED", run_id: runId, error: "ragas run not found" });
      return;
    }
    if (status === "RUNNING" || status === "CANCELLING") {
      await markInterrupted(runId);
      emit({ event: "FAILED", run_id: runId, error: INTERRUPTED });
      return;
    }
    if (status !== "PENDING") {
      // Already DONE/FAILED/CANCELLED → executeRun replays the terminal event.
      await executeRun(runId, emit, undefined, opts);
      return;
    }
    registry.startRun(runId, (e) => executeRun(runId, e, undefined, opts));
  }

  await new Promise<void>((resolve) => {
    let unsub: (() => void) | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsub?.();
      resolve();
    };
    unsub = registry.subscribe(runId, (e) => {
      emit(e);
      if (registry.isTerminalEvent(e)) finish();
    });
    // Replay above may already have delivered the terminal event.
    if (settled || !unsub) {
      unsub?.();
      resolve();
      return;
    }
    if (signal) {
      if (signal.aborted) finish();
      else signal.addEventListener("abort", finish, { once: true });
    }
  });
}

/** Resolve an A/B group's two run ids and execute them (used by the SSE route). */
export async function executeAbGroup(groupId: number, emit: Emit, signal?: AbortSignal): Promise<void> {
  const ids = await readConn(async (conn) => {
    const res = await conn.execute(
      `SELECT RUN_ID FROM PTX_RUN_MAS WHERE AB_GROUP_ID = :g ORDER BY RUN_ID ASC`,
      { g: groupId },
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => Number(r.RUN_ID));
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
      const sides: agent.FlowSide[] = ["a", "b"];
      for (const [i, id] of [aId, bId].entries()) {
        ctxs.push(await setupRun(conn, oracle, id, emit, null, null, sides[i]));
      }
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
        if (!ctx || ctx.cancelled || !ctx.score || !ctx.llm.length) continue;
        await phase2(conn, ctx, emit, signal);
      }
      for (const ctx of ctxs) {
        if (!ctx) continue;
        await finalize(conn, ctx, emit);
      }
    } catch (e) {
      for (const id of [aId, bId]) await recordFailure(conn, id, errorText(e), emit);
    }
  });
}
