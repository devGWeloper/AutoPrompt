// Flow-centric, single-project types (CHAT_VER_MAS / NODE_MAS + PM_* versioning).

export interface FlowNode {
  node_mas_id: number;
  node_nm: string;
  node_desc: string | null;
  has_prompt: boolean; // LLM/prompt node (PROMPT_EDIT_ENABLE_YN == 'Y')
  active_prompt_id: number | null;
  active_version_no: string | null;
}

export interface FlowCurrent {
  chat_ver_id: number;
  nodes: FlowNode[];
}

export interface PromptVersionSummary {
  prompt_id: number;
  node_mas_id: number;
  node_nm: string;
  version_no: string;
  is_active: 'Y' | 'N';
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
  node_mas_id: number | null;
  scope: string;
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
  chat_ver_id: number | null;
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
  | { event: 'DONE'; run_id: number; engine?: string; summary?: Record<string, number | null> }
  | { event: 'FAILED'; run_id: number; error: string };
