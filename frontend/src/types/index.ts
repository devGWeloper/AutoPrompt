export interface Project {
  project_id: number;
  project_nm: string;
  description: string | null;
  status: string;
  created_by: string;
  created_dt: string;
}

export interface ActivePromptSummary {
  prompt_id: number;
  version_no: string;
}

export interface ActiveModelSummary {
  model_provider: string;
  model_nm: string;
}

export type NodeType = 'START' | 'END' | 'LLM' | 'TOOL' | 'ROUTER' | string;

export interface GraphNode {
  node_id: number;
  project_id: number;
  node_key: string;
  node_nm: string;
  node_type: NodeType | null;
  pos_x: number | null;
  pos_y: number | null;
  description: string | null;
  active_prompt: ActivePromptSummary | null;
  active_model: ActiveModelSummary | null;
}

export interface GraphEdge {
  edge_id: number;
  project_id: number;
  source_node_id: number;
  target_node_id: number;
  label: string | null;
  condition_expr: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PromptVariable {
  var_name: string;
  var_type: string;
  description: string | null;
  default_value: string | null;
  is_required: 'Y' | 'N';
}

export interface PromptVersionSummary {
  prompt_id: number;
  node_id: number;
  version_no: string;
  is_active: 'Y' | 'N';
  model_provider: string;
  model_nm: string;
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
  variables: PromptVariable[];
}

export interface PromptVersionCreate {
  system_prompt: string;
  user_prompt: string;
  version_no?: string;
  model_provider: string;
  model_nm: string;
  temperature?: number | null;
  max_tokens?: number | null;
  top_p?: number | null;
  extra_params?: Record<string, unknown> | null;
  change_summary: string;
  change_reason: string;
  prev_prompt_id?: number | null;
  activate_after_save?: boolean;
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

export interface AuditLogPage {
  total: number;
  page: number;
  size: number;
  items: AuditLog[];
}

// ---- Phase 2: datasets / cases ----

export interface Dataset {
  dataset_id: number;
  node_id: number;
  dataset_nm: string;
  description: string | null;
  is_active: 'Y' | 'N';
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
  dataset_nm?: string;
  description?: string | null;
  is_active?: 'Y' | 'N';
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

// ---- Phase 2: single test run + WebSocket ----

export interface TestRunOut {
  run_id: number;
  run_type: string;
  node_id: number | null;
  prompt_id: number | null;
  dataset_id: number | null;
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

export interface TestRunResult {
  actual_output: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface TestResultRow {
  result_id: number;
  run_id: number;
  case_id: number | null;
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

export interface BatchTestRequest {
  prompt_id: number;
  dataset_id: number;
}

export interface ABTestRequest {
  prompt_id_a: number;
  prompt_id_b: number;
  dataset_id: number;
}

export interface ABRunOut {
  run_a_id: number;
  run_b_id: number;
}

export interface FlowRunRequest {
  variables: Record<string, string>;
}

/** Unified WS message for single / batch / flow runs. */
export type RunWsMessage =
  | { event: 'RUNNING'; run_id: number; total?: number; order?: number[] }
  | {
      event: 'PROGRESS';
      run_id: number;
      done: number;
      total: number;
      case_id: number | null;
      is_passed: string | null;
    }
  | { event: 'NODE_RUNNING'; run_id: number; node_id: number; node_key: string }
  | {
      event: 'NODE_DONE';
      run_id: number;
      node_id: number;
      node_key: string;
      output?: string;
      latency_ms?: number;
      tokens?: number;
      skipped?: boolean;
    }
  | {
      event: 'DONE';
      run_id: number;
      result?: TestRunResult;
      summary?: Record<string, number | null>;
      engine?: string;
    }
  | { event: 'FAILED'; run_id: number; node_id?: number; error: string };

// ---- Phase 4: RAGAS evaluation ----

export const RAGAS_METRICS = [
  'faithfulness',
  'answer_relevancy',
  'context_precision',
  'context_recall',
  'answer_correctness',
] as const;

export type RagasMetric = (typeof RAGAS_METRICS)[number];

export interface RagasRunRequest {
  prompt_id: number;
  dataset_id: number;
  metrics?: RagasMetric[];
  judge_provider?: string | null;
  judge_model?: string | null;
}

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
  node_id: number;
  prompt_id: number;
  dataset_id: number;
  status: string;
  engine: string | null;
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
  prompt_id: number;
  status: string;
  engine: string | null;
  faithfulness: number | null;
  answer_relevancy: number | null;
  context_precision: number | null;
  context_recall: number | null;
  answer_correctness: number | null;
  created_dt: string;
}
