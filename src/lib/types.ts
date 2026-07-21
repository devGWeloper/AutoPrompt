// Domain types shared by server (route handlers / services) and client (pages).
// Node identity is NODE_NM (PM is self-contained; no external anchors). Metric
// scores are plain numbers (0..1) or null; timestamps are ISO strings.

export const SYSTEM_USER = "system";

// ---- RAGAS metrics ----

export const ALL_METRICS = [
  "faithfulness",
  "answer_relevancy",
  "context_precision",
  "context_recall",
  "answer_correctness",
] as const;
export type RagasMetric = (typeof ALL_METRICS)[number];

export const RAGAS_METRICS = ALL_METRICS;

export const METRIC_LABELS: Record<RagasMetric, string> = {
  faithfulness: "Faithfulness",
  answer_relevancy: "Answer Relevancy",
  context_precision: "Context Precision",
  context_recall: "Context Recall",
  answer_correctness: "Answer Correctness",
};

/** One-line hover explanations for each metric (used as `title` tooltips). */
export const METRIC_DESCRIPTIONS: Record<RagasMetric, string> = {
  faithfulness:
    "답변이 검색된 컨텍스트에 근거하고 있는가? 컨텍스트로 뒷받침되지 않는 주장이 있으면 점수가 낮아집니다 (환각 여부 체크).",
  answer_relevancy:
    "답변이 질문을 실제로 다루고 있는가? 동문서답이나 불필요한 내용이 많으면 점수가 낮아집니다.",
  context_precision:
    "검색된 컨텍스트가 질문과 관련이 있는가? 관련 없는 문서가 섞여 있으면 점수가 낮아집니다.",
  context_recall:
    "검색된 컨텍스트가 정답(ground truth)을 만드는 데 필요한 정보를 충분히 담고 있는가?",
  answer_correctness:
    "답변이 정답(ground truth)과 사실적·의미적으로 얼마나 가까운가? Ground truth가 있어야 채점됩니다.",
};

// ---- prompts / nodes ----

export interface FlowNode {
  node_nm: string;
  latest_prompt_id: number | null;
  latest_version_no: string | null;
  latest_model_nm: string | null;
}

export interface FlowCurrent {
  nodes: FlowNode[];
}

export interface PromptVersionSummary {
  prompt_id: number;
  node_nm: string;
  version_no: string;
  is_active: "Y" | "N";
  model_nm: string | null;
  change_summary: string | null;
  created_by: string;
  created_dt: string;
}

export interface PromptVersionDetail extends PromptVersionSummary {
  system_prompt: string | null;
  user_prompt: string | null;
  change_reason: string | null;
  prev_prompt_id: number | null;
  updated_dt: string | null;
}

export interface ActivePrompt {
  node_nm: string;
  prompt_id: number;
  version_no: string;
  model_nm: string | null;
  system_prompt: string | null;
  user_prompt: string | null;
}

export interface PromptVersionCreate {
  system_prompt: string;
  user_prompt: string;
  model_nm?: string | null;
  version_no?: string;
  change_summary: string;
  change_reason: string;
  prev_prompt_id?: number | null;
}

export interface NodeCreate extends PromptVersionCreate {
  node_nm: string;
}

export interface PromptVersionEdit {
  system_prompt: string;
  user_prompt: string;
  model_nm?: string | null;
  change_summary?: string | null;
  change_reason?: string | null;
}

// ---- diff ----

export interface PromptDiffLine {
  tag: "equal" | "insert" | "delete" | "replace";
  a_line?: string | null;
  b_line?: string | null;
}

export interface PromptDiffSection {
  added: number;
  removed: number;
  unified: string;
  lines: PromptDiffLine[];
}

export interface PromptDiffOut {
  v1_prompt_id: number;
  v2_prompt_id: number;
  system_prompt: PromptDiffSection;
  user_prompt: PromptDiffSection;
}

// ---- audit ----

export interface AuditLog {
  log_id: number;
  target_table: string;
  target_id: number;
  action: string;
  before_value: string | null;
  after_value: string | null;
  created_by: string;
  created_dt: string;
}

export interface AuditLogPage {
  total: number;
  page: number;
  size: number;
  items: AuditLog[];
}

// ---- datasets / cases ----

export interface Dataset {
  dataset_id: number;
  dataset_nm: string;
  description: string | null;
  is_active: "Y" | "N";
  created_by: string;
  created_dt: string;
}

export interface DatasetDetail extends Dataset {
  case_count: number;
}

export interface DatasetCreate {
  dataset_nm: string;
  description?: string | null;
}

export interface DatasetUpdate {
  dataset_nm?: string | null;
  description?: string | null;
  is_active?: "Y" | "N";
}

export interface TestCase {
  case_id: number;
  dataset_id: number;
  input_data: string;
  expected_output: string | null;
  eval_criteria: string | null;
  case_type: string;
  created_by: string;
  created_dt: string;
}

export interface CaseCreate {
  input_data: string;
  expected_output?: string | null;
  eval_criteria?: string | null;
  case_type?: string;
}

export interface CaseUpdate {
  input_data?: string;
  expected_output?: string | null;
  eval_criteria?: string | null;
  case_type?: string;
}

export interface CsvUploadResult {
  created: number;
  skipped: number;
  errors: string[];
}

// ---- ragas runs ----

export interface RagasResultRow {
  ragas_result_id: number;
  ragas_run_id: number;
  case_id: number | null;
  question: string | null;
  answer: string | null;
  contexts: string | null;
  ground_truth: string | null;
  faithfulness: number | null;
  answer_relevancy: number | null;
  context_precision: number | null;
  context_recall: number | null;
  answer_correctness: number | null;
  error_msg: string | null;
}

export interface RagasRunOut {
  ragas_run_id: number;
  prompt_id: number | null;
  ab_group_id: number | null;
  node_nm: string | null;
  version_no: string | null;
  dataset_id: number;
  status: string;
  engine: string | null; // 'direct' marks a raw external-API call (no scoring)
  metrics: string | null;
  judge_provider: string | null;
  judge_model: string | null;
  faithfulness: number | null;
  answer_relevancy: number | null;
  context_precision: number | null;
  context_recall: number | null;
  answer_correctness: number | null;
  error_msg: string | null;
  started_dt: string | null;
  ended_dt: string | null;
  created_by: string;
  created_dt: string;
}

export interface RagasRunDetail extends RagasRunOut {
  results: RagasResultRow[];
}

export interface RagasRunSummary {
  ragas_run_id: number;
  prompt_id: number | null;
  ab_group_id: number | null;
  node_nm: string | null;
  version_no: string | null;
  status: string;
  engine: string | null;
  faithfulness: number | null;
  answer_relevancy: number | null;
  context_precision: number | null;
  context_recall: number | null;
  answer_correctness: number | null;
  error_msg: string | null;
  created_dt: string;
}

// ---- flow requests / direct ----

export interface FlowRagasRequest {
  dataset_id: number;
  metrics?: string[];
  node_nm?: string | null;
  prompt_id?: number | null;
}

export interface FlowRagasAbRequest {
  dataset_id: number;
  node_nm: string;
  prompt_id_a: number;
  prompt_id_b: number;
  metrics?: string[];
}

export interface FlowRagasAbOut {
  ragas_run_a_id: number;
  ragas_run_b_id: number;
}

export interface DirectTestRequest {
  message: string;
  base_url?: string | null;
  auth_key?: string | null;
  user_id?: string | null;
}

export interface DirectTestOut {
  response: string;
  docs: string[];
  raw: Record<string, unknown> | unknown[] | string;
}

// ---- run progress events (SSE; same shape the old WebSocket used) ----

export type RunEvent =
  | { event: "RUNNING"; run_id: number; total?: number }
  | { event: "ANSWER"; run_id: number; done: number; total: number; case_id: number | null; result: RagasResultRow }
  | { event: "SCORE"; run_id: number; done: number; total: number; case_id: number | null; result: RagasResultRow }
  | { event: "DONE"; run_id: number; engine?: string | null; summary?: Record<string, number | null> }
  | { event: "CANCELLED"; run_id: number; summary?: Record<string, number | null> }
  | { event: "FAILED"; run_id: number; error: string };

/** Alias kept for the page code that still imports the old WebSocket name. */
export type RunWsMessage = RunEvent;
