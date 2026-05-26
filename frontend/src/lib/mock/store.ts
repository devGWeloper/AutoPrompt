// Demo mock store: in-memory seed data + generators that mimic the backend.
// Enabled via NEXT_PUBLIC_USE_MOCK (see ./index.ts). DB/LLM are NOT required —
// every screen runs off this module so `npm run dev` alone drives the demo.
//
// Everything here mirrors the shapes in `@/types`. State is held in a module
// global `store` so create/delete/activate during the demo actually stick.

import {
  RAGAS_METRICS,
  type AuditLog,
  type Dataset,
  type FlowCurrent,
  type FlowNode,
  type FlowVersionDetail,
  type FlowVersionSummary,
  type PromptVersionDetail,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type TestCase,
  type TestResultRow,
  type TestRunDetail,
} from '@/types';

// ---- helpers ---------------------------------------------------------------

const SYSTEM_USER = 'system';

/** Stable-ish timestamp strings for seed rows. */
function seedDt(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(10, 0, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
function nowDt(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Bump a "major.minor.patch" version one minor step (1.3.0 -> 1.4.0). */
export function bumpMinor(v: string | null): string {
  const [maj = '1', min = '0'] = (v ?? '1.0.0').split('.');
  return `${maj}.${Number(min) + 1}.0`;
}
function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---- id counters -----------------------------------------------------------

const seq = {
  prompt: 400,
  dataset: 10,
  case: 1000,
  log: 5000,
  run: 50,
  ragasRun: 50,
  result: 100000,
  ragasResult: 200000,
  flowVer: 100,
  abGroup: 10,
};
function nextId(k: keyof typeof seq): number {
  seq[k] += 1;
  return seq[k];
}

// ---- seed: flow graph + nodes ---------------------------------------------

// Node ids (== node_nm) double as the labels so the graph and the node panel /
// node-prompt screen show the same names. ('end' is a mermaid keyword — the
// terminal node stays 'done' to avoid a parse error.)
const GRAPH_STRUCT = `flowchart TD
    start([start]) --> router{router}
    router -->|docs needed| retrieve[retrieve]
    router -->|direct| generate
    retrieve --> rerank[rerank]
    rerank --> generate[generate]
    generate --> verify[verify]
    verify --> done([done])`;

const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'gemini-2.5-flash', 'gpt-4o'];

// node_mas_id must be stable; node_nm must equal the mermaid node id so the
// `click {node_nm} call __pmNodeClick()` directive wires up correctly.
const NODES: FlowNode[] = [
  { node_mas_id: 1, node_nm: 'start', node_desc: 'Flow entry point', model_nm: null, prompt_edit_enable_yn: 'N', model_edit_enable_yn: 'N', main_model_edit_enable_yn: 'N', has_prompt: false, active_prompt_id: null, active_version_no: null },
  { node_mas_id: 2, node_nm: 'router', node_desc: 'Classify question intent and route', model_nm: 'claude-sonnet-4-6', prompt_edit_enable_yn: 'Y', model_edit_enable_yn: 'N', main_model_edit_enable_yn: 'Y', has_prompt: true, active_prompt_id: 103, active_version_no: '1.2.0' },
  { node_mas_id: 3, node_nm: 'retrieve', node_desc: 'Vector store retrieval (RAG)', model_nm: null, prompt_edit_enable_yn: 'N', model_edit_enable_yn: 'N', main_model_edit_enable_yn: 'N', has_prompt: false, active_prompt_id: null, active_version_no: null },
  { node_mas_id: 4, node_nm: 'rerank', node_desc: 'Re-rank retrieved docs by relevance', model_nm: null, prompt_edit_enable_yn: 'N', model_edit_enable_yn: 'N', main_model_edit_enable_yn: 'N', has_prompt: false, active_prompt_id: null, active_version_no: null },
  { node_mas_id: 5, node_nm: 'generate', node_desc: 'Generate grounded answer', model_nm: 'claude-sonnet-4-6', prompt_edit_enable_yn: 'Y', model_edit_enable_yn: 'N', main_model_edit_enable_yn: 'Y', has_prompt: true, active_prompt_id: 203, active_version_no: '2.1.0' },
  { node_mas_id: 6, node_nm: 'verify', node_desc: 'Hallucination / grounding check', model_nm: 'gpt-4o', prompt_edit_enable_yn: 'Y', model_edit_enable_yn: 'Y', main_model_edit_enable_yn: 'N', has_prompt: true, active_prompt_id: 301, active_version_no: '1.0.0' },
  { node_mas_id: 7, node_nm: 'done', node_desc: 'Flow end', model_nm: null, prompt_edit_enable_yn: 'N', model_edit_enable_yn: 'N', main_model_edit_enable_yn: 'N', has_prompt: false, active_prompt_id: null, active_version_no: null },
];

const flowCurrent: FlowCurrent = {
  chat_ver_id: 1,
  flow_version_no: '1.3.0',
  main_model_nm: 'claude-sonnet-4-6',
  main_model_editable: true,
  graph_struct: GRAPH_STRUCT,
  nodes: NODES,
};

// ---- seed: prompt versions (per node) -------------------------------------

function pv(p: Partial<PromptVersionDetail> & {
  prompt_id: number; node_mas_id: number; node_nm: string; version_no: string;
  is_active: 'Y' | 'N'; system_prompt: string; user_prompt: string; created_dt: string;
}): PromptVersionDetail {
  return {
    model_nm: 'claude-sonnet-4-6',
    change_summary: null,
    created_by: SYSTEM_USER,
    temperature: 0.2,
    max_tokens: 1024,
    top_p: 1,
    extra_params: null,
    change_reason: null,
    prev_prompt_id: null,
    updated_dt: p.created_dt,
    ...p,
  } as PromptVersionDetail;
}

const promptVersions: Record<number, PromptVersionDetail[]> = {
  // router (node 2)
  2: [
    pv({ prompt_id: 103, node_mas_id: 2, node_nm: 'router', version_no: '1.2.0', is_active: 'Y',
      system_prompt: '당신은 사용자 질문을 분석해 처리 경로를 결정하는 라우터입니다.\n- 사내 문서/규정 관련 질문이면 "retrieve" 경로로 보냅니다.\n- 일반 상식/대화성 질문이면 "generate" 경로로 바로 보냅니다.\n반드시 둘 중 하나의 경로명만 출력하세요.',
      user_prompt: '질문: {{question}}\n경로:', change_summary: '라우팅 기준 명확화 (문서/일반 2분기)', change_reason: '오분류 케이스 감소', prev_prompt_id: 102, created_dt: seedDt(5) }),
    pv({ prompt_id: 102, node_mas_id: 2, node_nm: 'router', version_no: '1.1.0', is_active: 'N',
      system_prompt: '질문 유형을 분류하세요. 문서가 필요하면 retrieve, 아니면 generate.',
      user_prompt: '{{question}}', change_summary: '프롬프트 간소화', change_reason: '토큰 절감', prev_prompt_id: 101, created_dt: seedDt(20) }),
    pv({ prompt_id: 101, node_mas_id: 2, node_nm: 'router', version_no: '1.0.0', is_active: 'N',
      system_prompt: '사용자의 질문 의도를 분류합니다.',
      user_prompt: '{{question}}', change_summary: '초기 버전', change_reason: '최초 생성', created_dt: seedDt(40) }),
  ],
  // generate (node 5)
  5: [
    pv({ prompt_id: 203, node_mas_id: 5, node_nm: 'generate', version_no: '2.1.0', is_active: 'Y',
      system_prompt: '당신은 사내 지식 기반 어시스턴트입니다. 제공된 컨텍스트 문서에만 근거하여 한국어로 정확하게 답변하세요.\n- 컨텍스트에 없는 내용은 추측하지 말고 "관련 정보를 찾지 못했습니다"라고 답하세요.\n- 답변 끝에 참고한 문서를 [출처]로 표기하세요.',
      user_prompt: '컨텍스트:\n{{context}}\n\n질문: {{question}}\n답변:', change_summary: '출처 표기 규칙 추가', change_reason: '근거 추적성 강화', prev_prompt_id: 202, created_dt: seedDt(3) }),
    pv({ prompt_id: 202, node_mas_id: 5, node_nm: 'generate', version_no: '2.0.0', is_active: 'N',
      system_prompt: '제공된 컨텍스트에 근거하여 한국어로 답변하세요. 컨텍스트에 없으면 모른다고 답하세요.',
      user_prompt: '컨텍스트:\n{{context}}\n\n질문: {{question}}', change_summary: '환각 억제 지침 추가', change_reason: 'faithfulness 개선', prev_prompt_id: 201, created_dt: seedDt(15) }),
    pv({ prompt_id: 201, node_mas_id: 5, node_nm: 'generate', version_no: '1.0.0', is_active: 'N',
      system_prompt: '질문에 친절하게 한국어로 답변하세요.',
      user_prompt: '{{question}}', change_summary: '초기 버전', change_reason: '최초 생성', created_dt: seedDt(45) }),
  ],
  // verify (node 6)
  6: [
    pv({ prompt_id: 301, node_mas_id: 6, node_nm: 'verify', version_no: '1.0.0', is_active: 'Y', model_nm: 'gpt-4o',
      system_prompt: '당신은 답변 검증기입니다. 생성된 답변이 컨텍스트에 근거하는지 검증하고, 근거 없는 주장(환각)이 있으면 지적하세요. 결과를 PASS 또는 FAIL로 판정하세요.',
      user_prompt: '컨텍스트:\n{{context}}\n답변:\n{{answer}}\n판정:', change_summary: '초기 버전', change_reason: '최초 생성', created_dt: seedDt(15) }),
  ],
};

// ---- seed: flow versions ---------------------------------------------------

function flowVerNodes(routerV: string | null, genV: string | null, verifyV: string | null) {
  return [
    { node_mas_id: 2, node_nm: 'router', prompt_id: routerV ? 0 : null, version_no: routerV },
    { node_mas_id: 5, node_nm: 'generate', prompt_id: genV ? 0 : null, version_no: genV },
    { node_mas_id: 6, node_nm: 'verify', prompt_id: verifyV ? 0 : null, version_no: verifyV },
  ];
}

const flowVersions: FlowVersionDetail[] = [
  { flow_ver_id: 4, chat_ver_id: 1, flow_version_no: '1.3.0', is_active: 'Y', change_summary: 'generate 프롬프트 v2.1.0 활성화 (출처 표기)', created_by: SYSTEM_USER, created_dt: seedDt(3), graph_struct: GRAPH_STRUCT, main_model_nm: 'claude-sonnet-4-6', change_reason: '근거 추적성 강화', nodes: flowVerNodes('1.2.0', '2.1.0', '1.0.0') },
  { flow_ver_id: 3, chat_ver_id: 1, flow_version_no: '1.2.0', is_active: 'N', change_summary: 'router 프롬프트 v1.2.0 활성화', created_by: SYSTEM_USER, created_dt: seedDt(5), graph_struct: GRAPH_STRUCT, main_model_nm: 'claude-sonnet-4-6', change_reason: '라우팅 정확도 개선', nodes: flowVerNodes('1.2.0', '2.0.0', '1.0.0') },
  { flow_ver_id: 2, chat_ver_id: 1, flow_version_no: '1.1.0', is_active: 'N', change_summary: 'generate 프롬프트 v2.0.0 활성화 (환각 억제)', created_by: SYSTEM_USER, created_dt: seedDt(15), graph_struct: GRAPH_STRUCT, main_model_nm: 'claude-sonnet-4-6', change_reason: 'faithfulness 개선', nodes: flowVerNodes('1.1.0', '2.0.0', '1.0.0') },
  { flow_ver_id: 1, chat_ver_id: 1, flow_version_no: '1.0.0', is_active: 'N', change_summary: '최초 플로우 버전', created_by: SYSTEM_USER, created_dt: seedDt(45), graph_struct: GRAPH_STRUCT, main_model_nm: 'claude-sonnet-4-6', change_reason: '최초 생성', nodes: flowVerNodes('1.0.0', '1.0.0', null) },
];

// ---- seed: datasets + cases ------------------------------------------------

const datasets: Dataset[] = [
  { dataset_id: 1, node_mas_id: null, scope: 'FLOW', dataset_nm: 'RAG 기본 평가셋', description: '대표 사내 FAQ 5건', is_active: 'Y', created_by: SYSTEM_USER, created_dt: seedDt(30) },
  { dataset_id: 2, node_mas_id: null, scope: 'FLOW', dataset_nm: '엣지 케이스', description: '문서에 없는 질문 등 경계 케이스', is_active: 'Y', created_by: SYSTEM_USER, created_dt: seedDt(10) },
];

function tc(case_id: number, dataset_id: number, question: string, expected: string | null): TestCase {
  return { case_id, dataset_id, input_data: JSON.stringify({ question }), expected_output: expected, eval_criteria: null, case_type: 'FLOW', created_by: SYSTEM_USER, created_dt: seedDt(30) };
}

const cases: Record<number, TestCase[]> = {
  1: [
    tc(101, 1, '연차 휴가는 며칠까지 사용할 수 있나요?', '입사 1년차 기준 15일'),
    tc(102, 1, '재택근무 신청 절차를 알려주세요.', '그룹웨어에서 사전 승인 신청'),
    tc(103, 1, '경조사 지원금은 얼마인가요?', '결혼 50만원, 직계 조사 30만원'),
    tc(104, 1, '법인카드 사용 한도는 얼마인가요?', '직급별 상이, 팀장 월 200만원'),
    tc(105, 1, '교육비 지원 항목은 무엇이 있나요?', '직무 관련 도서/온라인 강의'),
  ],
  2: [
    tc(201, 2, '화성에서 연차를 쓰면 며칠인가요?', null),
    tc(202, 2, '', null),
    tc(203, 2, '회사 주가가 내일 오를까요?', '문서에 근거 없음 → 모른다고 답해야 함'),
  ],
};

// ---- generators ------------------------------------------------------------

// Keyword -> answer rules so each seed question gets a distinct, on-topic reply
// (and edge cases get a "no info" answer). Order matters: first match wins.
// Each rule has two phrasings so A/B runs produce slightly different outputs
// (variant 0 = A, 1 = B) — as if two prompt versions worded the answer differently.
const ANSWER_RULES: { match: RegExp; answers: [string, string] }[] = [
  { match: /(연차|휴가)/, answers: [
    '연차 휴가는 입사 1년차 기준 15일이 부여되며, 3년 이상 근속 시 매 2년마다 1일씩 가산됩니다. 미사용 연차는 연말에 정산됩니다. [출처: 인사규정 §4 휴가]',
    '연차는 입사 1년차에 15일이 주어지고, 근속 3년부터 2년마다 1일이 추가로 가산됩니다. 사용하지 못한 연차는 연말 정산 대상이며, 자세한 내용은 인사팀에 문의하세요. [출처: 인사규정 §4]',
  ] },
  { match: /(재택|근무)/, answers: [
    '재택근무는 그룹웨어 "근무신청" 메뉴에서 팀장 사전 승인을 받아 신청하며, 주 최대 2일까지 가능합니다. [출처: 근무규정 §2]',
    '재택근무를 하려면 그룹웨어에서 사전에 근무신청을 올려 팀장 승인을 받아야 하고, 주 2일 한도 내에서 운영됩니다. [출처: 근무규정 §2.1]',
  ] },
  { match: /(경조|결혼|조사|지원금)/, answers: [
    '경조사 지원금은 결혼 50만원, 직계가족 조사 30만원, 본인 출산 30만원이 지급됩니다. 인사팀에 증빙과 함께 신청하시면 됩니다. [출처: 복리후생 안내 §5]',
    '경조사 지원은 결혼 시 50만원, 직계가족 조사 시 30만원, 출산 시 30만원입니다. 증빙 서류를 갖춰 인사팀에 신청하면 지급됩니다. [출처: 복리후생 안내 §5.2]',
  ] },
  { match: /(법인카드|카드|한도)/, answers: [
    '법인카드 사용 한도는 직급별로 상이하며, 팀장은 월 200만원, 팀원은 월 100만원입니다. 사용 후 영수증을 경비시스템에 등록해야 합니다. [출처: 경비처리 지침 §3]',
    '법인카드 한도는 직급에 따라 다르고 팀장 월 200만원, 팀원 월 100만원입니다. 결제 후에는 반드시 영수증을 경비시스템에 등록하시기 바랍니다. [출처: 경비처리 지침 §3.4]',
  ] },
  { match: /(교육|강의|도서|세미나)/, answers: [
    '교육비는 직무 관련 도서 구입, 온라인 강의 수강, 외부 세미나 참가비를 연간 100만원 한도 내에서 지원합니다. [출처: 인재개발 규정 §6]',
    '교육비 지원 항목은 직무 도서, 온라인 강의, 외부 세미나 참가비이며 연간 한도는 100만원입니다. 사전 신청 후 정산하는 방식입니다. [출처: 인재개발 규정 §6.1]',
  ] },
  { match: /(주가|주식|화성|날씨|내일|로또)/, answers: [
    '제공된 컨텍스트 문서에서 관련 정보를 찾지 못했습니다. 해당 질문은 사내 규정 문서의 범위를 벗어납니다.',
    '검색된 문서에서 근거를 찾지 못해 정확한 답변을 드리기 어렵습니다. 사내 규정 문서의 범위를 벗어난 질문으로 보입니다.',
  ] },
];

// Varied fallbacks for arbitrary questions (chosen by a hash so it's stable per question).
const ANSWER_FALLBACKS: ((q: string) => string)[] = [
  (q) => `"${q}"에 대해 확인한 결과, 사내 규정 문서에 관련 내용이 안내되어 있습니다. 자세한 기준은 담당 부서에 문의하시기 바랍니다. [출처: 사내 규정집]`,
  (q) => `"${q}" 관련하여 검색된 문서 기준으로 답변드리면, 해당 절차는 그룹웨어를 통해 신청·확인하실 수 있습니다. [출처: 업무 안내서 §2]`,
  (q) => `질문하신 "${q}" 내용은 현재 정책상 담당 팀의 승인 절차를 거치도록 되어 있습니다. [출처: 운영 지침 §1]`,
];

/** A plausible, question-specific Korean answer (no LLM needed).
 * `variant` (0=A, 1=B) yields slightly different wording for A/B comparison. */
export function mockAnswer(question: string, variant = 0): string {
  const q = (question || '').trim();
  if (!q) return '질문이 비어 있어 답변을 생성할 수 없습니다.';
  for (const rule of ANSWER_RULES) if (rule.match.test(q)) return rule.answers[variant % rule.answers.length];
  let h = 0;
  for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) >>> 0;
  return ANSWER_FALLBACKS[(h + variant) % ANSWER_FALLBACKS.length](q);
}

function questionOf(inputData: string): string {
  try {
    const v = JSON.parse(inputData);
    return typeof v?.question === 'string' ? v.question : inputData;
  } catch {
    return inputData;
  }
}

/** Build (and store) a flow batch/A-B run from a dataset's cases.
 * No pass/fail verdict — batch/A-B just run the prompt over the dataset and
 * surface the outputs (latency/tokens). Scoring lives in RAGAS only. */
export function makeBatchRun(datasetId: number, opts: { runType?: string; abGroupId?: number; flowVerId?: number; variant?: number } = {}): TestRunDetail {
  const runId = nextId('run');
  const dsCases = cases[datasetId] ?? [];
  let totalTokens = 0;
  let latencySum = 0;
  let latencyN = 0;
  const results: TestResultRow[] = dsCases.map((c) => {
    const question = questionOf(c.input_data);
    const blank = !question.trim();
    const latency = randInt(620, 1850);
    const inTok = randInt(120, 380);
    const outTok = randInt(60, 240);
    if (!blank) {
      latencySum += latency;
      latencyN += 1;
      totalTokens += inTok + outTok;
    }
    return {
      result_id: nextId('result'),
      run_id: runId,
      case_id: c.case_id,
      input_data: c.input_data,
      actual_output: blank ? null : mockAnswer(question, opts.variant ?? 0),
      is_passed: null,
      eval_detail: null,
      latency_ms: blank ? null : latency,
      input_tokens: blank ? null : inTok,
      output_tokens: blank ? null : outTok,
      error_msg: blank ? '입력 question 이 비어 있습니다.' : null,
    };
  });
  const detail: TestRunDetail = {
    run_id: runId,
    run_type: opts.runType ?? 'FLOW_BATCH',
    node_mas_id: null,
    chat_ver_id: 1,
    prompt_id: null,
    dataset_id: datasetId,
    ab_group_id: opts.abGroupId ?? null,
    status: 'DONE',
    total_cases: results.length,
    passed_cases: 0,
    failed_cases: 0,
    avg_latency_ms: latencyN ? Math.round(latencySum / latencyN) : null,
    total_tokens: totalTokens,
    started_dt: nowDt(),
    ended_dt: nowDt(),
    created_by: SYSTEM_USER,
    created_dt: nowDt(),
    results,
  };
  store.testRuns[runId] = detail;
  return detail;
}

/** Build (and store) a RAGAS run from a dataset's cases. */
export function makeRagasRun(datasetId: number, metrics: string[]): RagasRunDetail {
  const ragasRunId = nextId('ragasRun');
  const dsCases = cases[datasetId] ?? [];
  const active = new Set(metrics.length ? metrics : [...RAGAS_METRICS]);
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const results: RagasResultRow[] = dsCases.map((c) => {
    const question = questionOf(c.input_data);
    const row: RagasResultRow = {
      ragas_result_id: nextId('ragasResult'),
      ragas_run_id: ragasRunId,
      case_id: c.case_id,
      question,
      answer: question.trim() ? mockAnswer(question) : null,
      contexts: '인사규정 §3, 복리후생 안내문',
      ground_truth: c.expected_output,
      faithfulness: null,
      answer_relevancy: null,
      context_precision: null,
      context_recall: null,
      answer_correctness: null,
      error_msg: question.trim() ? null : '입력 question 이 비어 있습니다.',
    };
    for (const m of RAGAS_METRICS) {
      if (!active.has(m)) continue;
      if (!question.trim()) continue;
      const score = round3(0.7 + Math.random() * 0.25);
      row[m] = score;
      sums[m] = (sums[m] ?? 0) + score;
      counts[m] = (counts[m] ?? 0) + 1;
    }
    return row;
  });
  const detail: RagasRunDetail = {
    ragas_run_id: ragasRunId,
    node_mas_id: null,
    prompt_id: null,
    dataset_id: datasetId,
    status: 'DONE',
    engine: 'fallback (mock)',
    faithfulness: counts.faithfulness ? round3(sums.faithfulness / counts.faithfulness) : null,
    answer_relevancy: counts.answer_relevancy ? round3(sums.answer_relevancy / counts.answer_relevancy) : null,
    context_precision: counts.context_precision ? round3(sums.context_precision / counts.context_precision) : null,
    context_recall: counts.context_recall ? round3(sums.context_recall / counts.context_recall) : null,
    answer_correctness: counts.answer_correctness ? round3(sums.answer_correctness / counts.answer_correctness) : null,
    error_msg: null,
    created_by: SYSTEM_USER,
    created_dt: nowDt(),
    results,
  };
  store.ragasRuns[ragasRunId] = detail;
  return detail;
}

/** A single full-flow run: scripted node trace + final output (for the WS sim). */
export interface FlowRunScript {
  steps: { node_nm: string; output: string; latency_ms: number; tokens: number }[];
  output: string;
}
export function makeFlowRun(inputs: Record<string, string>): { runId: number; script: FlowRunScript } {
  const runId = nextId('run');
  const question = inputs.question ?? Object.values(inputs)[0] ?? '';
  const answer = mockAnswer(question);
  const steps = [
    { node_nm: 'router', output: '경로 결정: retrieve (문서 검색 필요)', latency_ms: randInt(180, 420), tokens: randInt(30, 80) },
    { node_nm: 'retrieve', output: '관련 문서 4건 검색됨 (인사규정, 복리후생 안내 …)', latency_ms: randInt(90, 240), tokens: 0 },
    { node_nm: 'rerank', output: '관련도 상위 2건으로 재정렬', latency_ms: randInt(40, 120), tokens: 0 },
    { node_nm: 'generate', output: answer, latency_ms: randInt(700, 1600), tokens: randInt(180, 420) },
    { node_nm: 'verify', output: '검증 결과: PASS (근거 일치, 환각 없음)', latency_ms: randInt(300, 700), tokens: randInt(60, 160) },
  ];
  const script: FlowRunScript = { steps, output: answer };
  store.flowRuns[runId] = script;
  return { runId, script };
}

// ---- seed: historical runs (so Records tab is not empty) -------------------

function seedHistory(): void {
  // one finished batch
  const b = makeBatchRun(1);
  b.created_dt = seedDt(2);
  b.started_dt = seedDt(2);
  b.ended_dt = seedDt(2);
  // one A/B pair (shared ab_group_id)
  const grp = nextId('abGroup');
  const a = makeBatchRun(1, { runType: 'FLOW_AB', abGroupId: grp, variant: 0 });
  const b2 = makeBatchRun(1, { runType: 'FLOW_AB', abGroupId: grp, variant: 1 });
  for (const r of [a, b2]) { r.created_dt = seedDt(4); r.started_dt = seedDt(4); r.ended_dt = seedDt(4); }
  // one ragas run
  const rg = makeRagasRun(1, [...RAGAS_METRICS]);
  rg.created_dt = seedDt(1);
}

// ---- audit logs ------------------------------------------------------------

function auditLog(node_mas_id: number, action: string, before: object | null, after: object | null, daysAgo: number): AuditLog {
  return {
    log_id: nextId('log'),
    target_table: 'PM_NODE_PROMPT_VER',
    target_id: node_mas_id,
    action,
    before_value: before ? JSON.stringify(before) : null,
    after_value: after ? JSON.stringify(after) : null,
    created_by: SYSTEM_USER,
    created_dt: seedDt(daysAgo),
  };
}

const auditLogs: Record<number, AuditLog[]> = {
  2: [
    auditLog(2, 'FLOW_VERSION', { flow_version_no: '1.1.0' }, { flow_version_no: '1.2.0' }, 5),
    auditLog(2, 'ACTIVATE', { active_version_no: '1.1.0' }, { active_version_no: '1.2.0' }, 5),
    auditLog(2, 'CREATE', null, { version_no: '1.2.0', summary: '라우팅 기준 명확화' }, 5),
    auditLog(2, 'CREATE', null, { version_no: '1.0.0', summary: '초기 버전' }, 40),
  ],
  5: [
    auditLog(5, 'FLOW_VERSION', { flow_version_no: '1.2.0' }, { flow_version_no: '1.3.0' }, 3),
    auditLog(5, 'ACTIVATE', { active_version_no: '2.0.0' }, { active_version_no: '2.1.0' }, 3),
    auditLog(5, 'CREATE', null, { version_no: '2.1.0', summary: '출처 표기 규칙 추가' }, 3),
    auditLog(5, 'UPDATE', { system_prompt: '제공된 컨텍스트에 근거하여 답변하세요.' }, { system_prompt: '제공된 컨텍스트에 근거하여 한국어로 답변하세요. 컨텍스트에 없으면 모른다고 답하세요.' }, 15),
    auditLog(5, 'CREATE', null, { version_no: '1.0.0', summary: '초기 버전' }, 45),
  ],
  6: [
    auditLog(6, 'CREATE', null, { version_no: '1.0.0', summary: '초기 버전' }, 15),
  ],
};

// ---- store -----------------------------------------------------------------

export interface MockStore {
  flowCurrent: FlowCurrent;
  models: string[];
  flowVersions: FlowVersionDetail[];
  promptVersions: Record<number, PromptVersionDetail[]>;
  datasets: Dataset[];
  cases: Record<number, TestCase[]>;
  auditLogs: Record<number, AuditLog[]>;
  testRuns: Record<number, TestRunDetail>;
  ragasRuns: Record<number, RagasRunDetail>;
  flowRuns: Record<number, FlowRunScript>;
}

export const store: MockStore = {
  flowCurrent,
  models: MODELS,
  flowVersions,
  promptVersions,
  datasets,
  cases,
  auditLogs,
  testRuns: {},
  ragasRuns: {},
  flowRuns: {},
};

seedHistory();

// ---- derived views / mutations ---------------------------------------------

export function summarizePrompt(p: PromptVersionDetail): PromptVersionSummary {
  return {
    prompt_id: p.prompt_id,
    node_mas_id: p.node_mas_id,
    node_nm: p.node_nm,
    version_no: p.version_no,
    is_active: p.is_active,
    model_nm: p.model_nm,
    change_summary: p.change_summary,
    created_by: p.created_by,
    created_dt: p.created_dt,
  };
}

export function summarizeFlowVersion(v: FlowVersionDetail): FlowVersionSummary {
  return {
    flow_ver_id: v.flow_ver_id,
    chat_ver_id: v.chat_ver_id,
    flow_version_no: v.flow_version_no,
    is_active: v.is_active,
    change_summary: v.change_summary,
    created_by: v.created_by,
    created_dt: v.created_dt,
  };
}

export { nextId, nowDt };
