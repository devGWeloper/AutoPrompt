// Flow-centric, single-project types (CHAT_VER_MAS / NODE_MAS + PM_* versioning).

export interface FlowNode {
  node_mas_id: number;
  node_nm: string;
  node_desc: string | null;
  model_nm: string | null;
  prompt_edit_enable_yn: 'Y' | 'N';
  model_edit_enable_yn: 'Y' | 'N';
  main_model_edit_enable_yn: 'Y' | 'N';
  has_prompt: boolean; // LLM/prompt node
  active_prompt_id: number | null;
  active_version_no: string | null;
}

export interface FlowCurrent {
  chat_ver_id: number;
  flow_version_no: string | null;
  main_model_nm: string | null;
  main_model_editable: boolean;
  graph_struct: string | null;
  nodes: FlowNode[];
}

export interface FlowVersionSummary {
  flow_ver_id: number;
  chat_ver_id: number;
  flow_version_no: string;
  is_active: 'Y' | 'N';
  change_summary: string | null;
  created_by: string;
  created_dt: string;
}

export interface FlowVersionNode {
  node_mas_id: number;
  node_nm: string;
  prompt_id: number | null;
  version_no: string | null;
}

export interface FlowVersionDetail extends FlowVersionSummary {
  graph_struct: string | null;
  main_model_nm: string | null;
  change_reason: string | null;
  nodes: FlowVersionNode[];
}

export interface PromptVersionSummary {
  prompt_id: number;
  node_mas_id: number;
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
  temperature: number | null;
  max_tokens: number | null;
  top_p: number | null;
  extra_params: Record<string, unknown> | null;
  change_reason: string | null;
  prev_prompt_id: number | null;
  updated_dt: string | null;
}

export interface PromptVersionCreate {
  system_prompt: string;
  user_prompt: string;
  version_no?: string;
  model_nm?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  top_p?: number | null;
  extra_params?: Record<string, unknown> | null;
  change_summary: string;
  change_reason: string;
  prev_prompt_id?: number | null;
  activate_after_save?: boolean;
}

export interface ActivePrompt {
  node_mas_id: number;
  node_nm: string;
  prompt_id: number;
  version_no: string;
  system_prompt: string | null;
  user_prompt: string | null;
  model_nm: string | null;
}

export interface PromptDiffLine {
  tag: 'equal' | 'insert' | 'delete' | 'replace';
  a_line: string | null;
  b_line: string | null;
}

export interface PromptDiffSection {
  added: number;
  removed: number;
  unified: string;
  lines: PromptDiffLine[];
}

export interface PromptDiff {
  v1_prompt_id: number;
  v2_prompt_id: number;
  system_prompt: PromptDiffSection;
  user_prompt: PromptDiffSection;
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

export interface TestRunOut {
  run_id: number;
  run_type: string;
  node_mas_id: number | null;
  chat_ver_id: number | null;
  prompt_id: number | null;
  dataset_id: number | null;
  ab_group_id: number | null;
  status: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  avg_latency_ms: number | null;
  total_tokens: number | null;
  started_dt: string | null;
  ended_dt: string | null;
  created_by: string;
  created_dt: string;
}

export interface TestResultRow {
  result_id: number;
  run_id: number;
  case_id: number | null;
  input_data: string | null;
  actual_output: string | null;
  is_passed: string | null;
  eval_detail: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_msg: string | null;
}

export interface TestRunDetail extends TestRunOut {
  results: TestResultRow[];
}

export interface FlowTestRequest {
  inputs: Record<string, string>;
}

export interface SingleTestRunResult {
  actual_output: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  model: string;
}

/** Unified WS message for node single-run + full-flow runs. */
export type RunWsMessage =
  | { event: 'RUNNING'; run_id: number; total?: number }
  | {
      event: 'PROGRESS';
      run_id: number;
      done: number;
      total: number;
      case_id: number | null;
      is_passed: string | null;
    }
  | {
      event: 'NODE_DONE';
      run_id: number;
      node_nm?: string;
      output?: string;
      latency_ms?: number;
      tokens?: number;
    }
  | {
      event: 'DONE';
      run_id: number;
      output?: string;
      result?: SingleTestRunResult;
      summary?: Record<string, number | null>;
      engine?: string;
    }
  | { event: 'FAILED'; run_id: number; error: string };

// ---- test hub: datasets / cases / ragas ----

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
  node_mas_id: number | null;
  prompt_id: number | null;
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
  node_mas_id: number | null;
  prompt_id: number | null;
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
