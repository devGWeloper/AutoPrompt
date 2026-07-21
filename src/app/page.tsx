'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '@/components/ui/TopBar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { api, ApiError } from '@/lib/api';
import { connectRagasRunWs } from '@/lib/ws';
import {
  RAGAS_METRICS,
  METRIC_LABELS,
  type RagasMetric,
  type Dataset,
  type FlowCurrent,
  type FlowNode,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type RagasRunSummary,
  type RunWsMessage,
  type TestCase,
} from '@/lib/types';

const API_BASE = '/api';
const errText = (e: unknown) => (e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
const fmt2 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(2) : '—');
const fmt3 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(3) : '—');

// Overall run score = mean of the available metric averages (null if none scored).
function runMean(d: RagasRunDetail): number | null {
  const vs = RAGAS_METRICS.map((m) => d[m]).filter((v): v is number => v != null);
  return vs.length ? vs.reduce((s, v) => s + Number(v), 0) / vs.length : null;
}

/** Parse a case's input_data JSON into the friendly fields for display. Falls
 * back to showing the raw string as the question if it isn't valid JSON. */
function parseCaseInput(raw: string): { question: string; contexts: string[]; groundTruth: string | null } {
  try {
    const o = JSON.parse(raw) as { question?: string; contexts?: string[] | string; ground_truth?: string };
    const ctx = Array.isArray(o.contexts) ? o.contexts : o.contexts ? [String(o.contexts)] : [];
    return { question: o.question ?? '', contexts: ctx.map(String), groundTruth: o.ground_truth ?? null };
  } catch {
    return { question: raw, contexts: [], groundTruth: null };
  }
}

type Tab = 'single' | 'compare' | 'direct' | 'datasets' | 'records';
const TABS: { id: Tab; label: string; desc: string; group?: string }[] = [
  { id: 'single', label: 'Single run', desc: 'Pick a node and prompt version, then score answer quality with RAGAS metrics.' },
  { id: 'compare', label: 'Compare', desc: 'Score two prompt versions of the same node on one dataset and compare metrics.' },
  { id: 'direct', label: 'Direct', desc: 'Send a message straight to the external agent and read the raw answer — no scoring.' },
  { id: 'datasets', label: 'Datasets', desc: 'Manage the question · context · ground-truth cases used for evaluation.', group: 'secondary' },
  { id: 'records', label: 'Records', desc: 'Browse past evaluation runs and export them as CSV.', group: 'secondary' },
];

export default function RagasHomePage() {
  const [tab, setTab] = useState<Tab>('single');
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="px-6 pt-5">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="flex-1 overflow-auto px-6 py-6">
        <header className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{current.label}</h1>
          <p className="mt-1 text-sm text-muted">{current.desc}</p>
        </header>
        {tab === 'single' && <SingleRunPanel />}
        {tab === 'compare' && <ComparePanel />}
        {tab === 'direct' && <DirectPanel />}
        {tab === 'datasets' && <DatasetsPanel />}
        {tab === 'records' && <RecordsPanel />}
      </div>
    </div>
  );
}

// ---- hooks -----------------------------------------------------------------

function useFlowDatasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const reload = useCallback(() => {
    api.get<Dataset[]>('/flow/datasets').then(setDatasets).catch(() => setDatasets([]));
  }, []);
  useEffect(reload, [reload]);
  return { datasets, reload };
}

function usePromptNodes() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  useEffect(() => {
    api
      .get<FlowCurrent>('/flow/current')
      .then((f) => setNodes(f.nodes))
      .catch(() => setNodes([]));
  }, []);
  return nodes;
}

// ---- direct call (raw external-API smoke test, no scoring) ------------------

type DirectResult = { response: string; docs: string[]; raw: Record<string, unknown> };
type DirectCaseResult = { case_id: number; question: string; answer: string | null; docs: string[]; error: string | null };

/** Optional endpoint overrides shared by both direct modes. Left blank, the
 * server's EXTERNAL_* settings are used. */
function EndpointOverrides({
  baseUrl, setBaseUrl, authKey, setAuthKey, userId, setUserId,
}: {
  baseUrl: string; setBaseUrl: (v: string) => void;
  authKey: string; setAuthKey: (v: string) => void;
  userId: string; setUserId: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Base URL</label>
        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Default: EXTERNAL_AGENT_BASE_URL" className="w-full text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Auth Key</label>
        <Input value={authKey} onChange={(e) => setAuthKey(e.target.value)} placeholder="Default: EXTERNAL_AUTH_KEY" className="w-full text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">User ID</label>
        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Default: EXTERNAL_USER_ID" className="w-full text-sm" />
      </div>
    </div>
  );
}

/** Raw external-API smoke test: send a message straight to the chat endpoint and
 * show the answer as-is. Bypasses prompts/RAGAS scoring. Input is either a query
 * typed by hand or every case of a dataset (read from the DB but not scored). */
function DirectPanel() {
  const { datasets } = useFlowDatasets();
  const [source, setSource] = useState<'manual' | 'dataset'>('manual');
  const [message, setMessage] = useState('');
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [userId, setUserId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState<DirectResult | null>(null);
  const [rows, setRows] = useState<DirectCaseResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overrides = {
    base_url: baseUrl.trim() || null,
    auth_key: authKey.trim() || null,
    user_id: userId.trim() || null,
  };
  const canSend = status !== 'running' && (source === 'manual' ? !!message.trim() : datasetId != null);

  async function send() {
    if (!canSend) return;
    setError(null); setResult(null); setRows(null); setStatus('running');
    try {
      if (source === 'manual') {
        setResult(await api.post<DirectResult>('/flow/test/direct', { message, ...overrides }));
      } else {
        const r = await api.post<{ results: DirectCaseResult[] }>('/flow/test/direct/dataset', {
          dataset_id: datasetId, ...overrides,
        });
        setRows(r.results);
      }
      setStatus('done');
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        <div className="mb-3">
          <SegToggle
            value={source}
            onChange={setSource}
            options={[
              { id: 'manual', label: 'Manual' },
              { id: 'dataset', label: 'Dataset' },
            ]}
          />
        </div>

        {source === 'manual' ? (
          <>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Message <span className="text-bad">*</span></label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Message sent as-is to the external API"
              className="w-full text-sm"
            />
          </>
        ) : (
          <div className="flex items-center gap-3">
            <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
            <span className="text-xs text-muted">Sends every case question in the selected dataset to the external API (no scoring).</span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" disabled={!canSend} onClick={send}>
            {status === 'running' ? 'Calling…' : 'Call'}
          </Button>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs font-medium text-muted hover:text-ink"
          >
            {showAdvanced ? 'Hide endpoint settings' : 'Endpoint settings (optional)'}
          </button>
          <StatusPill status={status} />
        </div>
        {showAdvanced && (
          <div className="mt-3 border-t border-line pt-3">
            <EndpointOverrides
              baseUrl={baseUrl} setBaseUrl={setBaseUrl}
              authKey={authKey} setAuthKey={setAuthKey}
              userId={userId} setUserId={setUserId}
            />
          </div>
        )}
      </Card>

      {error && <ErrBox msg={error} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">
            {source === 'manual'
              ? <>Enter a message and press <span className="font-medium">Call</span>.</>
              : <>Select a dataset and press <span className="font-medium">Call</span>.</>}
          </div>
          <div className="text-xs text-muted">Returns the external API response as-is, with no scoring.</div>
        </Card>
      )}

      {status === 'running' && (
        <Card className="px-6 py-12 text-center text-xs text-muted">Calling external API…</Card>
      )}

      {/* Manual single-message result */}
      {result && status !== 'running' && (
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Response</h3>
          </div>
          <div className="p-4">
          <AnswerBox text={result.response} />
          {result.docs.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Contexts ({result.docs.length})</p>
              <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto pl-4 text-xs text-muted">
                {result.docs.map((d, i) => (<li key={i} className="whitespace-pre-wrap break-words">{d}</li>))}
              </ol>
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-xs font-medium text-muted hover:text-ink">
              {showRaw ? 'Hide raw response' : 'Raw response (JSON)'}
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-sm border border-line bg-bg/60 p-3 text-xs text-ink">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            )}
          </div>
          </div>
        </Card>
      )}

      {/* Dataset result — one block per case (answer-centric, no scores) */}
      {rows && status !== 'running' && (
        <Card>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Responses</h3>
            <span className="text-xs text-muted">{rows.length} case{rows.length === 1 ? '' : 's'}</span>
          </div>
          <div className="p-4">
          <div className="overflow-hidden rounded-sm border border-line bg-surface">
            <div className="divide-y divide-line">
              {rows.map((r) => (
                <div key={r.case_id} className="px-4 py-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Question</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{r.question || '—'}</p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Answer</p>
                  <div className="mt-0.5"><AnswerBox text={r.answer} error={r.error} /></div>
                  {r.docs.length > 0 && (
                    <ol className="mt-2 max-h-40 list-decimal space-y-1 overflow-y-auto pl-4 text-xs text-muted">
                      {r.docs.map((d, i) => (<li key={i} className="whitespace-pre-wrap break-words">{d}</li>))}
                    </ol>
                  )}
                </div>
              ))}
              {rows.length === 0 && <div className="py-8 text-center text-xs text-muted">No cases</div>}
            </div>
          </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Insert or replace a streamed result row, keeping case order (by result id). */
function upsertResult(cur: RagasResultRow[], row: RagasResultRow): RagasResultRow[] {
  const i = cur.findIndex((x) => x.ragas_result_id === row.ragas_result_id);
  if (i === -1) return [...cur, row].sort((a, b) => a.ragas_result_id - b.ragas_result_id);
  const next = cur.slice();
  next[i] = row;
  return next;
}

function SingleRunPanel() {
  const { datasets } = useFlowDatasets();
  const nodes = usePromptNodes();
  const [nodeNm, setNodeNm] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [ver, setVer] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<string[]>([...RAGAS_METRICS]);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live streaming state: results trickle in (answers first, then scores).
  const [live, setLive] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const runIdRef = useRef<number | null>(null);
  const wsRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (nodeNm == null) { setVersions([]); return; }
    api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`).then(setVersions).catch(() => setVersions([]));
  }, [nodeNm]);
  // Default to the latest version of the selected node (list is newest-first).
  useEffect(() => { setVer(versions[0]?.prompt_id ?? null); }, [versions]);

  const canRun = !!(nodeNm && ver && datasetId);

  async function run() {
    if (!canRun) return;
    setError(null); setDetail(null); setStatus('running');
    setLive([]); setTotal(0); setCancelling(false); runIdRef.current = null;
    try {
      const r = await api.post<{ ragas_run_id: number }>('/flow/test/ragas', {
        dataset_id: datasetId, metrics, node_nm: nodeNm, prompt_id: ver,
      });
      runIdRef.current = r.ragas_run_id;
      const ws = connectRagasRunWs(r.ragas_run_id, {
        onMessage: async (m: RunWsMessage) => {
          if (m.event === 'RUNNING') {
            setTotal(m.total ?? 0);
          } else if (m.event === 'ANSWER' || m.event === 'SCORE') {
            setTotal(m.total);
            setLive((cur) => upsertResult(cur, m.result));
          } else if (m.event === 'DONE' || m.event === 'FAILED' || m.event === 'CANCELLED') {
            setDetail(await api.get<RagasRunDetail>(`/ragas-runs/${r.ragas_run_id}`));
            setStatus(m.event === 'DONE' ? 'done' : m.event === 'CANCELLED' ? 'cancelled' : 'failed');
            ws.close();
          }
        },
      });
      wsRef.current = ws;
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  async function cancel() {
    const id = runIdRef.current;
    if (id == null) return;
    setCancelling(true);
    try {
      await api.post(`/ragas-runs/${id}/cancel`, {});
    } catch (e) { setError(errText(e)); setCancelling(false); }
  }

  const answered = live.filter((r) => r.answer !== null || r.error_msg).length;
  const scored = live.filter((r) => RAGAS_METRICS.some((m) => r[m] !== null) || r.error_msg).length;

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        <div className="flex items-center gap-3 overflow-x-auto [&>*]:shrink-0">
          <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="w-44">
            <option value="" disabled>Select node</option>
            {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
          </Select>
          <VersionSelect versions={versions} value={ver} onChange={setVer} placeholder="Select version" />
          <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
          <Button
            variant={status === 'running' ? 'secondary' : 'primary'}
            className="whitespace-nowrap"
            disabled={status === 'running' ? cancelling : !canRun}
            onClick={status === 'running' ? cancel : run}
          >
            {status === 'running' ? (cancelling ? 'Cancelling…' : 'Cancel run') : 'Run RAGAS'}
          </Button>
          <StatusPill status={status} />
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <MetricChecks metrics={metrics} setMetrics={setMetrics} />
        </div>
      </Card>

      {error && <ErrBox msg={error} />}
      {detail?.error_msg && <ErrBox msg={detail.error_msg} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">Select a node, version, and dataset, then press <span className="font-medium">Run RAGAS</span>.</div>
          <div className="text-xs text-muted">Past results are available in the ‘Records’ tab.</div>
        </Card>
      )}

      {/* Live streaming view while running: answers appear first, scores fill in. */}
      {status === 'running' && (
        <Card>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
            <h3 className="mr-1 text-sm font-semibold text-ink">Results</h3>
            <Badge tone="neutral" dot>{cancelling ? 'CANCELLING' : 'RUNNING'}</Badge>
            <span className="ml-auto">Answered {answered}/{total || '…'} · Scored {scored}/{total || '…'}</span>
          </div>
          <div className="p-4">
            {live.length > 0
              ? <CaseTable detail={{ results: live } as RagasRunDetail} />
              : <div className="py-8 text-center text-xs text-muted">Generating answers…</div>}
          </div>
        </Card>
      )}

      {detail && status !== 'running' && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
            <h3 className="mr-1 text-sm font-semibold text-ink">Results</h3>
            <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'} dot>{detail.status}</Badge>
            <span>Engine {detail.engine ?? '—'}</span>
            <span>·</span>
            <span>{detail.results.length} case{detail.results.length === 1 ? '' : 's'}</span>
            {runMean(detail) != null && (
              <span className="ml-auto text-ink">Avg <span className="font-mono tabular-nums font-semibold">{fmt3(runMean(detail))}</span></span>
            )}
          </div>
          <div className="p-4">
            <CaseTable detail={detail} />
            {detail.status === 'CANCELLED' && (
              <p className="mt-3 text-xs text-muted">Cancelled run — answers only, no scores.</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function ComparePanel() {
  const { datasets } = useFlowDatasets();
  const nodes = usePromptNodes();
  const [nodeNm, setNodeNm] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [verA, setVerA] = useState<number | null>(null);
  const [verB, setVerB] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<string[]>([...RAGAS_METRICS]);
  const [status, setStatus] = useState('idle');
  const [detailA, setDetailA] = useState<RagasRunDetail | null>(null);
  const [detailB, setDetailB] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live streaming: answers for both versions trickle in, then scores fill in.
  const [liveA, setLiveA] = useState<RagasResultRow[]>([]);
  const [liveB, setLiveB] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const runIdsRef = useRef<number[]>([]);

  useEffect(() => {
    if (nodeNm == null) { setVersions([]); return; }
    api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`).then(setVersions).catch(() => setVersions([]));
  }, [nodeNm]);

  // default A = latest version, B = next most-recent (list is newest-first)
  useEffect(() => {
    setVerA(versions[0]?.prompt_id ?? null);
    setVerB(versions[1]?.prompt_id ?? null);
  }, [versions]);

  const canRun = !!(nodeNm && verA && verB && verA !== verB && datasetId) && status !== 'running';
  const verLabel = (id: number | null) => versions.find((v) => v.prompt_id === id)?.version_no ?? '';

  async function run() {
    if (!canRun) return;
    setError(null); setDetailA(null); setDetailB(null); setStatus('running');
    setLiveA([]); setLiveB([]); setTotal(0); setCancelling(false); runIdsRef.current = [];
    try {
      const r = await api.post<{ ragas_run_a_id: number; ragas_run_b_id: number }>('/flow/test/ragas/ab', {
        dataset_id: datasetId, node_nm: nodeNm, prompt_id_a: verA, prompt_id_b: verB, metrics,
      });
      runIdsRef.current = [r.ragas_run_a_id, r.ragas_run_b_id];
      const waitDone = (
        id: number,
        setLive: (f: (cur: RagasResultRow[]) => RagasResultRow[]) => void,
        setDet: (d: RagasRunDetail) => void,
      ) =>
        new Promise<string>((resolve) => {
          const ws = connectRagasRunWs(id, {
            onMessage: async (m: RunWsMessage) => {
              if (m.event === 'RUNNING') {
                setTotal((t) => Math.max(t, m.total ?? 0));
              } else if (m.event === 'ANSWER' || m.event === 'SCORE') {
                setTotal((t) => Math.max(t, m.total));
                setLive((cur) => upsertResult(cur, m.result));
              } else if (m.event === 'DONE' || m.event === 'FAILED' || m.event === 'CANCELLED') {
                setDet(await api.get<RagasRunDetail>(`/ragas-runs/${id}`));
                ws.close();
                resolve(m.event);
              }
            },
          });
        });
      const ev = await Promise.all([
        waitDone(r.ragas_run_a_id, setLiveA, setDetailA),
        waitDone(r.ragas_run_b_id, setLiveB, setDetailB),
      ]);
      setStatus(ev.includes('FAILED') ? 'failed' : ev.includes('CANCELLED') ? 'cancelled' : 'done');
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  async function cancel() {
    const ids = runIdsRef.current;
    if (!ids.length) return;
    setCancelling(true);
    // Cancel both runs; ignore per-id errors (e.g. one already finished → 409).
    await Promise.all(ids.map((id) => api.post(`/ragas-runs/${id}/cancel`, {}).catch(() => {})));
  }

  const answeredA = liveA.filter((r) => r.answer !== null || r.error_msg).length;
  const answeredB = liveB.filter((r) => r.answer !== null || r.error_msg).length;

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        <div className="flex items-center gap-3 overflow-x-auto [&>*]:shrink-0">
          <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="w-44">
            <option value="" disabled>Select node</option>
            {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
          </Select>
          <VersionSelect versions={versions} value={verA} onChange={setVerA} placeholder="Version A" />
          <span className="text-xs text-muted">vs</span>
          <VersionSelect versions={versions} value={verB} onChange={setVerB} placeholder="Version B" />
          <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
          <Button
            variant={status === 'running' ? 'secondary' : 'primary'}
            className="whitespace-nowrap"
            disabled={status === 'running' ? cancelling : !canRun}
            onClick={status === 'running' ? cancel : run}
          >
            {status === 'running' ? (cancelling ? 'Cancelling…' : 'Cancel run') : 'Run comparison'}
          </Button>
          <StatusPill status={status} />
        </div>
        {verA && verB && verA === verB && (
          <p className="mt-2 text-xs text-bad">Version A and B must be different.</p>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <MetricChecks metrics={metrics} setMetrics={setMetrics} />
        </div>
      </Card>

      {error && <ErrBox msg={error} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">Pick a node and <span className="font-medium">two versions</span> to compare, then run.</div>
          <div className="text-xs text-muted">Only the node’s system prompt is swapped between A/B; both are scored on the same dataset.</div>
        </Card>
      )}

      {/* Live A/B streaming while running: both versions' answers appear first, scores fill in. */}
      {status === 'running' && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
            <h3 className="mr-1 text-sm font-semibold text-ink">Comparison</h3>
            <Badge tone="neutral" dot>RUNNING</Badge>
            <Badge tone="neutral">A · v{verLabel(verA)}</Badge>
            <span>vs</span>
            <Badge tone="accent">B · v{verLabel(verB)}</Badge>
            <span className="ml-auto">Answered A {answeredA}/{total || '…'} · B {answeredB}/{total || '…'}</span>
          </div>
          <div className="p-4">
            {liveA.length > 0 || liveB.length > 0
              ? <div className="overflow-hidden rounded-sm border border-line bg-surface">
                  <CaseCompareTable
                    detailA={{ results: liveA } as RagasRunDetail}
                    detailB={{ results: liveB } as RagasRunDetail}
                    labelA={verLabel(verA)} labelB={verLabel(verB)}
                  />
                </div>
              : <div className="py-8 text-center text-xs text-muted">Generating answers…</div>}
          </div>
        </Card>
      )}

      {detailA && detailB && status !== 'running' && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
            <h3 className="mr-1 text-sm font-semibold text-ink">Comparison</h3>
            <span className="font-medium text-ink">{nodeNm}</span>
            <Badge tone="neutral">A · v{verLabel(verA)}</Badge>
            <span>vs</span>
            <Badge tone="accent">B · v{verLabel(verB)}</Badge>
            <span className="ml-auto flex items-center gap-2.5">
              <CompareVerdict detailA={detailA} detailB={detailB} />
              <span>Engine {detailA.engine ?? '—'}</span>
            </span>
          </div>
          <div className="p-4">
            <div className="overflow-hidden rounded-sm border border-line bg-surface">
              <CaseCompareTable detailA={detailA} detailB={detailB} labelA={verLabel(verA)} labelB={verLabel(verB)} />
            </div>
            {(detailA.status === 'CANCELLED' || detailB.status === 'CANCELLED') && (
              <p className="mt-3 text-xs text-muted">Cancelled run — answers only, no scores.</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- datasets -------------------------------------------------------------

function DatasetsPanel() {
  const { datasets, reload } = useFlowDatasets();
  const [selDataset, setSelDataset] = useState<number | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [newName, setNewName] = useState('');
  const [caseQuestion, setCaseQuestion] = useState('');
  const [caseContexts, setCaseContexts] = useState('');
  const [caseGroundTruth, setCaseGroundTruth] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadCases = useCallback(() => {
    if (selDataset == null) return setCases([]);
    api.get<TestCase[]>(`/datasets/${selDataset}/cases`).then(setCases).catch(() => setCases([]));
  }, [selDataset]);
  useEffect(loadCases, [loadCases]);

  async function createDataset() {
    if (!newName.trim()) return;
    try { await api.post('/flow/datasets', { dataset_nm: newName }); setNewName(''); reload(); }
    catch (e) { setError(errText(e)); }
  }
  async function addCase() {
    if (selDataset == null || !caseQuestion.trim()) return;
    // Build the input_data JSON from the friendly fields. Contexts: one per line.
    // ground_truth is optional (only the gt-based metrics need it).
    const contexts = caseContexts.split('\n').map((s) => s.trim()).filter(Boolean);
    const input: Record<string, unknown> = { question: caseQuestion.trim() };
    if (contexts.length) input.contexts = contexts;
    const gt = caseGroundTruth.trim();
    if (gt) input.ground_truth = gt;
    try {
      await api.post(`/datasets/${selDataset}/cases`, {
        input_data: JSON.stringify(input),
        expected_output: gt || null,
      });
      setCaseQuestion(''); setCaseContexts(''); setCaseGroundTruth('');
      loadCases();
    } catch (e) { setError(errText(e)); }
  }
  async function delDataset(id: number) { await api.del(`/datasets/${id}`); if (selDataset === id) setSelDataset(null); reload(); }
  async function delCase(id: number) { if (selDataset == null) return; await api.del(`/datasets/${selDataset}/cases/${id}`); loadCases(); }

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New dataset name" className="w-64" />
          <Button variant="secondary" disabled={!newName.trim()} onClick={createDataset}>Create dataset</Button>
        </div>
      </Card>
      {error && <ErrBox msg={error} />}
      <div className="grid grid-cols-[18rem_1fr] gap-5">
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Datasets <span className="font-normal text-muted">({datasets.length})</span></h3>
          </div>
          <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto p-3">
            {datasets.map((d) => (
              <li key={d.dataset_id} className="flex items-center gap-2">
                <button
                  onClick={() => setSelDataset(d.dataset_id)}
                  className={
                    'flex-1 rounded-sm border px-3 py-2 text-left text-sm transition-colors ' +
                    (selDataset === d.dataset_id ? 'border-accent/40 bg-accent-soft/60 font-medium text-ink' : 'border-line text-ink hover:bg-surface-2')
                  }
                >
                  {d.dataset_nm}
                </button>
                <Button variant="danger" size="sm" onClick={() => delDataset(d.dataset_id)}>Delete</Button>
              </li>
            ))}
            {datasets.length === 0 && <li className="px-1 py-2 text-sm text-muted">No datasets</li>}
          </ul>
        </Card>
        <Card>
          {selDataset == null ? (
            <div className="py-12 text-center text-sm text-muted">Select a dataset.</div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-ink">Cases <span className="font-normal text-muted">({cases.length})</span></h3>
              </div>
              <div className="p-4">
              <div className="mb-4 space-y-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Question <span className="text-bad">*</span></label>
                  <Input value={caseQuestion} onChange={(e) => setCaseQuestion(e.target.value)} placeholder="Question to evaluate" className="w-full text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Contexts <span className="font-normal normal-case tracking-normal">(optional · one per line)</span></label>
                  <Textarea value={caseContexts} onChange={(e) => setCaseContexts(e.target.value)} rows={3} placeholder={'Context 1\nContext 2'} className="w-full text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Ground truth <span className="font-normal normal-case tracking-normal">(optional · used only by accuracy metrics)</span></label>
                  <Input value={caseGroundTruth} onChange={(e) => setCaseGroundTruth(e.target.value)} placeholder="Expected answer (ground truth)" className="w-full text-sm" />
                </div>
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" disabled={!caseQuestion.trim()} onClick={addCase}>Add case</Button>
                </div>
              </div>
              <div>
                <Table>
                  <THead><TR><TH className="w-2/5">Question</TH><TH className="w-2/5">Contexts</TH><TH>Ground truth</TH><TH /></TR></THead>
                  <TBody>
                    {cases.map((c) => {
                      const p = parseCaseInput(c.input_data);
                      return (
                        <TR key={c.case_id}>
                          <TD className="align-top"><div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs">{p.question || '—'}</div></TD>
                          <TD className="align-top">
                            {p.contexts.length ? (
                              <ol className="max-h-28 list-decimal space-y-1 overflow-y-auto pl-4 text-xs text-muted">
                                {p.contexts.map((ctx, i) => (
                                  <li key={i} className="whitespace-pre-wrap break-words">{ctx}</li>
                                ))}
                              </ol>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </TD>
                          <TD className="align-top"><div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs">{p.groundTruth ?? '—'}</div></TD>
                          <TD className="text-right align-top"><Button variant="danger" size="sm" onClick={() => delCase(c.case_id)}>Delete</Button></TD>
                        </TR>
                      );
                    })}
                    {cases.length === 0 && <TR><TD colSpan={4} className="py-6 text-center text-muted">No cases</TD></TR>}
                  </TBody>
                </Table>
              </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---- records (single + A/B pairs) -----------------------------------------

type RunGroup =
  | { kind: 'single'; run: RagasRunSummary }
  | { kind: 'ab'; groupId: number; a: RagasRunSummary; b: RagasRunSummary };

function groupRuns(runs: RagasRunSummary[]): RunGroup[] {
  const groups: RunGroup[] = [];
  const seen = new Set<number>();
  for (const r of runs) {
    if (r.ab_group_id != null) {
      if (seen.has(r.ab_group_id)) continue;
      seen.add(r.ab_group_id);
      const members = runs.filter((x) => x.ab_group_id === r.ab_group_id).sort((a, b) => a.ragas_run_id - b.ragas_run_id);
      if (members.length === 2) { groups.push({ kind: 'ab', groupId: r.ab_group_id, a: members[0], b: members[1] }); continue; }
      members.forEach((mm) => groups.push({ kind: 'single', run: mm }));
    } else {
      groups.push({ kind: 'single', run: r });
    }
  }
  return groups;
}

function RecordsPanel() {
  const [ragas, setRagas] = useState<RagasRunSummary[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const reload = useCallback(() => {
    api.get<RagasRunSummary[]>('/ragas-runs').then(setRagas).catch(() => setRagas([]));
  }, []);
  useEffect(reload, [reload]);
  async function del(id: number) { await api.del(`/ragas-runs/${id}`); if (open === id) setOpen(null); reload(); }
  async function delPair(ids: number[]) { await Promise.all(ids.map((i) => api.del(`/ragas-runs/${i}`))); setOpen(null); reload(); }
  // Columns: Run, Type/Status, Engine, <metrics>, Created, actions.
  const cols = 5 + RAGAS_METRICS.length;
  const groups = groupRuns(ragas);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Runs <span className="text-muted">({groups.length})</span></h2>
        <Button variant="secondary" size="sm" onClick={reload}>Refresh</Button>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Run</TH><TH>Type / Status</TH><TH>Engine</TH>
            {RAGAS_METRICS.map((m) => (<TH key={m} className="text-right whitespace-nowrap">{METRIC_LABELS[m]}</TH>))}
            <TH>Created</TH><TH />
          </TR>
        </THead>
        <TBody>
          {groups.map((g) => {
            if (g.kind === 'single') {
              const r = g.run;
              return (
                <Fragment key={`r${r.ragas_run_id}`}>
                  <TR>
                    <TD className="font-mono text-xs text-muted">#{r.ragas_run_id}</TD>
                    <TD>
                      {r.engine === 'direct' ? (
                        <div className="flex items-center gap-1.5">
                          <Badge tone="neutral">Direct call</Badge>
                          <span className="text-xs text-muted">{r.status}</span>
                        </div>
                      ) : (
                        <Badge tone={r.status === 'FAILED' ? 'bad' : r.status === 'DONE' ? 'ok' : 'neutral'}>{r.status}</Badge>
                      )}
                    </TD>
                    <TD className="text-xs text-muted">{r.engine === 'direct' ? '—' : (r.engine ?? '—')}</TD>
                    {RAGAS_METRICS.map((m) => (<TD key={m} className="text-right font-mono text-xs tabular-nums">{fmt2(r[m])}</TD>))}
                    <TD className="whitespace-nowrap text-xs text-muted">{r.created_dt}</TD>
                    <TD className="whitespace-nowrap text-right">
                      <button onClick={() => setOpen(open === r.ragas_run_id ? null : r.ragas_run_id)} className="mr-3 text-xs font-medium text-accent hover:underline">
                        {open === r.ragas_run_id ? 'Collapse' : 'Details'}
                      </button>
                      <a href={`${API_BASE}/ragas-runs/${r.ragas_run_id}/export?fmt=csv`} className="mr-3 text-xs font-medium text-muted hover:text-ink">CSV</a>
                      <button onClick={() => del(r.ragas_run_id)} className="text-xs font-medium text-bad hover:underline">Delete</button>
                    </TD>
                  </TR>
                  {r.error_msg && <TR><TD colSpan={cols} className="bg-bad/5 text-xs text-bad">⚠ {r.error_msg}</TD></TR>}
                  {open === r.ragas_run_id && (
                    <TR><TD colSpan={cols} className="bg-bg/60 p-3"><RagasRunDetailView ragasId={r.ragas_run_id} /></TD></TR>
                  )}
                </Fragment>
              );
            }
            // A/B pair → one row (metric cells show candidate B; expand shows A-vs-B delta)
            const open2 = open === g.groupId;
            const stat = g.a.status === g.b.status ? g.a.status : `${g.a.status}/${g.b.status}`;
            return (
              <Fragment key={`ab${g.groupId}`}>
                <TR>
                  <TD className="font-mono text-xs text-muted">#{g.a.ragas_run_id}/#{g.b.ragas_run_id}</TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <Badge tone="accent">Compare v{g.a.version_no ?? '—'}→v{g.b.version_no ?? '—'}</Badge>
                      <span className="text-xs text-muted">{stat}</span>
                    </div>
                  </TD>
                  <TD className="text-xs text-muted">{g.b.engine ?? '—'}</TD>
                  {RAGAS_METRICS.map((m) => (<TD key={m} className="text-right font-mono text-xs tabular-nums">{fmt2(g.b[m])}</TD>))}
                  <TD className="whitespace-nowrap text-xs text-muted">{g.a.created_dt}</TD>
                  <TD className="whitespace-nowrap text-right">
                    <button onClick={() => setOpen(open2 ? null : g.groupId)} className="mr-3 text-xs font-medium text-accent hover:underline">
                      {open2 ? 'Collapse' : 'Compare'}
                    </button>
                    <a href={`${API_BASE}/ragas-runs/ab/${g.groupId}/export?fmt=csv`} className="mr-3 text-xs font-medium text-muted hover:text-ink">CSV</a>
                    <button onClick={() => delPair([g.a.ragas_run_id, g.b.ragas_run_id])} className="text-xs font-medium text-bad hover:underline">Delete</button>
                  </TD>
                </TR>
                {open2 && (
                  <TR><TD colSpan={cols} className="bg-bg/60 p-3"><AbCompareView aId={g.a.ragas_run_id} bId={g.b.ragas_run_id} labelA={g.a.version_no ?? ''} labelB={g.b.version_no ?? ''} /></TD></TR>
                )}
              </Fragment>
            );
          })}
          {groups.length === 0 && (<TR><TD colSpan={cols} className="py-10 text-center text-sm text-muted">No evaluation runs yet.</TD></TR>)}
        </TBody>
      </Table>
    </Card>
  );
}

function AbCompareView({ aId, bId, labelA, labelB }: { aId: number; bId: number; labelA: string; labelB: string }) {
  const [a, setA] = useState<RagasRunDetail | null>(null);
  const [b, setB] = useState<RagasRunDetail | null>(null);
  useEffect(() => {
    api.get<RagasRunDetail>(`/ragas-runs/${aId}`).then(setA).catch(() => setA(null));
    api.get<RagasRunDetail>(`/ragas-runs/${bId}`).then(setB).catch(() => setB(null));
  }, [aId, bId]);
  if (!a || !b) return <div className="text-xs text-muted">Loading…</div>;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <CaseCompareTable detailA={a} detailB={b} labelA={labelA} labelB={labelB} />
      </div>
      {(a.status === 'CANCELLED' || b.status === 'CANCELLED') && (
        <p className="text-xs text-muted">Cancelled run — answers only, no scores.</p>
      )}
    </div>
  );
}

function RagasRunDetailView({ ragasId }: { ragasId: number }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  useEffect(() => { api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`).then(setDetail).catch(() => setDetail(null)); }, [ragasId]);
  if (!detail) return <div className="text-xs text-muted">Loading…</div>;
  return <CaseTable detail={detail} bordered />;
}

// ---- shared bits -----------------------------------------------------------

// One side's absolute-score bar (fills 0→value on a 0..1 scale). B is the accent
// colour, A is neutral grey; the winning side's number is inked + bold.
function MetricBar({ side, value, win }: { side: 'A' | 'B'; value: number | null; win: boolean }) {
  const pct = value != null ? Math.max(0, Math.min(1, value)) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-[10px] font-semibold text-muted">{side}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-bg">
        <span
          className={'absolute inset-y-0 left-0 rounded-full ' + (side === 'B' ? 'bg-accent' : 'bg-muted/40')}
          style={{ width: pct + '%' }}
        />
      </div>
      <span className={'w-12 shrink-0 text-right font-mono text-xs tabular-nums ' + (win ? 'font-semibold text-ink' : 'text-muted')}>
        {fmt3(value)}
      </span>
    </div>
  );
}

type MetricRow = { m: RagasMetric; av: number | null; bv: number | null; d: number | null };

// Extract the per-metric A/B values (+ delta) from any two score-bearing rows —
// works for both run-level averages (RagasRunDetail) and single cases (RagasResultRow).
function buildMetricRows(
  a: RagasResultRow | RagasRunDetail | undefined,
  b: RagasResultRow | RagasRunDetail | undefined,
): MetricRow[] {
  return RAGAS_METRICS.map((m) => {
    const av = a && a[m] != null ? Number(a[m]) : null;
    const bv = b && b[m] != null ? Number(b[m]) : null;
    const d = av != null && bv != null ? bv - av : null;
    return { m, av, bv, d };
  });
}

// One-line A/B verdict for the Comparison card header: who leads + the win tally.
// Renders nothing until at least one metric has been scored on both sides.
function CompareVerdict({ detailA, detailB }: { detailA: RagasRunDetail; detailB: RagasRunDetail }) {
  const rows = buildMetricRows(detailA, detailB);
  const bWins = rows.filter((r) => r.d != null && r.d > 0).length;
  const aWins = rows.filter((r) => r.d != null && r.d < 0).length;
  const ties = rows.filter((r) => r.d != null && r.d === 0).length;
  if (bWins + aWins + ties === 0) return null;
  const verdict = bWins > aWins ? 'B ahead' : aWins > bWins ? 'A ahead' : 'Even';
  return (
    <span className="font-semibold text-ink">
      {verdict}
      <span className="ml-1.5 font-mono font-normal tabular-nums text-muted">· B {bWins} · A {aWins}{ties > 0 ? ` · tie ${ties}` : ''}</span>
    </span>
  );
}

// The shared leaderboard body: one row per metric with paired A/B bars on a
// 0..1 scale and Δ (B−A) on the right. Used by both the averages table and each
// A/B case so the whole compare view speaks one visual language.
function PairedMetricList({ rows }: { rows: MetricRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ m, av, bv, d }) => (
        <li key={m} className="grid grid-cols-[minmax(104px,0.8fr)_2fr_auto] items-center gap-4 px-3.5 py-2.5">
          <span className="truncate text-sm font-medium text-ink" title={METRIC_LABELS[m]}>{METRIC_LABELS[m]}</span>
          <div className="flex flex-col gap-1.5">
            <MetricBar side="A" value={av} win={d != null && d < 0} />
            <MetricBar side="B" value={bv} win={d != null && d > 0} />
          </div>
          <span className={'w-14 shrink-0 text-right font-mono text-xs tabular-nums ' + (d == null ? 'text-muted' : d > 0 ? 'text-ok' : d < 0 ? 'text-bad' : 'text-muted')}>
            {d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(3)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Bounded, scrollable answer box — answers can be long, so cap the height and
// scroll inside (break-words so long unbroken tokens/URLs don't overflow wide).
function AnswerBox({ text, error }: { text?: string | null; error?: string | null }) {
  if (text == null) return <p className="text-sm text-bad">{error ?? '—'}</p>;
  return (
    <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm leading-relaxed text-ink">
      {text}
    </div>
  );
}

// Answer-centric A/B case view: per case, the two versions' answers sit side by
// side, and below them the per-case scores use the same paired-bar leaderboard
// as the run averages so the whole compare view reads in one language.
function CaseCompareTable({
  detailA,
  detailB,
  labelA,
  labelB,
}: {
  detailA: RagasRunDetail;
  detailB: RagasRunDetail;
  labelA: string;
  labelB: string;
}) {
  const byA = new Map(detailA.results.map((r) => [r.case_id, r] as const));
  const byB = new Map(detailB.results.map((r) => [r.case_id, r] as const));
  const ids = Array.from(new Set([...byA.keys(), ...byB.keys()]));
  // If either run was cancelled, scoring is incomplete → answers only, no scores.
  const showScores = detailA.status !== 'CANCELLED' && detailB.status !== 'CANCELLED';
  if (ids.length === 0) {
    return <div className="py-8 text-center text-xs text-muted">No result rows</div>;
  }
  return (
    <div className="divide-y divide-line">
      {ids.map((cid) => {
        const a = byA.get(cid);
        const b = byB.get(cid);
        const q = a?.question ?? b?.question ?? '—';
        const gt = a?.ground_truth ?? b?.ground_truth ?? null;
        return (
          <div key={cid ?? 'null'} className="px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Question</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{q}</p>
            {gt && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted"><span className="font-medium">Ground truth ·</span> {gt}</p>}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-sm border border-line bg-bg/40 p-3">
                <Badge tone="neutral">A · v{labelA}</Badge>
                <div className="mt-2"><AnswerBox text={a?.answer} error={a?.error_msg} /></div>
              </div>
              <div className="rounded-sm border border-line bg-bg/40 p-3">
                <Badge tone="accent">B · v{labelB}</Badge>
                <div className="mt-2"><AnswerBox text={b?.answer} error={b?.error_msg} /></div>
              </div>
            </div>

            {showScores && <CaseScoreBars a={a} b={b} />}
          </div>
        );
      })}
    </div>
  );
}

// Per-case score comparison — same paired-bar leaderboard as the averages, or a
// muted 'Scoring…' placeholder until the first metric lands for this case.
function CaseScoreBars({ a, b }: { a?: RagasResultRow; b?: RagasResultRow }) {
  const rows = buildMetricRows(a, b);
  const scored = rows.some((r) => r.av != null || r.bv != null);
  return (
    <div className="mt-3 overflow-hidden rounded-sm border border-line bg-surface">
      {scored
        ? <PairedMetricList rows={rows} />
        : <div className="py-3 text-center text-[11px] text-muted">Scoring…</div>}
    </div>
  );
}

// Single-run score view: one bar per metric on a 0..1 scale — the single-side
// counterpart of the A/B paired bars, so single and compare read the same way.
function ScoreBars({ row }: { row: RagasResultRow }) {
  const scored = RAGAS_METRICS.some((m) => row[m] != null);
  if (!scored) {
    return row.answer == null && row.error_msg
      ? <span className="text-[11px] text-bad">{row.error_msg}</span>
      : <span className="text-[11px] text-muted">Scoring…</span>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {RAGAS_METRICS.map((m) => {
        const v = row[m] != null ? Number(row[m]) : null;
        const pct = v != null ? Math.max(0, Math.min(1, v)) * 100 : 0;
        return (
          <li key={m} className="grid grid-cols-[minmax(92px,auto)_1fr_auto] items-center gap-3">
            <span className="truncate text-[11px] text-muted" title={METRIC_LABELS[m]}>{METRIC_LABELS[m]}</span>
            <div className="relative h-2 overflow-hidden rounded-full bg-bg">
              <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct + '%' }} />
            </div>
            <span className={'w-12 shrink-0 text-right font-mono text-xs tabular-nums ' + (v != null ? 'text-ink' : 'text-muted')}>{fmt3(v)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// Answer-centric case view: question + answer are the focus, scores are small
// secondary chips. Replaces the old dense score table.
function CaseTable({ detail, bordered }: { detail: RagasRunDetail; bordered?: boolean }) {
  // Cancelled runs (incomplete scoring) and direct calls (never scored) → show
  // answers only, hide score chips.
  const showScores = detail.status !== 'CANCELLED' && detail.engine !== 'direct';
  const list = (
    <div className="divide-y divide-line">
      {detail.results.map((r) => (
        <div key={r.ragas_result_id} className="grid gap-4 px-4 py-3.5 sm:grid-cols-2">
          {/* left: inputs (question + ground truth) */}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Question</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{r.question ?? '—'}</p>
            {r.ground_truth && (
              <>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Ground truth</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{r.ground_truth}</p>
              </>
            )}
          </div>
          {/* right: output (answer + scores) */}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Answer</p>
            <div className="mt-0.5"><AnswerBox text={r.answer} error={r.error_msg} /></div>
            {showScores && <div className="mt-3"><ScoreBars row={r} /></div>}
          </div>
        </div>
      ))}
      {detail.results.length === 0 && (
        <div className="py-8 text-center text-xs text-muted">No result rows</div>
      )}
    </div>
  );
  if (detail.error_msg) {
    return (
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <div className="border-b border-line bg-bad/5 px-3 py-2 text-xs text-bad">{detail.error_msg}</div>
        {list}
      </div>
    );
  }
  return bordered ? <div className="overflow-hidden rounded-sm border border-line bg-surface">{list}</div> : list;
}

function MetricChecks({ metrics, setMetrics }: { metrics: string[]; setMetrics: (f: (cur: string[]) => string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
      {RAGAS_METRICS.map((m) => (
        <label key={m} className="flex items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={metrics.includes(m)}
            onChange={(e) => setMetrics((cur) => (e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)))}
          />
          {METRIC_LABELS[m]}
        </label>
      ))}
    </div>
  );
}

function DatasetSelect({ datasets, value, onChange }: { datasets: Dataset[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="w-48">
      <option value="" disabled>Dataset</option>
      {datasets.map((d) => (<option key={d.dataset_id} value={d.dataset_id}>{d.dataset_nm}</option>))}
    </Select>
  );
}

function VersionSelect({ versions, value, onChange, placeholder }: { versions: PromptVersionSummary[]; value: number | null; onChange: (id: number) => void; placeholder: string }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="w-36">
      <option value="" disabled>{placeholder}</option>
      {versions.map((v) => (
        <option key={v.prompt_id} value={v.prompt_id}>v{v.version_no}</option>
      ))}
    </Select>
  );
}

function SegToggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={'rounded px-3 py-1.5 text-sm font-medium transition-colors ' + (value === o.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const dot =
    status === 'done' ? 'bg-ok'
    : status === 'failed' ? 'bg-bad'
    : status === 'cancelled' ? 'bg-bad/60'
    : status === 'running' ? 'bg-accent animate-pulse'
    : 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
      <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + dot} />
      {status}
    </span>
  );
}
function ErrBox({ msg }: { msg: string }) {
  return <div className="rounded-md border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{msg}</div>;
}
