// Demo mock layer. When NEXT_PUBLIC_USE_MOCK !== '0' (default ON on this
// branch), api.ts/ws.ts route here instead of hitting the backend, so the whole
// UI runs off ./store with no DB/LLM. See ./store.ts for the seed data.

import { ApiError } from '../api';
import type { RunWsHandlers } from '../ws';
import type {
  AuditLog,
  Dataset,
  DatasetDetail,
  FlowVersionDetail,
  PromptVersionCreate,
  PromptVersionDetail,
  RagasRunDetail,
  RagasRunSummary,
  RunWsMessage,
  TestCase,
  TestRunDetail,
  TestRunOut,
} from '@/types';
import {
  bumpMinor,
  makeBatchRun,
  makeFlowRun,
  makeRagasRun,
  nextId,
  nowDt,
  store,
  summarizeFlowVersion,
  summarizePrompt,
} from './store';

export const MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== '0';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- internal helpers ------------------------------------------------------

function findPrompt(promptId: number): { nodeId: number; prompt: PromptVersionDetail } | null {
  for (const [nodeId, list] of Object.entries(store.promptVersions)) {
    const prompt = list.find((p) => p.prompt_id === promptId);
    if (prompt) return { nodeId: Number(nodeId), prompt };
  }
  return null;
}

function logAudit(nodeId: number, action: string, before: object | null, after: object | null): void {
  (store.auditLogs[nodeId] ??= []).unshift({
    log_id: nextId('log'),
    target_table: 'PM_NODE_PROMPT_VER',
    target_id: nodeId,
    action,
    before_value: before ? JSON.stringify(before) : null,
    after_value: after ? JSON.stringify(after) : null,
    created_by: 'system',
    created_dt: nowDt(),
  });
}

/** Cut a new active flow version snapshotting the current active prompts. */
function cutFlowVersion(summary: string, reason: string): FlowVersionDetail {
  for (const v of store.flowVersions) v.is_active = 'N';
  const flow_version_no = bumpMinor(store.flowCurrent.flow_version_no);
  store.flowCurrent.flow_version_no = flow_version_no;
  const fv: FlowVersionDetail = {
    flow_ver_id: nextId('flowVer'),
    chat_ver_id: 1,
    flow_version_no,
    is_active: 'Y',
    change_summary: summary,
    created_by: 'system',
    created_dt: nowDt(),
    graph_struct: store.flowCurrent.graph_struct,
    main_model_nm: store.flowCurrent.main_model_nm,
    change_reason: reason,
    nodes: store.flowCurrent.nodes
      .filter((n) => n.has_prompt)
      .map((n) => ({ node_mas_id: n.node_mas_id, node_nm: n.node_nm, prompt_id: n.active_prompt_id, version_no: n.active_version_no })),
  };
  store.flowVersions.unshift(fv);
  return fv;
}

function activatePrompt(nodeId: number, promptId: number): void {
  const list = store.promptVersions[nodeId] ?? [];
  let activated: PromptVersionDetail | undefined;
  for (const p of list) {
    p.is_active = p.prompt_id === promptId ? 'Y' : 'N';
    if (p.prompt_id === promptId) activated = p;
  }
  if (!activated) return;
  const node = store.flowCurrent.nodes.find((n) => n.node_mas_id === nodeId);
  const prevVer = node?.active_version_no ?? null;
  if (node) {
    node.active_prompt_id = promptId;
    node.active_version_no = activated.version_no;
  }
  logAudit(nodeId, 'ACTIVATE', { active_version_no: prevVer }, { active_version_no: activated.version_no });
  const fv = cutFlowVersion(`${activated.node_nm} 프롬프트 v${activated.version_no} 활성화`, '프롬프트 버전 활성화');
  logAudit(nodeId, 'FLOW_VERSION', { flow_version_no: prevVer }, { flow_version_no: fv.flow_version_no });
}

const stripResults = (d: TestRunDetail): TestRunOut => {
  const summary = { ...d } as Partial<TestRunDetail>;
  delete summary.results;
  return summary as TestRunOut;
};
const ragasSummary = (d: RagasRunDetail): RagasRunSummary => ({
  ragas_run_id: d.ragas_run_id,
  node_mas_id: d.node_mas_id,
  prompt_id: d.prompt_id,
  status: d.status,
  engine: d.engine,
  faithfulness: d.faithfulness,
  answer_relevancy: d.answer_relevancy,
  context_precision: d.context_precision,
  context_recall: d.context_recall,
  answer_correctness: d.answer_correctness,
  error_msg: d.error_msg,
  created_dt: d.created_dt,
});

// ---- HTTP router -----------------------------------------------------------

function route(method: string, path: string, body: Record<string, unknown> | undefined): unknown {
  const m = (re: RegExp) => path.match(re);
  let mm: RegExpMatchArray | null;

  // ---- flow ----
  if (method === 'GET' && path === '/flow/current') return store.flowCurrent;
  if (method === 'GET' && path === '/flow/models') return store.models;
  if (method === 'PUT' && path === '/flow/main-model') {
    const next = String(body?.main_model_nm ?? '');
    if (next && next !== store.flowCurrent.main_model_nm) {
      store.flowCurrent.main_model_nm = next;
      cutFlowVersion(`LLM 모델 변경 → ${next}`, 'LLM 모델 교체');
    }
    return store.flowCurrent;
  }
  if (method === 'GET' && path === '/flow/versions') return store.flowVersions.map(summarizeFlowVersion);
  if (method === 'GET' && (mm = m(/^\/flow\/versions\/(\d+)$/))) {
    const v = store.flowVersions.find((x) => x.flow_ver_id === Number(mm![1]));
    if (!v) throw new ApiError(404, { detail: '버전을 찾을 수 없습니다.' });
    return v;
  }
  if (method === 'DELETE' && (mm = m(/^\/flow\/versions\/(\d+)$/))) {
    const id = Number(mm![1]);
    const v = store.flowVersions.find((x) => x.flow_ver_id === id);
    if (v?.is_active === 'Y') throw new ApiError(400, { detail: '활성 버전은 삭제할 수 없습니다.' });
    store.flowVersions = store.flowVersions.filter((x) => x.flow_ver_id !== id);
    return undefined;
  }

  // ---- datasets ----
  if (method === 'GET' && path === '/flow/datasets') return store.datasets;
  if (method === 'POST' && path === '/flow/datasets') {
    const id = nextId('dataset');
    const ds: Dataset = {
      dataset_id: id, node_mas_id: null, scope: 'FLOW',
      dataset_nm: String(body?.dataset_nm ?? `데이터셋 ${id}`),
      description: (body?.description as string) ?? null, is_active: 'Y',
      created_by: 'system', created_dt: nowDt(),
    };
    store.datasets.push(ds);
    store.cases[id] = [];
    const out: DatasetDetail = { ...ds, case_count: 0 };
    return out;
  }
  if (method === 'DELETE' && (mm = m(/^\/datasets\/(\d+)$/))) {
    const id = Number(mm![1]);
    store.datasets = store.datasets.filter((d) => d.dataset_id !== id);
    delete store.cases[id];
    return undefined;
  }
  if (method === 'GET' && (mm = m(/^\/datasets\/(\d+)\/cases$/))) return store.cases[Number(mm![1])] ?? [];
  if (method === 'POST' && (mm = m(/^\/datasets\/(\d+)\/cases$/))) {
    const dsId = Number(mm![1]);
    const c: TestCase = {
      case_id: nextId('case'), dataset_id: dsId,
      input_data: String(body?.input_data ?? '{}'),
      expected_output: (body?.expected_output as string) ?? null,
      eval_criteria: null, case_type: 'FLOW', created_by: 'system', created_dt: nowDt(),
    };
    (store.cases[dsId] ??= []).push(c);
    return c;
  }
  if (method === 'DELETE' && (mm = m(/^\/datasets\/(\d+)\/cases\/(\d+)$/))) {
    const dsId = Number(mm![1]); const cid = Number(mm![2]);
    store.cases[dsId] = (store.cases[dsId] ?? []).filter((c) => c.case_id !== cid);
    return undefined;
  }

  // ---- prompts ----
  if (method === 'GET' && (mm = m(/^\/nodes\/(\d+)\/prompts$/))) {
    return (store.promptVersions[Number(mm![1])] ?? []).map(summarizePrompt);
  }
  if (method === 'POST' && (mm = m(/^\/nodes\/(\d+)\/prompts$/))) {
    const nodeId = Number(mm![1]);
    const payload = (body ?? {}) as unknown as PromptVersionCreate;
    const list = (store.promptVersions[nodeId] ??= []);
    const node = store.flowCurrent.nodes.find((n) => n.node_mas_id === nodeId);
    const latest = list[0]?.version_no ?? '0.0.0';
    const created: PromptVersionDetail = {
      prompt_id: nextId('prompt'), node_mas_id: nodeId,
      node_nm: node?.node_nm ?? `#${nodeId}`,
      version_no: payload.version_no || bumpMinor(latest),
      is_active: 'N',
      model_nm: payload.model_nm ?? node?.model_nm ?? store.flowCurrent.main_model_nm,
      change_summary: payload.change_summary ?? null,
      created_by: 'system', created_dt: nowDt(),
      system_prompt: payload.system_prompt ?? '', user_prompt: payload.user_prompt ?? '',
      temperature: payload.temperature ?? 0.2, max_tokens: payload.max_tokens ?? 1024,
      top_p: payload.top_p ?? 1, extra_params: payload.extra_params ?? null,
      change_reason: payload.change_reason ?? null, prev_prompt_id: list[0]?.prompt_id ?? null,
      updated_dt: nowDt(),
    };
    list.unshift(created);
    logAudit(nodeId, 'CREATE', null, { version_no: created.version_no, summary: created.change_summary });
    if (payload.activate_after_save) activatePrompt(nodeId, created.prompt_id);
    return created;
  }
  if (method === 'GET' && (mm = m(/^\/prompts\/(\d+)$/))) {
    const found = findPrompt(Number(mm![1]));
    if (!found) throw new ApiError(404, { detail: '프롬프트를 찾을 수 없습니다.' });
    return found.prompt;
  }
  if (method === 'PUT' && (mm = m(/^\/prompts\/(\d+)$/))) {
    const found = findPrompt(Number(mm![1]));
    if (!found) throw new ApiError(404, { detail: '프롬프트를 찾을 수 없습니다.' });
    const before = { system_prompt: found.prompt.system_prompt, user_prompt: found.prompt.user_prompt };
    if (body?.system_prompt !== undefined) found.prompt.system_prompt = String(body.system_prompt);
    if (body?.user_prompt !== undefined) found.prompt.user_prompt = String(body.user_prompt);
    found.prompt.updated_dt = nowDt();
    logAudit(found.nodeId, 'UPDATE', before, { system_prompt: found.prompt.system_prompt, user_prompt: found.prompt.user_prompt });
    return found.prompt;
  }
  if (method === 'PUT' && (mm = m(/^\/prompts\/(\d+)\/activate$/))) {
    const found = findPrompt(Number(mm![1]));
    if (!found) throw new ApiError(404, { detail: '프롬프트를 찾을 수 없습니다.' });
    activatePrompt(found.nodeId, found.prompt.prompt_id);
    return found.prompt;
  }

  // ---- audit ----
  if (method === 'GET' && (mm = m(/^\/nodes\/(\d+)\/audit-logs$/))) {
    const logs: AuditLog[] = store.auditLogs[Number(mm![1])] ?? [];
    return logs;
  }

  // ---- test runs ----
  if (method === 'POST' && path === '/flow/test/run') {
    const inputs = (body?.inputs ?? {}) as Record<string, string>;
    const { runId } = makeFlowRun(inputs);
    const out: TestRunOut = {
      run_id: runId, run_type: 'FLOW', node_mas_id: null, chat_ver_id: 1, prompt_id: null,
      dataset_id: null, ab_group_id: null, status: 'RUNNING', total_cases: 0, passed_cases: 0,
      failed_cases: 0, avg_latency_ms: null, total_tokens: null, started_dt: nowDt(),
      ended_dt: null, created_by: 'system', created_dt: nowDt(),
    };
    return out;
  }
  if (method === 'POST' && path === '/flow/test/batch') {
    return stripResults(makeBatchRun(Number(body?.dataset_id)));
  }
  if (method === 'POST' && path === '/flow/test/ab') {
    const dsId = Number(body?.dataset_id);
    const grp = nextId('abGroup');
    const a = makeBatchRun(dsId, { runType: 'FLOW_AB', abGroupId: grp, variant: 0 });
    const b = makeBatchRun(dsId, { runType: 'FLOW_AB', abGroupId: grp, variant: 1 });
    return { run_a_id: a.run_id, run_b_id: b.run_id };
  }
  if (method === 'POST' && path === '/flow/test/ragas') {
    const dsId = Number(body?.dataset_id);
    const metrics = (body?.metrics as string[]) ?? [];
    const run = makeRagasRun(dsId, metrics);
    return { ragas_run_id: run.ragas_run_id, ...stripResultsRagas(run) };
  }
  if (method === 'GET' && path === '/test-runs') {
    return Object.values(store.testRuns).sort((a, b) => b.run_id - a.run_id).map(stripResults);
  }
  if (method === 'GET' && (mm = m(/^\/test-runs\/(\d+)$/))) {
    const d = store.testRuns[Number(mm![1])];
    if (!d) throw new ApiError(404, { detail: '실행 기록을 찾을 수 없습니다.' });
    return d;
  }
  if (method === 'DELETE' && (mm = m(/^\/test-runs\/(\d+)$/))) {
    delete store.testRuns[Number(mm![1])];
    return undefined;
  }
  if (method === 'GET' && path === '/ragas-runs') {
    return Object.values(store.ragasRuns).sort((a, b) => b.ragas_run_id - a.ragas_run_id).map(ragasSummary);
  }
  if (method === 'GET' && (mm = m(/^\/ragas-runs\/(\d+)$/))) {
    const d = store.ragasRuns[Number(mm![1])];
    if (!d) throw new ApiError(404, { detail: 'RAGAS 실행 기록을 찾을 수 없습니다.' });
    return d;
  }
  if (method === 'DELETE' && (mm = m(/^\/ragas-runs\/(\d+)$/))) {
    delete store.ragasRuns[Number(mm![1])];
    return undefined;
  }

  // Unknown route — fail soft so the demo never crashes.
  return path.includes('/') && method === 'GET' ? [] : {};
}

/** RagasRunOut (detail minus per-case results) for the POST response. */
function stripResultsRagas(d: RagasRunDetail) {
  const rest = { ...d } as Partial<RagasRunDetail>;
  delete rest.results;
  return rest;
}

export async function mockRequest<T>(method: string, rawPath: string, body?: Record<string, unknown>): Promise<T> {
  const path = rawPath.split('?')[0];
  await delay(method === 'GET' ? 120 : 220);
  return route(method.toUpperCase(), path, body) as T;
}

// ---- WebSocket simulator ---------------------------------------------------

export function mockConnect(path: string, handlers: RunWsHandlers): WebSocket {
  let closed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const fake = {
    close() {
      closed = true;
      timers.forEach(clearTimeout);
    },
  } as unknown as WebSocket;

  const emit = (msg: RunWsMessage, at: number) => {
    timers.push(setTimeout(() => { if (!closed) handlers.onMessage(msg); }, at));
  };

  let mm: RegExpMatchArray | null;

  if ((mm = path.match(/\/ws\/flow-runs\/(\d+)/))) {
    const runId = Number(mm[1]);
    const script = store.flowRuns[runId];
    if (script) {
      // single full-flow run: stream node trace, then final output
      emit({ event: 'RUNNING', run_id: runId }, 150);
      let t = 450;
      for (const s of script.steps) {
        emit({ event: 'NODE_DONE', run_id: runId, node_nm: s.node_nm, output: s.output, latency_ms: s.latency_ms, tokens: s.tokens }, t);
        t += 600;
      }
      emit({ event: 'DONE', run_id: runId, output: script.output }, t);
    } else {
      streamDatasetRun(runId, emit);
    }
  } else if ((mm = path.match(/\/ws\/test-runs\/(\d+)/))) {
    streamDatasetRun(Number(mm[1]), emit);
  } else if ((mm = path.match(/\/ws\/ragas-runs\/(\d+)/))) {
    const runId = Number(mm[1]);
    emit({ event: 'RUNNING', run_id: runId }, 150);
    const run = store.ragasRuns[runId];
    emit({ event: 'DONE', run_id: runId, engine: run?.engine ?? 'fallback (mock)' }, 1300);
  }

  return fake;
}

/** Batch / A/B dataset runs: RUNNING -> PROGRESS* -> DONE (page re-fetches detail). */
function streamDatasetRun(runId: number, emit: (msg: RunWsMessage, at: number) => void): void {
  const detail = store.testRuns[runId];
  const total = detail?.total_cases ?? 0;
  emit({ event: 'RUNNING', run_id: runId, total }, 150);
  let t = 450;
  (detail?.results ?? []).forEach((r, i) => {
    emit({ event: 'PROGRESS', run_id: runId, done: i + 1, total, case_id: r.case_id, is_passed: r.is_passed }, t);
    t += 280;
  });
  emit({ event: 'DONE', run_id: runId }, t + 200);
}
