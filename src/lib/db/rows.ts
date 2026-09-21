// Shared SQL fragments + row→domain mappers for the PTX_* tables. oracledb returns
// rows as objects with UPPERCASE column keys (see db.ts outFormat); CLOBs come
// back as strings and timestamps are TO_CHAR'd to ISO strings in the SELECTs.

import { hasColumn } from "@/lib/db/optionalColumn";
import { DIRECT_SINK_NM } from "@/lib/types";
import type {
  ActivePrompt,
  AuditLog,
  Dataset,
  Endpoint,
  EndpointHeader,
  LlmModel,
  ModelRole,
  PromptVersionDetail,
  PromptVersionSummary,
  RagasResultRow,
  RagasRunOut,
  RagasRunSummary,
  TestCase,
} from "@/lib/types";
import type { OracleConnection, OracleModule } from "@/lib/db";

type Row = Record<string, unknown>;

export function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** TO_CHAR a DATE/TIMESTAMP column to an ISO-ish string, aliased back to the
 * same name. No fractional seconds (FF) so the same format works for plain DATE
 * columns too (FF on a DATE raises ORA-01821). */
export function tsCol(col: string): string {
  return `TO_CHAR(${col}, 'YYYY-MM-DD"T"HH24:MI:SS') AS ${col}`;
}

/** tsCol 과 같되 밀리초까지 — 실행 전체 소요시간을 소수점 둘째 자리까지 재려면 초
 * 단위로 잘린 시각으로는 늘 .00 이 된다. TIMESTAMP 컬럼(START_TM · END_TM)에만
 * 쓴다: DATE 컬럼에 FF 를 붙이면 ORA-01821 이 난다. */
export function tsColMs(col: string): string {
  return `TO_CHAR(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS ${col}`;
}

/**
 * Run an INSERT ... RETURNING <pk> INTO :out_id and return the new id. ``sql``
 * must end with the RETURNING clause binding :out_id; other binds are passed in.
 */
export async function insertReturningId(
  conn: OracleConnection,
  oracle: OracleModule,
  sql: string,
  binds: Record<string, unknown>,
): Promise<number> {
  const res = await conn.execute(sql, {
    ...binds,
    out_id: { dir: oracle.BIND_OUT, type: oracle.NUMBER },
  });
  const out = (res.outBinds as { out_id: number[] }).out_id;
  return Number(out[0]);
}

// ---- column lists ----

export const PROMPT_COLS_SUMMARY = [
  "PROMPT_ID",
  "NODE_NM",
  "VERSION_NO",
  "ACTIVE_YN",
  "MODEL_NM",
  "SUMMARY_CTN",
  "USER_ID",
  tsCol("CRT_TM"),
].join(", ");

export const PROMPT_COLS_DETAIL = [
  "PROMPT_ID",
  "NODE_NM",
  "VERSION_NO",
  "ACTIVE_YN",
  "MODEL_NM",
  "SUMMARY_CTN",
  "REASON_CTN",
  "PREV_PROMPT_ID",
  "SYSTEM_CTN",
  "USER_CTN",
  "USER_ID",
  tsCol("CRT_TM"),
  tsCol("UPDATE_TM"),
].join(", ");

export const DATASET_COLS = [
  "DATASET_ID",
  "DATASET_NM",
  "DESC_CTN",
  "ACTIVE_YN",
  "USER_ID",
  tsCol("CRT_TM"),
].join(", ");

export const CASE_COLS = [
  "CASE_ID",
  "DATASET_ID",
  "INPUT_CTN",
  "EXPECT_CTN",
  "CRITERIA_CTN",
  "TYPE_CD",
  "USER_ID",
  tsCol("CRT_TM"),
].join(", ");

/** Metric key → its score column. The column names are abbreviated, so this map
 * is the one place the two are tied together (nothing derives one from the other). */
export const METRIC_COLS: Record<string, string> = {
  exact_match: "EXACT_VAL",
  faithfulness: "FAITH_VAL",
  answer_relevancy: "ANS_RELEVANCY_VAL",
  context_precision: "CNTX_PRECISION_VAL",
  context_recall: "CNTX_RECALL_VAL",
  answer_correctness: "ANS_CORRECTNESS_VAL",
};

const RUN_SCORE_COLS = Object.values(METRIC_COLS);

const RUN_COLS = [
  "RUN_ID",
  "PROMPT_ID",
  "AB_GROUP_ID",
  "DATASET_ID",
  "DATASET_NM",
  "TYPE_CD",
  "STATUS_CD",
  "ENGINE_CD",
  "METRIC_CTN",
  "JUDGE_PROVIDER_CD",
  "JUDGE_MODEL_NM",
  "MODEL_CTN",
  "ENDPOINT_NM",
  "ENDPOINT_URL",
  ...RUN_SCORE_COLS,
  "ERROR_CTN",
  tsColMs("START_TM"),
  tsColMs("END_TM"),
  "USER_ID",
  tsCol("CRT_TM"),
].join(", ");

export const RESULT_COLS = [
  "RESULT_ID",
  "RUN_ID",
  "CASE_ID",
  "QUESTION_CTN",
  "ANSWER_CTN",
  "CNTX_CTN",
  "TRUTH_CTN",
  ...RUN_SCORE_COLS,
  "ERROR_CTN",
  "TRACE_VAR_NM",
  "TRACE_CTN",
  "ELAPSED_MS",
  // 이 줄이 쓰인 시각. 제자리 재실행은 다시 돌린 케이스의 행을 지우고 새로 쓰므로,
  // 실행의 최초 종료 시각보다 늦게 쓰인 줄이 곧 '이번에 다시 돌린 것' 이다 —
  // 어느 케이스를 다시 돌렸는지 따로 저장하지 않고도 나중에 읽어낼 수 있다.
  tsColMs("CRT_TM"),
].join(", ");

/**
 * RESULT_COLS plus TTFT_MS where the database has it.
 *
 * The column arrives by migration (`sql/migrate_ttft_ms.sql`), and naming it in
 * a SELECT against a database without it fails the whole query with ORA-00904.
 * Reading the catalogue once (cached per process) keeps every screen working on
 * both, with TTFT simply absent until the migration runs — `num(undefined)` is
 * null, so `mapRagasResult` needs no branch of its own.
 */
export async function resultCols(conn: OracleConnection): Promise<string> {
  const cols = [RESULT_COLS];
  if (await hasColumn(conn, "PTX_RUN_DET", "TTFT_MS")) cols.push("TTFT_MS");
  // 수동 통과 처리 (sql/migrate_run_det_pass.sql). 없으면 통과시킨 케이스가
  // 하나도 없는 것과 같이 보인다 — 버튼도 서지 않는다.
  if (await hasColumn(conn, "PTX_RUN_DET", "PASS_YN")) cols.push("PASS_YN", tsCol("PASS_TM"));
  return cols.join(", ");
}

/**
 * 사람이 통과시킨 케이스를 1 로 친 '정답 일치' 값의 SQL 식.
 *
 * 채점 결과(EXACT_VAL)와 사람의 판단(PASS_YN)은 따로 저장하고, 합쳐 읽어야 하는
 * 자리에서만 이 식으로 합친다 — 실행 단위 점수와 불일치 재실행 대상이 그 자리다.
 * 컬럼이 없는 DB 에서는 채점 결과 그대로다.
 */
export async function effectiveExactExpr(conn: OracleConnection, alias = ""): Promise<string> {
  const col = `${alias}EXACT_VAL`;
  return (await hasColumn(conn, "PTX_RUN_DET", "PASS_YN"))
    ? `CASE WHEN ${alias}PASS_YN = 'Y' THEN 1 ELSE ${col} END`
    : col;
}

/**
 * RUN_COLS plus the 최초 실행 구간, when this database has it.
 *
 * FIRST_START_TM / FIRST_END_TM arrive by migration (`sql/migrate_run_first_tm.sql`).
 * Without them a run only remembers its most recent span — which is what every
 * screen showed before re-runs existed — so the columns are read when present
 * and simply absent otherwise, the same way TTFT_MS is.
 */
export async function runCols(conn: OracleConnection): Promise<string> {
  return (await hasColumn(conn, "PTX_RUN_MAS", "FIRST_START_TM"))
    ? `${RUN_COLS}, ${tsColMs("FIRST_START_TM")}, ${tsColMs("FIRST_END_TM")}`
    : RUN_COLS;
}

export const MODEL_COLS = [
  "MODEL_ID",
  "ROLE_CD",
  "MODEL_NM",
  "TEMPERATURE",
  "DESC_CTN",
  "USER_ID",
  tsCol("UPDATE_TM"),
  tsCol("CRT_TM"),
].join(", ");

export const AUDIT_COLS = [
  "LOG_ID",
  "TARGET_TABLE_NM",
  "TARGET_ID",
  "ACTION_CD",
  "BEFORE_CTN",
  "AFTER_CTN",
  "USER_ID",
  tsCol("CRT_TM"),
].join(", ");

// ---- mappers ----

export function mapPromptSummary(r: Row): PromptVersionSummary {
  return {
    prompt_id: num(r.PROMPT_ID)!,
    node_nm: String(r.NODE_NM),
    version_no: String(r.VERSION_NO),
    is_active: r.ACTIVE_YN === "Y" ? "Y" : "N",
    model_nm: str(r.MODEL_NM),
    change_summary: str(r.SUMMARY_CTN),
    created_by: String(r.USER_ID),
    created_dt: String(r.CRT_TM),
  };
}

export function mapPromptDetail(r: Row): PromptVersionDetail {
  return {
    ...mapPromptSummary(r),
    change_reason: str(r.REASON_CTN),
    prev_prompt_id: num(r.PREV_PROMPT_ID),
    system_prompt: str(r.SYSTEM_CTN),
    user_prompt: str(r.USER_CTN),
    updated_dt: str(r.UPDATE_TM),
  };
}

export function mapActivePrompt(r: Row): ActivePrompt {
  return {
    node_nm: String(r.NODE_NM),
    prompt_id: num(r.PROMPT_ID)!,
    version_no: String(r.VERSION_NO),
    model_nm: str(r.MODEL_NM),
    system_prompt: str(r.SYSTEM_CTN),
    user_prompt: str(r.USER_CTN),
  };
}

export function mapModelRole(r: Row): ModelRole {
  return {
    model_id: num(r.MODEL_ID)!,
    role_cd: String(r.ROLE_CD),
    model_nm: str(r.MODEL_NM),
    temperature: num(r.TEMPERATURE),
    description: str(r.DESC_CTN),
    updated_by: String(r.USER_ID),
    updated_dt: str(r.UPDATE_TM),
    created_dt: String(r.CRT_TM),
  };
}

export function mapDataset(r: Row): Dataset {
  const d: Dataset = {
    dataset_id: num(r.DATASET_ID)!,
    dataset_nm: String(r.DATASET_NM),
    description: str(r.DESC_CTN),
    is_active: r.ACTIVE_YN === "N" ? "N" : "Y",
    created_by: String(r.USER_ID),
    created_dt: String(r.CRT_TM),
  };
  // Only the list query selects CASE_CNT; leave it undefined elsewhere rather
  // than reporting a confident 0.
  if (r.CASE_CNT !== undefined) d.case_count = num(r.CASE_CNT) ?? 0;
  return d;
}

export function mapCase(r: Row): TestCase {
  return {
    case_id: num(r.CASE_ID)!,
    dataset_id: num(r.DATASET_ID)!,
    input_data: String(r.INPUT_CTN ?? ""),
    expected_output: str(r.EXPECT_CTN),
    eval_criteria: str(r.CRITERIA_CTN),
    case_type: String(r.TYPE_CD ?? "NORMAL"),
    created_by: String(r.USER_ID),
    created_dt: String(r.CRT_TM),
  };
}

export function mapRagasRun(r: Row): RagasRunOut {
  return {
    ragas_run_id: num(r.RUN_ID)!,
    prompt_id: num(r.PROMPT_ID),
    ab_group_id: num(r.AB_GROUP_ID),
    node_nm: null,
    version_no: null,
    dataset_id: num(r.DATASET_ID)!,
    case_type: str(r.TYPE_CD),
    status: String(r.STATUS_CD),
    engine: str(r.ENGINE_CD),
    metrics: str(r.METRIC_CTN),
    judge_provider: str(r.JUDGE_PROVIDER_CD),
    judge_model: str(r.JUDGE_MODEL_NM),
    model_snapshot: str(r.MODEL_CTN),
    // 이 실행이 부른 API. 등록 목록에서 고른 것이면 이름이, 직접 URL 로 부른
    // 것이면 URL 만 남는다. 두 컬럼이 생기기 전의 실행은 둘 다 NULL 이다.
    endpoint_nm: str(r.ENDPOINT_NM),
    endpoint_url: str(r.ENDPOINT_URL),
    exact_match: num(r.EXACT_VAL),
    faithfulness: num(r.FAITH_VAL),
    answer_relevancy: num(r.ANS_RELEVANCY_VAL),
    context_precision: num(r.CNTX_PRECISION_VAL),
    context_recall: num(r.CNTX_RECALL_VAL),
    answer_correctness: num(r.ANS_CORRECTNESS_VAL),
    error_msg: str(r.ERROR_CTN),
    started_dt: str(r.START_TM),
    ended_dt: str(r.END_TM),
    // runCols() 가 붙였을 때만 온다 — 없는 DB 에서는 undefined → null.
    first_started_dt: str(r.FIRST_START_TM),
    first_ended_dt: str(r.FIRST_END_TM),
    created_by: String(r.USER_ID),
    created_dt: String(r.CRT_TM),
  };
}

export function mapRagasRunSummary(r: Row): RagasRunSummary {
  const run = mapRagasRun(r);
  return {
    ragas_run_id: run.ragas_run_id,
    prompt_id: run.prompt_id,
    ab_group_id: run.ab_group_id,
    node_nm: run.node_nm,
    version_no: run.version_no,
    // DATASET_NM is a snapshot on the run itself (survives dataset deletion);
    // FIRST_QUESTION only comes from listRuns' SELECT.
    dataset_nm: str(r.DATASET_NM),
    // DATASET_DESC 도 FIRST_QUESTION 과 같이 listRuns 의 SELECT 에서만 온다.
    dataset_desc: str(r.DATASET_DESC),
    case_type: run.case_type,
    // CASE_CNT 도 FIRST_QUESTION 과 같이 listRuns 의 SELECT 에서만 온다.
    case_count: num(r.CASE_CNT),
    metrics: run.metrics,
    first_question: str(r.FIRST_QUESTION),
    is_manual: str(r.DATASET_NM) === DIRECT_SINK_NM,
    status: run.status,
    engine: run.engine,
    model_snapshot: run.model_snapshot,
    endpoint_nm: run.endpoint_nm,
    endpoint_url: run.endpoint_url,
    exact_match: run.exact_match,
    faithfulness: run.faithfulness,
    answer_relevancy: run.answer_relevancy,
    context_precision: run.context_precision,
    context_recall: run.context_recall,
    answer_correctness: run.answer_correctness,
    error_msg: run.error_msg,
    started_dt: run.started_dt,
    ended_dt: run.ended_dt,
    first_started_dt: run.first_started_dt,
    first_ended_dt: run.first_ended_dt,
    created_dt: run.created_dt,
  };
}

export function mapRagasResult(r: Row): RagasResultRow {
  return {
    ragas_result_id: num(r.RESULT_ID)!,
    ragas_run_id: num(r.RUN_ID)!,
    case_id: num(r.CASE_ID),
    question: str(r.QUESTION_CTN),
    answer: str(r.ANSWER_CTN),
    contexts: str(r.CNTX_CTN),
    ground_truth: str(r.TRUTH_CTN),
    exact_match: num(r.EXACT_VAL),
    faithfulness: num(r.FAITH_VAL),
    answer_relevancy: num(r.ANS_RELEVANCY_VAL),
    context_precision: num(r.CNTX_PRECISION_VAL),
    context_recall: num(r.CNTX_RECALL_VAL),
    answer_correctness: num(r.ANS_CORRECTNESS_VAL),
    error_msg: str(r.ERROR_CTN),
    // Set only when the agent captured an intermediate variable for this call —
    // then the score compared this, not ANSWER_CTN.
    trace_var_nm: str(r.TRACE_VAR_NM),
    trace_value: str(r.TRACE_CTN),
    // null on rows written before the column existed — the UI just shows nothing.
    elapsed_ms: num(r.ELAPSED_MS),
    // Also null when the endpoint did not stream this call: no first token, so
    // nothing to time. Absent entirely until the migration runs.
    ttft_ms: num(r.TTFT_MS),
    created_dt: str(r.CRT_TM),
    // 사람이 손으로 통과시킨 케이스. exact_match 는 채점이 내린 판정 그대로 남아
    // 있어서, 무엇이 걸렸던 건지는 펼쳐 보면 여전히 읽을 수 있다.
    passed: str(r.PASS_YN) === "Y",
    passed_dt: str(r.PASS_TM),
  };
}

export function mapAudit(r: Row): AuditLog {
  return {
    log_id: num(r.LOG_ID)!,
    target_table: String(r.TARGET_TABLE_NM),
    target_id: num(r.TARGET_ID)!,
    action: String(r.ACTION_CD),
    before_value: str(r.BEFORE_CTN),
    after_value: str(r.AFTER_CTN),
    created_by: String(r.USER_ID),
    created_dt: String(r.CRT_TM),
  };
}

export const ENDPOINT_COLS = [
  "ENDPOINT_ID",
  "ENDPOINT_NM",
  "ENDPOINT_URL",
  "HEADER_CTN",
  "DESC_CTN",
  "ACTIVE_YN",
  "USER_ID",
  tsCol("UPDATE_TM"),
  tsCol("CRT_TM"),
].join(", ");

export const LLM_COLS = [
  "LLM_ID",
  "LLM_NM",
  "DESC_CTN",
  "ACTIVE_YN",
  "USER_ID",
  tsCol("UPDATE_TM"),
  tsCol("CRT_TM"),
].join(", ");

/** HEADER_CTN 은 [{name,value}] JSON. 깨진 값이 목록 전체를 못 열게 만들지 않도록
 * 파싱 실패는 '헤더 없음'으로 떨어뜨린다. */
function parseHeaders(raw: unknown): EndpointHeader[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((h): h is EndpointHeader => !!h && typeof h === "object" && typeof (h as EndpointHeader).name === "string")
      .map((h) => ({ name: String(h.name), value: String(h.value ?? "") }))
      .filter((h) => h.name.trim() !== "");
  } catch {
    return [];
  }
}

export function mapEndpoint(r: Row): Endpoint {
  return {
    endpoint_id: num(r.ENDPOINT_ID)!,
    endpoint_nm: String(r.ENDPOINT_NM),
    endpoint_url: String(r.ENDPOINT_URL),
    headers: parseHeaders(r.HEADER_CTN),
    description: str(r.DESC_CTN),
    is_active: r.ACTIVE_YN === "N" ? "N" : "Y",
    updated_by: String(r.USER_ID),
    updated_dt: str(r.UPDATE_TM),
    created_dt: String(r.CRT_TM),
  };
}

export function mapLlmModel(r: Row): LlmModel {
  return {
    llm_id: num(r.LLM_ID)!,
    llm_nm: String(r.LLM_NM),
    description: str(r.DESC_CTN),
    is_active: r.ACTIVE_YN === "N" ? "N" : "Y",
    updated_by: String(r.USER_ID),
    updated_dt: str(r.UPDATE_TM),
    created_dt: String(r.CRT_TM),
  };
}
