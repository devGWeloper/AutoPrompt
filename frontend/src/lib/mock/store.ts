// In-memory seed data for the demo mock layer (UI review without a backend).
// PM-only model: node identity is NODE_NM (no external CHAT_VER_MAS / NODE_MAS).

import type {
  AuditLog,
  Dataset,
  FlowCurrent,
  PromptVersionDetail,
  RagasResultRow,
  RagasRunDetail,
  TestCase,
} from '@/types';
import { RAGAS_METRICS } from '@/types';

let _id = 1000;
export const nextId = () => ++_id;
export const nowDt = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export function bumpMinor(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return '1.0.0';
  return `${m[1]}.${Number(m[2]) + 1}.0`;
}

// ---- prompt versions (per node_nm) ----------------------------------------

function pv(over: Partial<PromptVersionDetail> & { prompt_id: number; node_nm: string; version_no: string }): PromptVersionDetail {
  return {
    is_active: 'N',
    model_nm: null,
    change_summary: null,
    created_by: 'system',
    created_dt: '2026-05-20 10:00:00',
    system_prompt: '',
    user_prompt: '',
    change_reason: null,
    prev_prompt_id: null,
    updated_dt: null,
    ...over,
  };
}

const promptVersions: Record<string, PromptVersionDetail[]> = {
  classify: [
    pv({ prompt_id: 12, node_nm: 'classify', version_no: '1.2.0', is_active: 'Y', model_nm: 'claude-sonnet-4-6',
      change_summary: '의도 카테고리 6종으로 확장', change_reason: '미분류 비율 감소',
      system_prompt: '당신은 사용자 질문의 의도를 분류하는 분류기입니다. 카테고리: 정보요청, 비교, 절차문의, 불만, 잡담, 기타.',
      user_prompt: '질문: {{question}}\n위 질문의 의도를 한 단어로 답하세요.', created_dt: '2026-05-24 14:12:00', updated_dt: '2026-05-24 14:12:00', prev_prompt_id: 11 }),
    pv({ prompt_id: 11, node_nm: 'classify', version_no: '1.1.0', model_nm: 'claude-sonnet-4-6',
      change_summary: '잡담 카테고리 추가', change_reason: '오분류 대응',
      system_prompt: '당신은 사용자 질문의 의도를 분류합니다. 카테고리: 정보요청, 비교, 절차문의, 기타.',
      user_prompt: '질문: {{question}}\n의도?', created_dt: '2026-05-21 09:30:00', prev_prompt_id: 10 }),
    pv({ prompt_id: 10, node_nm: 'classify', version_no: '1.0.0', model_nm: 'claude-sonnet-4-6',
      change_summary: '초기 버전', change_reason: '최초 작성',
      system_prompt: '질문 의도를 분류하세요.', user_prompt: '{{question}}', created_dt: '2026-05-20 10:00:00' }),
  ],
  generate: [
    pv({ prompt_id: 31, node_nm: 'generate', version_no: '2.0.1', is_active: 'Y', model_nm: 'claude-sonnet-4-6',
      change_summary: '근거 인용 형식 고정', change_reason: '환각 감소 및 출처 명시',
      system_prompt: '당신은 제공된 문맥만 근거로 답하는 어시스턴트입니다. 문맥에 없으면 모른다고 답하세요. 답변 끝에 [출처] 표기를 붙입니다.',
      user_prompt: '문맥:\n{{contexts}}\n\n질문: {{question}}\n\n문맥에 근거해 한국어로 답하세요.', created_dt: '2026-05-25 16:40:00', updated_dt: '2026-05-25 16:40:00', prev_prompt_id: 30 }),
    pv({ prompt_id: 30, node_nm: 'generate', version_no: '2.0.0', model_nm: 'claude-sonnet-4-6',
      change_summary: '톤 정돈 + 길이 제한', change_reason: '응답 장황함 개선',
      system_prompt: '제공된 문맥을 근거로 간결하게 답하세요.',
      user_prompt: '문맥:\n{{contexts}}\n질문: {{question}}', created_dt: '2026-05-22 11:05:00' }),
  ],
  verify: [
    pv({ prompt_id: 41, node_nm: 'verify', version_no: '1.0.0', is_active: 'Y', model_nm: 'claude-sonnet-4-6',
      change_summary: '초기 검증 프롬프트', change_reason: '사실성 점검 단계 도입',
      system_prompt: '당신은 답변이 문맥에 의해 뒷받침되는지 검증합니다. 지지/불충분/모순 중 하나로 판정하세요.',
      user_prompt: '문맥:\n{{contexts}}\n답변: {{answer}}\n판정?', created_dt: '2026-05-23 13:20:00' }),
  ],
};

// ---- audit logs (per node_nm) ---------------------------------------------

const auditLogs: Record<string, AuditLog[]> = {
  classify: [
    { log_id: 9020, target_table: 'PM_NODE_PROMPT_VER', target_id: 12, action: 'ACTIVATE', created_by: 'system', created_dt: '2026-05-24 14:13:10',
      before_value: JSON.stringify({ active_version_no: '1.1.0' }), after_value: JSON.stringify({ active_version_no: '1.2.0' }) },
    { log_id: 9019, target_table: 'PM_NODE_PROMPT_VER', target_id: 12, action: 'CREATE', created_by: 'system', created_dt: '2026-05-24 14:12:00',
      before_value: null, after_value: JSON.stringify({ version_no: '1.2.0', change_summary: '의도 카테고리 6종으로 확장' }) },
    { log_id: 9012, target_table: 'PM_NODE_PROMPT_VER', target_id: 11, action: 'UPDATE', created_by: 'system', created_dt: '2026-05-21 09:35:00',
      before_value: JSON.stringify({ system_prompt: '질문 의도를 분류하세요.' }), after_value: JSON.stringify({ system_prompt: '당신은 사용자 질문의 의도를 분류합니다. 카테고리: 정보요청, 비교, 절차문의, 기타.' }) },
  ],
  generate: [
    { log_id: 9031, target_table: 'PM_NODE_PROMPT_VER', target_id: 31, action: 'ACTIVATE', created_by: 'system', created_dt: '2026-05-25 16:41:00',
      before_value: JSON.stringify({ active_version_no: '2.0.0' }), after_value: JSON.stringify({ active_version_no: '2.0.1' }) },
    { log_id: 9030, target_table: 'PM_NODE_PROMPT_VER', target_id: 31, action: 'CREATE', created_by: 'system', created_dt: '2026-05-25 16:40:00',
      before_value: null, after_value: JSON.stringify({ version_no: '2.0.1', change_summary: '근거 인용 형식 고정' }) },
  ],
  verify: [
    { log_id: 9041, target_table: 'PM_NODE_PROMPT_VER', target_id: 41, action: 'CREATE', created_by: 'system', created_dt: '2026-05-23 13:20:00',
      before_value: null, after_value: JSON.stringify({ version_no: '1.0.0', change_summary: '초기 검증 프롬프트' }) },
  ],
};

// ---- datasets + cases -----------------------------------------------------

function ds(dataset_id: number, dataset_nm: string, description: string | null): Dataset {
  return { dataset_id, dataset_nm, description, is_active: 'Y', created_by: 'system', created_dt: '2026-05-20 10:00:00' };
}
function tc(case_id: number, dataset_id: number, question: string, ground_truth: string, contexts: string[]): TestCase {
  return {
    case_id, dataset_id,
    input_data: JSON.stringify({ question, contexts, ground_truth }),
    expected_output: ground_truth, eval_criteria: null, case_type: 'NORMAL',
    created_by: 'system', created_dt: '2026-05-20 10:00:00',
  };
}

const datasets: Dataset[] = [
  ds(1, 'RAG 회귀셋 v1', '대표 질문 회귀 테스트'),
  ds(2, '엣지케이스', '문맥 부재/모순 케이스'),
];
const cases: Record<number, TestCase[]> = {
  1: [
    tc(101, 1, '환불 정책이 어떻게 되나요?', '구매 후 7일 이내 미개봉 상품은 전액 환불됩니다.', ['환불은 구매일로부터 7일 이내, 미개봉 상태에서 가능합니다.']),
    tc(102, 1, '배송은 얼마나 걸리나요?', '평균 2~3 영업일이 소요됩니다.', ['표준 배송은 2~3 영업일이 걸립니다.']),
    tc(103, 1, '회원 등급 혜택을 비교해줘', '실버는 5%, 골드는 10% 적립됩니다.', ['실버 등급 5% 적립, 골드 등급 10% 적립.']),
    tc(104, 1, '비밀번호를 잊어버렸어요', '로그인 화면의 비밀번호 찾기로 재설정할 수 있습니다.', ['비밀번호 재설정은 로그인 화면의 "비밀번호 찾기"에서 가능합니다.']),
  ],
  2: [
    tc(201, 2, '제품 보증 기간은?', '문맥에 보증 기간 정보가 없습니다.', []),
    tc(202, 2, '해외 배송 되나요?', '현재 국내 배송만 지원합니다.', ['배송은 국내에 한합니다.']),
  ],
};

// ---- RAGAS runs -----------------------------------------------------------

const METRIC_KEYS = RAGAS_METRICS;

export function makeRagasRun(datasetId: number, metrics: string[], over?: Partial<RagasRunDetail>): RagasRunDetail {
  const id = nextId();
  const chosen = METRIC_KEYS.filter((m) => metrics.includes(m));
  const used = chosen.length ? chosen : [...METRIC_KEYS];
  const rows = (cases[datasetId] ?? []).map((c, i): RagasResultRow => {
    const parsed = JSON.parse(c.input_data) as { question?: string; contexts?: string[]; ground_truth?: string };
    const base = 0.72 + ((i * 7) % 20) / 100;
    const scores = Object.fromEntries(
      METRIC_KEYS.map((m, j) => [m, used.includes(m) ? Math.min(0.99, Math.round((base - j * 0.03 + 0.04) * 100) / 100) : null]),
    ) as Record<(typeof METRIC_KEYS)[number], number | null>;
    return {
      ragas_result_id: nextId(),
      ragas_run_id: id,
      case_id: c.case_id,
      question: parsed.question ?? '',
      answer: `${parsed.ground_truth ?? ''} [출처]`,
      contexts: JSON.stringify(parsed.contexts ?? []),
      ground_truth: parsed.ground_truth ?? null,
      error_msg: null,
      ...scores,
    };
  });
  const avg = (m: (typeof METRIC_KEYS)[number]) => {
    const vals = rows.map((r) => r[m]).filter((v): v is number => v != null);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000 : null;
  };
  const detail: RagasRunDetail = {
    ragas_run_id: id,
    prompt_id: null,
    ab_group_id: null,
    node_nm: null,
    version_no: null,
    dataset_id: datasetId,
    status: 'DONE',
    engine: 'FALLBACK',
    faithfulness: avg('faithfulness'),
    answer_relevancy: avg('answer_relevancy'),
    context_precision: avg('context_precision'),
    context_recall: avg('context_recall'),
    answer_correctness: avg('answer_correctness'),
    error_msg: null,
    created_by: 'system',
    created_dt: nowDt(),
    results: rows,
    ...over,
  };
  return detail;
}

const ragasRuns: Record<number, RagasRunDetail> = {};
function seedRun(datasetId: number, over?: Partial<RagasRunDetail>) {
  const r = makeRagasRun(datasetId, [...METRIC_KEYS], over);
  ragasRuns[r.ragas_run_id] = r;
  return r;
}
seedRun(1, { engine: 'RAGAS', created_dt: '2026-05-25 17:02:00' });
seedRun(1, { engine: 'FALLBACK', created_dt: '2026-05-24 10:11:00' });
const failed = makeRagasRun(2, [...METRIC_KEYS], {
  status: 'FAILED', engine: 'RAGAS', error_msg: 'judge model timeout', created_dt: '2026-05-23 09:00:00',
  faithfulness: null, answer_relevancy: null, context_precision: null, context_recall: null, answer_correctness: null,
  results: [],
});
ragasRuns[failed.ragas_run_id] = failed;

// seeded A/B comparison on node "generate": v2.0.0 (prompt 30) vs v2.0.1 (prompt 31)
const abA = makeRagasRun(1, [...METRIC_KEYS], { node_nm: 'generate', prompt_id: 30, version_no: '2.0.0', engine: 'RAGAS', created_dt: '2026-05-26 09:00:00' });
abA.ab_group_id = abA.ragas_run_id;
ragasRuns[abA.ragas_run_id] = abA;
const abB = makeRagasRun(1, [...METRIC_KEYS], { node_nm: 'generate', prompt_id: 31, version_no: '2.0.1', engine: 'RAGAS', created_dt: '2026-05-26 09:00:05', ab_group_id: abA.ragas_run_id });
for (const mm of METRIC_KEYS) {
  const v = abB[mm];
  if (v != null) abB[mm] = Math.min(0.99, Math.round((Number(v) + 0.03) * 1000) / 1000);
}
ragasRuns[abB.ragas_run_id] = abB;

export const flowCurrent: FlowCurrent = {
  nodes: [
    { node_nm: 'classify', active_prompt_id: 12, active_version_no: '1.2.0', active_model_nm: 'claude-sonnet-4-6' },
    { node_nm: 'generate', active_prompt_id: 31, active_version_no: '2.0.1', active_model_nm: 'claude-sonnet-4-6' },
    { node_nm: 'verify', active_prompt_id: 41, active_version_no: '1.0.0', active_model_nm: 'claude-sonnet-4-6' },
  ],
};

const systemConfig: { enabled_yn: 'Y' | 'N' } = { enabled_yn: 'N' };

export const store = { flowCurrent, promptVersions, auditLogs, datasets, cases, ragasRuns, systemConfig };
