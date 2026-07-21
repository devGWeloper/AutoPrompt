// Shared SQL fragments + row→domain mappers for the PM_* tables. oracledb returns
// rows as objects with UPPERCASE column keys (see db.ts outFormat); CLOBs come
// back as strings and timestamps are TO_CHAR'd to ISO strings in the SELECTs.

import type {
  ActivePrompt,
  AuditLog,
  Dataset,
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
  "IS_ACTIVE",
  "MODEL_NM",
  "CHANGE_SUMMARY",
  "CREATED_BY",
  tsCol("CREATED_DT"),
].join(", ");

export const PROMPT_COLS_DETAIL = [
  "PROMPT_ID",
  "NODE_NM",
  "VERSION_NO",
  "IS_ACTIVE",
  "MODEL_NM",
  "CHANGE_SUMMARY",
  "CHANGE_REASON",
  "PREV_PROMPT_ID",
  "SYSTEM_PROMPT",
  "USER_PROMPT",
  "CREATED_BY",
  tsCol("CREATED_DT"),
  tsCol("UPDATED_DT"),
].join(", ");

export const DATASET_COLS = [
  "DATASET_ID",
  "DATASET_NM",
  "DESCRIPTION",
  "IS_ACTIVE",
  "CREATED_BY",
  tsCol("CREATED_DT"),
].join(", ");

export const CASE_COLS = [
  "CASE_ID",
  "DATASET_ID",
  "INPUT_DATA",
  "EXPECTED_OUTPUT",
  "EVAL_CRITERIA",
  "CASE_TYPE",
  "CREATED_BY",
  tsCol("CREATED_DT"),
].join(", ");

const RUN_SCORE_COLS = [
  "FAITHFULNESS",
  "ANSWER_RELEVANCY",
  "CONTEXT_PRECISION",
  "CONTEXT_RECALL",
  "ANSWER_CORRECTNESS",
];

export const RUN_COLS = [
  "RAGAS_RUN_ID",
  "PROMPT_ID",
  "AB_GROUP_ID",
  "DATASET_ID",
  "STATUS",
  "ENGINE",
  "METRICS",
  "JUDGE_PROVIDER",
  "JUDGE_MODEL",
  ...RUN_SCORE_COLS,
  "ERROR_MSG",
  tsCol("STARTED_DT"),
  tsCol("ENDED_DT"),
  "CREATED_BY",
  tsCol("CREATED_DT"),
].join(", ");

export const RESULT_COLS = [
  "RAGAS_RESULT_ID",
  "RAGAS_RUN_ID",
  "CASE_ID",
  "QUESTION",
  "ANSWER",
  "CONTEXTS",
  "GROUND_TRUTH",
  ...RUN_SCORE_COLS,
  "ERROR_MSG",
].join(", ");

export const AUDIT_COLS = [
  "LOG_ID",
  "TARGET_TABLE",
  "TARGET_ID",
  "ACTION",
  "BEFORE_VALUE",
  "AFTER_VALUE",
  "CREATED_BY",
  tsCol("CREATED_DT"),
].join(", ");

// ---- mappers ----

export function mapPromptSummary(r: Row): PromptVersionSummary {
  return {
    prompt_id: num(r.PROMPT_ID)!,
    node_nm: String(r.NODE_NM),
    version_no: String(r.VERSION_NO),
    is_active: r.IS_ACTIVE === "Y" ? "Y" : "N",
    model_nm: str(r.MODEL_NM),
    change_summary: str(r.CHANGE_SUMMARY),
    created_by: String(r.CREATED_BY),
    created_dt: String(r.CREATED_DT),
  };
}

export function mapPromptDetail(r: Row): PromptVersionDetail {
  return {
    ...mapPromptSummary(r),
    change_reason: str(r.CHANGE_REASON),
    prev_prompt_id: num(r.PREV_PROMPT_ID),
    system_prompt: str(r.SYSTEM_PROMPT),
    user_prompt: str(r.USER_PROMPT),
    updated_dt: str(r.UPDATED_DT),
  };
}

export function mapActivePrompt(r: Row): ActivePrompt {
  return {
    node_nm: String(r.NODE_NM),
    prompt_id: num(r.PROMPT_ID)!,
    version_no: String(r.VERSION_NO),
    model_nm: str(r.MODEL_NM),
    system_prompt: str(r.SYSTEM_PROMPT),
    user_prompt: str(r.USER_PROMPT),
  };
}

export function mapDataset(r: Row): Dataset {
  return {
    dataset_id: num(r.DATASET_ID)!,
    dataset_nm: String(r.DATASET_NM),
    description: str(r.DESCRIPTION),
    is_active: r.IS_ACTIVE === "N" ? "N" : "Y",
    created_by: String(r.CREATED_BY),
    created_dt: String(r.CREATED_DT),
  };
}

export function mapCase(r: Row): TestCase {
  return {
    case_id: num(r.CASE_ID)!,
    dataset_id: num(r.DATASET_ID)!,
    input_data: String(r.INPUT_DATA ?? ""),
    expected_output: str(r.EXPECTED_OUTPUT),
    eval_criteria: str(r.EVAL_CRITERIA),
    case_type: String(r.CASE_TYPE ?? "NORMAL"),
    created_by: String(r.CREATED_BY),
    created_dt: String(r.CREATED_DT),
  };
}

export function mapRagasRun(r: Row): RagasRunOut {
  return {
    ragas_run_id: num(r.RAGAS_RUN_ID)!,
    prompt_id: num(r.PROMPT_ID),
    ab_group_id: num(r.AB_GROUP_ID),
    node_nm: null,
    version_no: null,
    dataset_id: num(r.DATASET_ID)!,
    status: String(r.STATUS),
    engine: str(r.ENGINE),
    metrics: str(r.METRICS),
    judge_provider: str(r.JUDGE_PROVIDER),
    judge_model: str(r.JUDGE_MODEL),
    faithfulness: num(r.FAITHFULNESS),
    answer_relevancy: num(r.ANSWER_RELEVANCY),
    context_precision: num(r.CONTEXT_PRECISION),
    context_recall: num(r.CONTEXT_RECALL),
    answer_correctness: num(r.ANSWER_CORRECTNESS),
    error_msg: str(r.ERROR_MSG),
    started_dt: str(r.STARTED_DT),
    ended_dt: str(r.ENDED_DT),
    created_by: String(r.CREATED_BY),
    created_dt: String(r.CREATED_DT),
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
    status: run.status,
    engine: run.engine,
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
    ragas_result_id: num(r.RAGAS_RESULT_ID)!,
    ragas_run_id: num(r.RAGAS_RUN_ID)!,
    case_id: num(r.CASE_ID),
    question: str(r.QUESTION),
    answer: str(r.ANSWER),
    contexts: str(r.CONTEXTS),
    ground_truth: str(r.GROUND_TRUTH),
    faithfulness: num(r.FAITHFULNESS),
    answer_relevancy: num(r.ANSWER_RELEVANCY),
    context_precision: num(r.CONTEXT_PRECISION),
    context_recall: num(r.CONTEXT_RECALL),
    answer_correctness: num(r.ANSWER_CORRECTNESS),
    error_msg: str(r.ERROR_MSG),
  };
}

export function mapAudit(r: Row): AuditLog {
  return {
    log_id: num(r.LOG_ID)!,
    target_table: String(r.TARGET_TABLE),
    target_id: num(r.TARGET_ID)!,
    action: String(r.ACTION),
    before_value: str(r.BEFORE_VALUE),
    after_value: str(r.AFTER_VALUE),
    created_by: String(r.CREATED_BY),
    created_dt: String(r.CREATED_DT),
  };
}
