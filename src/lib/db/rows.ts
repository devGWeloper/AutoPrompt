// Shared SQL fragments + row→domain mappers for the PTX_* tables. oracledb returns
// rows as objects with UPPERCASE column keys (see db.ts outFormat); CLOBs come
// back as strings and timestamps are TO_CHAR'd to ISO strings in the SELECTs.

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

export const RUN_COLS = [
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
  ...RUN_SCORE_COLS,
  "ERROR_CTN",
  tsCol("START_TM"),
  tsCol("END_TM"),
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
].join(", ");

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
    exact_match: num(r.EXACT_VAL),
    faithfulness: num(r.FAITH_VAL),
    answer_relevancy: num(r.ANS_RELEVANCY_VAL),
    context_precision: num(r.CNTX_PRECISION_VAL),
    context_recall: num(r.CNTX_RECALL_VAL),
    answer_correctness: num(r.ANS_CORRECTNESS_VAL),
    error_msg: str(r.ERROR_CTN),
    started_dt: str(r.START_TM),
    ended_dt: str(r.END_TM),
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
    case_type: run.case_type,
    // CASE_CNT 도 FIRST_QUESTION 과 같이 listRuns 의 SELECT 에서만 온다.
    case_count: num(r.CASE_CNT),
    metrics: run.metrics,
    first_question: str(r.FIRST_QUESTION),
    is_manual: str(r.DATASET_NM) === DIRECT_SINK_NM,
    status: run.status,
    engine: run.engine,
    model_snapshot: run.model_snapshot,
    exact_match: run.exact_match,
    faithfulness: run.faithfulness,
    answer_relevancy: run.answer_relevancy,
    context_precision: run.context_precision,
    context_recall: run.context_recall,
    answer_correctness: run.answer_correctness,
    error_msg: run.error_msg,
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
