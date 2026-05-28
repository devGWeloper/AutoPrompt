// Demo mock layer. When NEXT_PUBLIC_USE_MOCK !== '0' (default ON for UI review),
// api.ts / ws.ts route here instead of hitting the backend, so the whole UI runs
// off ./store with no backend / DB / LLM. Scoped to the current RAGAS API surface.

import { ApiError } from '../api';
import type { RunWsHandlers } from '../ws';
import type {
  AuditLog,
  Dataset,
  DatasetDetail,
  PromptVersionCreate,
  PromptVersionDetail,
  PromptVersionSummary,
  RagasRunDetail,
  RagasRunSummary,
  RunWsMessage,
  TestCase,
} from '@/types';
import { bumpMinor, makeRagasRun, nextId, nowDt, store } from './store';

export const MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== '0';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- helpers ---------------------------------------------------------------

function summarizePrompt(p: PromptVersionDetail): PromptVersionSummary {
  return {
    prompt_id: p.prompt_id, node_mas_id: p.node_mas_id, node_nm: p.node_nm,
    version_no: p.version_no, is_active: p.is_active, change_summary: p.change_summary,
    created_by: p.created_by, created_dt: p.created_dt,
  };
}

function ragasSummary(d: RagasRunDetail): RagasRunSummary {
  return {
    ragas_run_id: d.ragas_run_id, status: d.status, engine: d.engine,
    faithfulness: d.faithfulness, answer_relevancy: d.answer_relevancy,
    context_precision: d.context_precision, context_recall: d.context_recall,
    answer_correctness: d.answer_correctness, error_msg: d.error_msg, created_dt: d.created_dt,
  };
}

function findPrompt(promptId: number): { nodeId: number; prompt: PromptVersionDetail } | null {
  for (const [nodeId, list] of Object.entries(store.promptVersions)) {
    const prompt = list.find((p) => p.prompt_id === promptId);
    if (prompt) return { nodeId: Number(nodeId), prompt };
  }
  return null;
}

function logAudit(nodeId: number, targetId: number, action: string, before: object | null, after: object | null): void {
  (store.auditLogs[nodeId] ??= []).unshift({
    log_id: nextId(), target_table: 'PM_NODE_PROMPT_VER', target_id: targetId, action,
    before_value: before ? JSON.stringify(before) : null,
    after_value: after ? JSON.stringify(after) : null,
    created_by: 'system', created_dt: nowDt(),
  });
}

function activatePrompt(nodeId: number, promptId: number): void {
  const list = store.promptVersions[nodeId] ?? [];
  let activated: PromptVersionDetail | undefined;
  const prev = list.find((p) => p.is_active === 'Y');
  for (const p of list) {
    p.is_active = p.prompt_id === promptId ? 'Y' : 'N';
    if (p.prompt_id === promptId) activated = p;
  }
  if (!activated) return;
  const node = store.flowCurrent.nodes.find((n) => n.node_mas_id === nodeId);
  if (node) {
    node.active_prompt_id = activated.prompt_id;
    node.active_version_no = activated.version_no;
  }
  logAudit(nodeId, promptId, 'ACTIVATE',
    { active_version_no: prev?.version_no ?? null },
    { active_version_no: activated.version_no });
}

// ---- HTTP router -----------------------------------------------------------

function route(method: string, path: string, body: Record<string, unknown> | undefined): unknown {
  const m = (re: RegExp) => path.match(re);
  let mm: RegExpMatchArray | null;

  // flow / nodes
  if (method === 'GET' && path === '/flow/current') return store.flowCurrent;

  // datasets
  if (method === 'GET' && path === '/flow/datasets') return store.datasets;
  if (method === 'POST' && path === '/flow/datasets') {
    const id = nextId();
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
    const id = Number(mm[1]);
    store.datasets = store.datasets.filter((d) => d.dataset_id !== id);
    delete store.cases[id];
    return undefined;
  }
  if (method === 'GET' && (mm = m(/^\/datasets\/(\d+)\/cases$/))) return store.cases[Number(mm[1])] ?? [];
  if (method === 'POST' && (mm = m(/^\/datasets\/(\d+)\/cases$/))) {
    const dsId = Number(mm[1]);
    const c: TestCase = {
      case_id: nextId(), dataset_id: dsId,
      input_data: String(body?.input_data ?? '{}'),
      expected_output: (body?.expected_output as string) ?? null,
      eval_criteria: null, case_type: 'NORMAL', created_by: 'system', created_dt: nowDt(),
    };
    (store.cases[dsId] ??= []).push(c);
    return c;
  }
  if (method === 'DELETE' && (mm = m(/^\/datasets\/(\d+)\/cases\/(\d+)$/))) {
    const dsId = Number(mm[1]); const cid = Number(mm[2]);
    store.cases[dsId] = (store.cases[dsId] ?? []).filter((c) => c.case_id !== cid);
    return undefined;
  }

  // prompts
  if (method === 'GET' && (mm = m(/^\/nodes\/(\d+)\/prompts$/))) {
    return (store.promptVersions[Number(mm[1])] ?? []).map(summarizePrompt);
  }
  if (method === 'POST' && (mm = m(/^\/nodes\/(\d+)\/prompts$/))) {
    const nodeId = Number(mm[1]);
    const payload = (body ?? {}) as unknown as PromptVersionCreate;
    const list = (store.promptVersions[nodeId] ??= []);
    const node = store.flowCurrent.nodes.find((n) => n.node_mas_id === nodeId);
    const latest = list[0]?.version_no ?? '0.0.0';
    const created: PromptVersionDetail = {
      prompt_id: nextId(), node_mas_id: nodeId, node_nm: node?.node_nm ?? `#${nodeId}`,
      version_no: payload.version_no || bumpMinor(latest), is_active: 'N',
      change_summary: payload.change_summary ?? null, change_reason: payload.change_reason ?? null,
      prev_prompt_id: list[0]?.prompt_id ?? null, created_by: 'system',
      created_dt: nowDt(), updated_dt: nowDt(),
      system_prompt: payload.system_prompt ?? '', user_prompt: payload.user_prompt ?? '',
    };
    list.unshift(created);
    logAudit(nodeId, created.prompt_id, 'CREATE', null,
      { version_no: created.version_no, change_summary: created.change_summary });
    if (payload.activate_after_save) activatePrompt(nodeId, created.prompt_id);
    return created;
  }
  if (method === 'GET' && (mm = m(/^\/prompts\/(\d+)$/))) {
    const found = findPrompt(Number(mm[1]));
    if (!found) throw new ApiError(404, { detail: '프롬프트를 찾을 수 없습니다.' });
    return found.prompt;
  }
  if (method === 'PUT' && (mm = m(/^\/prompts\/(\d+)$/))) {
    const found = findPrompt(Number(mm[1]));
    if (!found) throw new ApiError(404, { detail: '프롬프트를 찾을 수 없습니다.' });
    const before = { system_prompt: found.prompt.system_prompt, user_prompt: found.prompt.user_prompt };
    if (body?.system_prompt !== undefined) found.prompt.system_prompt = String(body.system_prompt);
    if (body?.user_prompt !== undefined) found.prompt.user_prompt = String(body.user_prompt);
    found.prompt.updated_dt = nowDt();
    logAudit(found.nodeId, found.prompt.prompt_id, 'UPDATE', before,
      { system_prompt: found.prompt.system_prompt, user_prompt: found.prompt.user_prompt });
    return found.prompt;
  }
  if (method === 'PUT' && (mm = m(/^\/prompts\/(\d+)\/activate$/))) {
    const found = findPrompt(Number(mm[1]));
    if (!found) throw new ApiError(404, { detail: '프롬프트를 찾을 수 없습니다.' });
    activatePrompt(found.nodeId, found.prompt.prompt_id);
    return found.prompt;
  }

  // audit
  if (method === 'GET' && (mm = m(/^\/nodes\/(\d+)\/audit-logs$/))) {
    const logs: AuditLog[] = store.auditLogs[Number(mm[1])] ?? [];
    return logs;
  }

  // ragas
  if (method === 'POST' && path === '/flow/test/ragas') {
    const dsId = Number(body?.dataset_id);
    const metrics = (body?.metrics as string[]) ?? [];
    const run = makeRagasRun(dsId, metrics);
    store.ragasRuns[run.ragas_run_id] = run;
    const { results, ...out } = run; // RagasRunOut (detail minus per-case rows)
    void results;
    return out;
  }
  if (method === 'GET' && path === '/ragas-runs') {
    return Object.values(store.ragasRuns).sort((a, b) => b.ragas_run_id - a.ragas_run_id).map(ragasSummary);
  }
  if (method === 'GET' && (mm = m(/^\/ragas-runs\/(\d+)$/))) {
    const d = store.ragasRuns[Number(mm[1])];
    if (!d) throw new ApiError(404, { detail: 'RAGAS 실행 기록을 찾을 수 없습니다.' });
    return d;
  }
  if (method === 'DELETE' && (mm = m(/^\/ragas-runs\/(\d+)$/))) {
    delete store.ragasRuns[Number(mm[1])];
    return undefined;
  }

  // Unknown route — fail soft so the demo never crashes.
  return method === 'GET' ? [] : {};
}

export async function mockRequest<T>(method: string, rawPath: string, body?: Record<string, unknown>): Promise<T> {
  const path = rawPath.split('?')[0];
  await delay(method === 'GET' ? 100 : 180);
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

  const mm = path.match(/\/ws\/ragas-runs\/(\d+)/);
  if (mm) {
    const runId = Number(mm[1]);
    const run = store.ragasRuns[runId];
    emit({ event: 'RUNNING', run_id: runId, total: run?.results.length ?? 0 }, 150);
    if (run?.status === 'FAILED') {
      emit({ event: 'FAILED', run_id: runId, error: run.error_msg ?? 'failed' }, 800);
    } else {
      emit({ event: 'DONE', run_id: runId, engine: run?.engine ?? 'FALLBACK' }, 900);
    }
  }
  return fake;
}
