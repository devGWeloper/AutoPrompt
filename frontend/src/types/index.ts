// PM-only types. Node identity is NODE_NM (no external CHAT_VER_MAS / NODE_MAS anchors).

export interface FlowNode {
  node_nm: string;
  active_prompt_id: number | null;
  active_version_no: string | null;
  active_model_nm: string | null;
}

export interface FlowCurrent {
  nodes: FlowNode[];
}

export interface PromptVersionSummary {
  prompt_id: number;
  node_nm: string;
  version_no: string;
  is_active: 'Y' | 'N';
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

export interface PromptVersionCreate {
  system_prompt: string;
  user_prompt: string;
  model_nm?: string | null;
  version_no?: string;
  change_summary: string;
  change_reason: string;
  prev_prompt_id?: number | null;
  activate_after_save?: boolean;
}

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

// ---- datasets / cases / ragas ----

export interface Dataset {
  dataset_id: number;
  dataset_nm: string;
  description: string | null;
  is_active: 'Y' | 'N';
  created_by: string;
  created_dt: string;
}

export interface DatasetDetail extends Dataset {
  case_count: number;
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

export const RAGAS_METRICS = [
  'faithfulness',
  'answer_relevancy',
  'context_precision',
  'context_recall',
  'answer_correctness',
] as const;
export type RagasMetric = (typeof RAGAS_METRICS)[number];

// Human-readable Korean labels for the RAGAS metrics. Used in score tables so
// the columns read as words instead of the truncated FAIT/ANSW/CONT/CONT/ANSW
// (context_precision vs context_recall both collapsed to "CONT" otherwise).
export const METRIC_LABELS: Record<RagasMetric, string> = {
  faithfulness: 'Faithfulness',
  answer_relevancy: 'Answer Relevancy',
  context_precision: 'Context Precision',
  context_recall: 'Context Recall',
  answer_correctness: 'Answer Correctness',
};

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
  engine: string | null;
  faithfulness: number | null;
  answer_relevancy: number | null;
  context_precision: number | null;
  context_recall: number | null;
  answer_correctness: number | null;
  error_msg: string | null;
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

/** WS messages for a RAGAS run (`/ws/ragas-runs/{id}`). */
export type RunWsMessage =
  | { event: 'RUNNING'; run_id: number; total?: number }
  | { event: 'PROGRESS'; run_id: number; done: number; total: number; case_id: number | null }
  // Phase 1: an external-agent answer was generated for a case (no scores yet).
  | { event: 'ANSWER'; run_id: number; done: number; total: number; case_id: number | null; result: RagasResultRow }
  // Phase 2: a case finished scoring (scores now present on the result row).
  | { event: 'SCORE'; run_id: number; done: number; total: number; case_id: number | null; result: RagasResultRow }
  | { event: 'DONE'; run_id: number; engine?: string; summary?: Record<string, number | null> }
  | { event: 'CANCELLED'; run_id: number; summary?: Record<string, number | null> }
  | { event: 'FAILED'; run_id: number; error: string };
