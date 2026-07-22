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
  METRIC_DESCRIPTIONS,
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

/** Compact table timestamp from the server's YYYY-MM-DDTHH:MM:SS string: time
 * only if today, MM-DD HH:MM within the year, full date otherwise. The full
 * string stays available via the cell's title tooltip. */
function fmtDt(iso: string): string {
  const [d, t] = iso.split('T');
  if (!d || !t) return iso;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hm = t.slice(0, 5);
  if (d === today) return hm;
  return d.startsWith(`${now.getFullYear()}-`) ? `${d.slice(5)} ${hm}` : `${d} ${hm}`;
}

// Overall run score = mean of the available metric averages (null if none
// scored). Accepts anything carrying the metric fields (details and summaries).
function runMean(d: { [K in RagasMetric]?: number | null }): number | null {
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

type Tab = 'single' | 'compare' | 'datasets' | 'records';
const TABS: { id: Tab; label: string; desc: string; group?: string }[] = [
  { id: 'single', label: 'Single run', desc: '데이터셋 또는 단일 메시지(Manual)를 실행합니다 — 프롬프트 버전을 교체하거나 As-is(현재 상태 그대로)로 실행할 수 있고, RAGAS 채점은 켜고 끌 수 있습니다.' },
  { id: 'compare', label: 'Compare', desc: '같은 노드의 두 프롬프트 버전을 하나의 데이터셋으로 평가해 지표를 비교합니다.' },
  { id: 'datasets', label: 'Datasets', desc: '평가에 사용할 질문 · 컨텍스트 · 정답(ground truth) 케이스를 관리합니다.', group: 'secondary' },
  { id: 'records', label: 'Records', desc: '지난 평가 실행 기록을 조회하고 CSV로 내보냅니다.', group: 'secondary' },
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

type DirectResult = {
  response: string;
  docs: string[];
  raw: Record<string, unknown>;
  scores: Partial<Record<RagasMetric, number | null>> | null;
};

/** Adapt a manual call's inline scores to the RagasResultRow shape ScoreBars renders. */
function directScoresRow(res: DirectResult): RagasResultRow | null {
  if (!res.scores) return null;
  const metricVals = Object.fromEntries(RAGAS_METRICS.map((m) => [m, res.scores?.[m] ?? null]));
  return {
    ragas_result_id: 0, ragas_run_id: 0, case_id: null, question: '',
    answer: res.response, contexts: null, ground_truth: null, error_msg: null,
    ...metricVals,
  } as RagasResultRow;
}

/** 'RAGAS 채점' master switch, shared by every run mode. A real track+knob
 * switch — unlike a dimmed chip, its on/off affordance is unmistakable. */
function ScoreToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="group inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold"
    >
      <span
        aria-hidden
        className={cnstr(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          on ? 'bg-accent' : 'bg-muted/30 group-hover:bg-muted/45',
        )}
      >
        <span
          className={cnstr(
            'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
            on && 'translate-x-3',
          )}
        />
      </span>
      <span className={cnstr('transition-colors', on ? 'text-ink' : 'text-muted')}>RAGAS 채점</span>
    </button>
  );
}

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

/** Insert or replace a streamed result row, keeping case order (by result id). */
function upsertResult(cur: RagasResultRow[], row: RagasResultRow): RagasResultRow[] {
  const i = cur.findIndex((x) => x.ragas_result_id === row.ragas_result_id);
  if (i === -1) return [...cur, row].sort((a, b) => a.ragas_result_id - b.ragas_result_id);
  const next = cur.slice();
  next[i] = row;
  return next;
}

/** Evaluate tab: dataset runs are always RAGAS-scored — either with a prompt
 * version swapped in, or 'As-is' against the agent's current prompts (the old
 * Direct dataset mode, now scored). Manual mode sends one raw message with no
 * scoring (smoke test), keeping the endpoint overrides. */
function SingleRunPanel() {
  const { datasets } = useFlowDatasets();
  const nodes = usePromptNodes();
  const [source, setSource] = useState<'dataset' | 'manual'>('dataset');
  // '' = As-is: call the external agent without swapping any prompt version.
  const [nodeNm, setNodeNm] = useState<string>('');
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [ver, setVer] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<string[]>([...RAGAS_METRICS]);
  const [scoreOn, setScoreOn] = useState(true);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live streaming state: results trickle in (answers first, then scores).
  const [live, setLive] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const runIdRef = useRef<number | null>(null);
  const wsRef = useRef<EventSource | null>(null);
  // Manual (raw single message, unscored) state.
  const [message, setMessage] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [userId, setUserId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [callResult, setCallResult] = useState<DirectResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeNm) { setVersions([]); return; }
    api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`).then(setVersions).catch(() => setVersions([]));
  }, [nodeNm]);
  // Default to the latest version of the selected node (list is newest-first).
  useEffect(() => { setVer(versions[0]?.prompt_id ?? null); }, [versions]);

  const canRun = !!datasetId && (!scoreOn || metrics.length > 0) && (!nodeNm || ver != null);
  const canCall = callStatus !== 'running' && !!message.trim() && (!scoreOn || metrics.length > 0);

  async function run() {
    if (!canRun) return;
    setError(null); setDetail(null); setStatus('running');
    setLive([]); setTotal(0); setCancelling(false); runIdRef.current = null;
    try {
      const r = await api.post<{ ragas_run_id: number }>('/flow/test/ragas', {
        dataset_id: datasetId, metrics: scoreOn ? metrics : [], score: scoreOn,
        node_nm: nodeNm || null, prompt_id: nodeNm ? ver : null,
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

  async function call() {
    if (!canCall) return;
    setCallError(null); setCallResult(null); setCallStatus('running');
    try {
      setCallResult(await api.post<DirectResult>('/flow/test/direct', {
        message,
        base_url: baseUrl.trim() || null,
        auth_key: authKey.trim() || null,
        user_id: userId.trim() || null,
        score: scoreOn,
        metrics: scoreOn ? metrics : undefined,
      }));
      setCallStatus('done');
    } catch (e) { setCallError(errText(e)); setCallStatus('failed'); }
  }

  const answered = live.filter((r) => r.answer !== null || r.error_msg).length;
  const scored = live.filter((r) => RAGAS_METRICS.some((m) => r[m] !== null) || r.error_msg).length;
  const manualScores = callResult ? directScoresRow(callResult) : null;

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        {source === 'dataset' ? (
          <div className="flex items-center gap-3 overflow-x-auto [&>*]:shrink-0">
            <SegToggle
              value={source}
              onChange={setSource}
              options={[{ id: 'dataset', label: 'Dataset' }, { id: 'manual', label: 'Manual' }]}
            />
            <Select value={nodeNm} onChange={(e) => setNodeNm(e.target.value)} className="w-52">
              <option value="">As-is (no prompt swap)</option>
              {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
            </Select>
            {nodeNm && <VersionSelect versions={versions} value={ver} onChange={setVer} placeholder="Select version" />}
            <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
            <Button
              variant={status === 'running' ? 'secondary' : 'primary'}
              className="whitespace-nowrap"
              disabled={status === 'running' ? cancelling : !canRun}
              onClick={status === 'running' ? cancel : run}
            >
              {status === 'running' ? (cancelling ? 'Cancelling…' : 'Cancel run') : 'Run'}
            </Button>
            <StatusPill status={status} />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <SegToggle
              value={source}
              onChange={setSource}
              options={[{ id: 'dataset', label: 'Dataset' }, { id: 'manual', label: 'Manual' }]}
            />
            <span className="text-xs text-muted">외부 에이전트에 메시지 하나를 그대로 보냅니다.</span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-line pt-3">
          <ScoreToggle on={scoreOn} onChange={setScoreOn} />
          {scoreOn && (
            <>
              <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-line" />
              <MetricChips metrics={metrics} setMetrics={setMetrics} />
              {metrics.length === 0 && <span className="ml-1 text-[11px] text-bad">지표를 하나 이상 선택하세요</span>}
            </>
          )}
        </div>

        {source === 'manual' && (
          <>
            <div className="mt-3">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Message <span className="text-bad">*</span></label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Message sent as-is to the external API"
                className="w-full text-sm"
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button variant="primary" disabled={!canCall} onClick={call}>
                {callStatus === 'running' ? 'Calling…' : 'Call'}
              </Button>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs font-medium text-muted hover:text-ink"
              >
                {showAdvanced ? 'Hide endpoint settings' : 'Endpoint settings (optional)'}
              </button>
              <StatusPill status={callStatus} />
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
          </>
        )}
      </Card>

      {source === 'manual' ? (
        <>
          {callError && <ErrBox msg={callError} />}
          {callStatus === 'idle' && !callError && (
            <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
              <div className="text-sm text-ink">메시지를 입력하고 <span className="font-medium">Call</span>을 누르세요.</div>
              <div className="text-xs text-muted">외부 API 응답을 그대로 보여주며, RAGAS 채점을 켜면 점수도 함께 표시됩니다.</div>
            </Card>
          )}
          {callStatus === 'running' && (
            <Card className="px-6 py-12 text-center text-xs text-muted">Calling external API…</Card>
          )}
          {callResult && callStatus !== 'running' && (
            <Card>
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-ink">Response</h3>
              </div>
              <div className="p-4">
                <AnswerBox text={callResult.response} />
                {manualScores && <div className="mt-4"><ScoreBars row={manualScores} /></div>}
                {callResult.docs.length > 0 && (
                  <div className="mt-4 border-t border-line pt-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Contexts ({callResult.docs.length})</p>
                    <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto pl-4 text-xs text-muted">
                      {callResult.docs.map((d, i) => (<li key={i} className="whitespace-pre-wrap break-words">{d}</li>))}
                    </ol>
                  </div>
                )}
                <div className="mt-4 border-t border-line pt-3">
                  <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-xs font-medium text-muted hover:text-ink">
                    {showRaw ? 'Hide raw response' : 'Raw response (JSON)'}
                  </button>
                  {showRaw && (
                    <pre className="mt-2 max-h-72 overflow-auto rounded-sm border border-line bg-bg/60 p-3 text-xs text-ink">
                      {JSON.stringify(callResult.raw, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
      {error && <ErrBox msg={error} />}
      {detail?.error_msg && <ErrBox msg={detail.error_msg} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">데이터셋을 선택한 뒤 <span className="font-medium">Run</span>을 누르세요.</div>
          <div className="text-xs text-muted">프롬프트 버전을 고르면 그 버전으로 교체해 평가하고, As-is면 현재 상태 그대로 평가합니다. 지난 결과는 Records 탭에서 확인할 수 있습니다.</div>
        </Card>
      )}

      {/* Live streaming view while running: answers appear first, scores fill in. */}
      {status === 'running' && (
        <Card>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
            <h3 className="mr-1 text-sm font-semibold text-ink">Results</h3>
            <Badge tone="neutral" dot>{cancelling ? 'CANCELLING' : 'RUNNING'}</Badge>
            <span className="ml-auto">Answered {answered}/{total || '…'}{scoreOn ? ` · Scored ${scored}/${total || '…'}` : ''}</span>
          </div>
          <div className="p-4">
            {live.length > 0
              ? <CaseTable detail={{ results: live } as RagasRunDetail} scored={scoreOn} />
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
              <p className="mt-3 text-xs text-muted">취소된 실행 — 답변만 저장되고 점수는 없습니다.</p>
            )}
          </div>
        </Card>
      )}
        </>
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
  const [scoreOn, setScoreOn] = useState(true);
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

  const canRun = !!(nodeNm && verA && verB && verA !== verB && datasetId) && (!scoreOn || metrics.length > 0) && status !== 'running';
  const verLabel = (id: number | null) => versions.find((v) => v.prompt_id === id)?.version_no ?? '';

  async function run() {
    if (!canRun) return;
    setError(null); setDetailA(null); setDetailB(null); setStatus('running');
    setLiveA([]); setLiveB([]); setTotal(0); setCancelling(false); runIdsRef.current = [];
    try {
      const r = await api.post<{ ragas_run_a_id: number; ragas_run_b_id: number }>('/flow/test/ragas/ab', {
        dataset_id: datasetId, node_nm: nodeNm, prompt_id_a: verA, prompt_id_b: verB,
        metrics: scoreOn ? metrics : [], score: scoreOn,
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
        <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-line pt-3">
          <ScoreToggle on={scoreOn} onChange={setScoreOn} />
          {scoreOn && (
            <>
              <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-line" />
              <MetricChips metrics={metrics} setMetrics={setMetrics} />
              {metrics.length === 0 && <span className="ml-1 text-[11px] text-bad">지표를 하나 이상 선택하세요</span>}
            </>
          )}
        </div>
      </Card>

      {error && <ErrBox msg={error} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">노드와 비교할 <span className="font-medium">두 버전</span>을 선택한 뒤 실행하세요.</div>
          <div className="text-xs text-muted">A/B 간에는 해당 노드의 시스템 프롬프트만 교체되며, 두 실행 모두 같은 데이터셋으로 채점됩니다.</div>
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
                    scored={scoreOn}
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
              <p className="mt-3 text-xs text-muted">취소된 실행 — 답변만 저장되고 점수는 없습니다.</p>
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
            <div className="py-12 text-center text-sm text-muted">데이터셋을 선택하세요.</div>
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

// Records-tab type filter: an A/B pair is 'compare', everything else (dataset
// or manual, scored or not) is a 'single' run.
type RunTypeFilter = 'all' | 'single' | 'compare';
const RUN_TYPE_FILTERS: { id: RunTypeFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'single', label: 'Single' },
  { id: 'compare', label: 'Compare' },
];
function groupType(g: RunGroup): Exclude<RunTypeFilter, 'all'> {
  return g.kind === 'ab' ? 'compare' : 'single';
}

type RunSortKey = 'created' | 'avg';

const RUNS_PAGE_SIZE = 20; // rows per Records page — same as inview's question table

/** Status pill = inview .pill: tinted rounded background + dot + text.
 * FAILED red (wins in mixed pair states like DONE/FAILED), DONE green,
 * everything else (RUNNING/CANCELLED…) muted. */
function StatusText({ s }: { s: string }) {
  const tone = s.includes('FAILED') ? 'bad' : s.includes('DONE') ? 'ok' : 'neutral';
  return <Badge tone={tone} dot>{s}</Badge>;
}

/** Run-type label — plain colored text (badges read too heavy at this density):
 * Single blue, Compare purple (= inview node/model chip colors). */
function TypeText({ t }: { t: Exclude<RunTypeFilter, 'all'> }) {
  return (
    <span className={cnstr('text-xs font-semibold', t === 'compare' ? 'text-[#7c3aed]' : 'text-accent')}>
      {t === 'compare' ? 'Compare' : 'Single'}
    </span>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.5v7m0 0L5.25 6.75M8 9.5l2.75-2.75M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.75 4.25h10.5M6.5 2.5h3M5.5 4.5l.4 8a1 1 0 0 0 1 .95h2.2a1 1 0 0 0 1-.95l.4-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Per-row actions: quiet icon-only ghost buttons (inview .btn idiom at table
 * density). Row expansion lives on the row itself, so only export + delete
 * remain here; stopPropagation keeps clicks from toggling the row. */
function RowActionsCell({ csvHref, onDelete }: { csvHref: string; onDelete: () => void }) {
  const base =
    'inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return (
    <TD className="whitespace-nowrap text-right">
      <div className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <a href={csvHref} title="CSV 내보내기" className={cnstr(base, 'hover:bg-surface-3 hover:text-ink')}>
          <DownloadIcon />
        </a>
        <button type="button" title="삭제" onClick={onDelete} className={cnstr(base, 'hover:bg-bad/10 hover:text-bad')}>
          <TrashIcon />
        </button>
      </div>
    </TD>
  );
}

/** Sortable column header = inview .qth-sort: sortable columns always show a
 * faint ↕ affordance; the active sort darkens to ink with a solid ▲/▼. */
function SortTH({
  k, label, sort, onSort, className, title,
}: {
  k: RunSortKey; label: string;
  sort: { key: RunSortKey; dir: 'asc' | 'desc' };
  onSort: (k: RunSortKey) => void;
  className?: string; title?: string;
}) {
  const active = sort.key === k;
  return (
    <TH className={cnstr('whitespace-nowrap', className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        title={title}
        className={cnstr('inline-flex items-center gap-1 transition-colors', active ? 'text-ink' : 'hover:text-ink')}
      >
        {label}
        <span className={cnstr('text-[9px] leading-none', !active && 'opacity-50')} aria-hidden>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </TH>
  );
}

/** Score cell: a small 0..1 track bar beside the value — same visual language
 * as the detail views' MetricBar, without overlapping the number. */
function AvgCell({ mean }: { mean: number | null }) {
  return (
    <TD className="font-mono text-xs font-semibold tabular-nums text-ink">
      <div className="flex items-center gap-2">
        {mean != null && (
          <span aria-hidden className="relative h-1.5 w-10 overflow-hidden rounded-full bg-bg">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              style={{ width: `${Math.max(0, Math.min(1, mean)) * 100}%` }}
            />
          </span>
        )}
        <span>{fmt2(mean)}</span>
      </div>
    </TD>
  );
}

function RecordsPanel() {
  const [ragas, setRagas] = useState<RagasRunSummary[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<RunTypeFilter>('all');
  const [sort, setSort] = useState<{ key: RunSortKey; dir: 'asc' | 'desc' }>({ key: 'created', dir: 'desc' });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filter, sort, query]);
  const reload = useCallback(() => {
    api.get<RagasRunSummary[]>('/ragas-runs').then(setRagas).catch(() => setRagas([]));
  }, []);
  useEffect(reload, [reload]);
  async function del(id: number) { await api.del(`/ragas-runs/${id}`); if (open === id) setOpen(null); reload(); }
  async function delPair(ids: number[]) { await Promise.all(ids.map((i) => api.del(`/ragas-runs/${i}`))); setOpen(null); reload(); }
  const toggleSort = (key: RunSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  // The avg sort reads the pair's B side (the Avg cell shows B); the created
  // sort uses the run id, which is monotonic with creation time.
  const sortVal = (g: RunGroup): number | null => {
    if (sort.key === 'created') return g.kind === 'single' ? g.run.ragas_run_id : g.a.ragas_run_id;
    return runMean(g.kind === 'single' ? g.run : g.b);
  };
  // Free-text search over what identifies a run: node/version, dataset,
  // (first) question — which is the message for direct calls — and run id.
  const q = query.trim().toLowerCase();
  const matches = (g: RunGroup): boolean => {
    if (!q) return true;
    const rs = g.kind === 'single' ? [g.run] : [g.a, g.b];
    return rs.some((r) =>
      [r.node_nm, r.version_no != null ? `v${r.version_no}` : null, r.dataset_nm, r.first_question, `#${r.ragas_run_id}`]
        .some((v) => v != null && v.toLowerCase().includes(q)),
    );
  };
  const groups = groupRuns(ragas)
    .filter((g) => (filter === 'all' || groupType(g) === filter) && matches(g))
    .sort((x, y) => {
      const vx = sortVal(x); const vy = sortVal(y);
      if (vx == null && vy == null) return 0;
      if (vx == null) return 1; // unscored rows sink to the bottom either way
      if (vy == null) return -1;
      return sort.dir === 'asc' ? vx - vy : vy - vx;
    });
  const pageCount = Math.max(1, Math.ceil(groups.length / RUNS_PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1); // clamp after deletes shrink the list
  const paged = groups.slice(curPage * RUNS_PAGE_SIZE, curPage * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE);
  // Columns: expand, Run, Type, Status, Dataset, Engine, Avg, Created, actions.
  // Per-metric scores live in the expanded Details view, not the list.
  const cols = 9;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">실행 기록 <span className="text-muted">({groups.length})</span></h2>
        <div className="flex items-center gap-2.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="노드 · 데이터셋 · 질문 검색"
            className="h-8 w-56 text-xs"
          />
          <SegToggle value={filter} onChange={setFilter} options={RUN_TYPE_FILTERS} />
          <Button variant="secondary" size="sm" onClick={reload}>새로고침</Button>
        </div>
      </div>
      <Table>
        <THead>
          <TR>
            <TH className="w-7 px-2" />
            <TH>실행</TH><TH>유형</TH><TH>상태</TH><TH>데이터셋</TH><TH>엔진</TH>
            <SortTH k="avg" label="평균" sort={sort} onSort={toggleSort} title="채점된 지표들의 평균" />
            <SortTH k="created" label="생성일시" sort={sort} onSort={toggleSort} />
            <TH />
          </TR>
        </THead>
        <TBody>
          {paged.map((g) => {
            if (g.kind === 'single') {
              const r = g.run;
              const isOpen = open === r.ragas_run_id;
              const mean = runMean(r);
              return (
                <Fragment key={`r${r.ragas_run_id}`}>
                  {/* An open row keeps the hover surface (= inview .qrow.open) so it reads as
                      one block with the detail panel below. */}
                  <TR
                    className={cnstr('cursor-pointer', isOpen && 'bg-surface-2')}
                    onClick={() => setOpen(isOpen ? null : r.ragas_run_id)}
                  >
                    <TD className="px-2 text-center text-muted">{isOpen ? '▾' : '▸'}</TD>
                    <TD>
                      {/* Manual runs have no node/version identity — the sent message is the run's name. */}
                      {r.is_manual ? (
                        <div className="max-w-[18rem] truncate text-sm text-ink" title={r.first_question ?? undefined}>
                          {r.first_question ?? '—'}
                        </div>
                      ) : (
                        <div className="whitespace-nowrap text-sm text-ink">
                          {r.node_nm
                            ? <>{r.node_nm} <span className="text-muted">· v{r.version_no ?? '—'}</span></>
                            : 'As-is'}
                        </div>
                      )}
                      <div className="font-mono text-[11px] text-muted">#{r.ragas_run_id}</div>
                    </TD>
                    <TD><TypeText t="single" /></TD>
                    <TD><StatusText s={r.status} /></TD>
                    {/* Manual runs log into the hidden sink dataset — not meaningful, show a dash. */}
                    <TD className="text-xs text-muted" title={r.is_manual ? undefined : r.dataset_nm ?? undefined}>
                      <div className="max-w-[11rem] truncate">{r.is_manual ? '—' : (r.dataset_nm ?? '—')}</div>
                    </TD>
                    <TD className="text-xs text-muted">{r.engine === 'direct' ? '—' : (r.engine ?? '—')}</TD>
                    <AvgCell mean={mean} />
                    <TD className="whitespace-nowrap text-xs text-muted" title={r.created_dt}>{fmtDt(r.created_dt)}</TD>
                    <RowActionsCell
                      csvHref={`${API_BASE}/ragas-runs/${r.ragas_run_id}/export?fmt=csv`}
                      onDelete={() => del(r.ragas_run_id)}
                    />
                  </TR>
                  {r.error_msg && <TR><TD colSpan={cols} className="bg-bad/5 text-xs text-bad">⚠ {r.error_msg}</TD></TR>}
                  {isOpen && (
                    <TR><TD colSpan={cols} className="bg-surface-2 p-3"><RagasRunDetailView ragasId={r.ragas_run_id} /></TD></TR>
                  )}
                </Fragment>
              );
            }
            // A/B pair → one row (metric cells show candidate B; expand shows A-vs-B delta)
            const open2 = open === g.groupId;
            const stat = g.a.status === g.b.status ? g.a.status : `${g.a.status}/${g.b.status}`;
            return (
              <Fragment key={`ab${g.groupId}`}>
                <TR className={cnstr('cursor-pointer', open2 && 'bg-surface-2')} onClick={() => setOpen(open2 ? null : g.groupId)}>
                  <TD className="px-2 text-center text-muted">{open2 ? '▾' : '▸'}</TD>
                  <TD>
                    <div className="whitespace-nowrap text-sm text-ink">
                      {g.a.node_nm ?? '—'} <span className="text-muted">· v{g.a.version_no ?? '—'}→v{g.b.version_no ?? '—'}</span>
                    </div>
                    <div className="font-mono text-[11px] text-muted">#{g.a.ragas_run_id}/#{g.b.ragas_run_id}</div>
                  </TD>
                  <TD><TypeText t="compare" /></TD>
                  <TD><StatusText s={stat} /></TD>
                  <TD className="text-xs text-muted" title={g.a.dataset_nm ?? undefined}>
                    <div className="max-w-[11rem] truncate">{g.a.dataset_nm ?? '—'}</div>
                  </TD>
                  <TD className="text-xs text-muted">{g.b.engine ?? '—'}</TD>
                  <AvgCell mean={runMean(g.b)} />
                  <TD className="whitespace-nowrap text-xs text-muted" title={g.a.created_dt}>{fmtDt(g.a.created_dt)}</TD>
                  <RowActionsCell
                    csvHref={`${API_BASE}/ragas-runs/ab/${g.groupId}/export?fmt=csv`}
                    onDelete={() => delPair([g.a.ragas_run_id, g.b.ragas_run_id])}
                  />
                </TR>
                {open2 && (
                  <TR><TD colSpan={cols} className="bg-surface-2 p-3"><AbCompareView aId={g.a.ragas_run_id} bId={g.b.ragas_run_id} labelA={g.a.version_no ?? ''} labelB={g.b.version_no ?? ''} /></TD></TR>
                )}
              </Fragment>
            );
          })}
          {groups.length === 0 && (
            <TR><TD colSpan={cols} className="py-10 text-center text-sm text-muted">
              {ragas.length === 0 ? '아직 평가 실행 기록이 없습니다.' : '검색 · 필터 조건에 맞는 기록이 없습니다.'}
            </TD></TR>
          )}
        </TBody>
      </Table>
      {groups.length > RUNS_PAGE_SIZE && (
        <RunsPager
          curPage={curPage}
          pageCount={pageCount}
          total={groups.length}
          onPage={setPage}
        />
      )}
    </Card>
  );
}

/** Centered prev/next pager under the runs table = inview .qpager. */
function RunsPager({
  curPage, pageCount, total, onPage,
}: {
  curPage: number; pageCount: number; total: number; onPage: (f: (p: number) => number) => void;
}) {
  const btn =
    'rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors ' +
    'hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40';
  const from = curPage * RUNS_PAGE_SIZE + 1;
  const to = Math.min(total, from + RUNS_PAGE_SIZE - 1);
  return (
    <div className="flex items-center justify-center gap-3.5 border-t border-line px-4 py-3">
      <button type="button" disabled={curPage === 0} onClick={() => onPage((p) => Math.max(0, p - 1))} className={btn}>
        ‹ 이전
      </button>
      <span className="font-mono text-xs font-semibold tabular-nums text-muted">
        {curPage + 1} / {pageCount}
        <span className="font-normal text-muted/60"> · {from}–{to} / {total}</span>
      </span>
      <button
        type="button"
        disabled={curPage >= pageCount - 1}
        onClick={() => onPage((p) => Math.min(pageCount - 1, p + 1))}
        className={btn}
      >
        다음 ›
      </button>
    </div>
  );
}

function AbCompareView({ aId, bId, labelA, labelB }: { aId: number; bId: number; labelA: string; labelB: string }) {
  const [a, setA] = useState<RagasRunDetail | null>(null);
  const [b, setB] = useState<RagasRunDetail | null>(null);
  useEffect(() => {
    api.get<RagasRunDetail>(`/ragas-runs/${aId}`).then(setA).catch(() => setA(null));
    api.get<RagasRunDetail>(`/ragas-runs/${bId}`).then(setB).catch(() => setB(null));
  }, [aId, bId]);
  if (!a || !b) return <div className="text-xs text-muted">불러오는 중…</div>;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <CaseCompareTable detailA={a} detailB={b} labelA={labelA} labelB={labelB} />
      </div>
      {(a.status === 'CANCELLED' || b.status === 'CANCELLED') && (
        <p className="text-xs text-muted">취소된 실행 — 답변만 저장되고 점수는 없습니다.</p>
      )}
    </div>
  );
}

function RagasRunDetailView({ ragasId }: { ragasId: number }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  useEffect(() => { api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`).then(setDetail).catch(() => setDetail(null)); }, [ragasId]);
  if (!detail) return <div className="text-xs text-muted">불러오는 중…</div>;
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
          <span className="truncate text-sm font-medium text-ink" title={METRIC_DESCRIPTIONS[m]}>{METRIC_LABELS[m]}</span>
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
  scored,
}: {
  detailA: RagasRunDetail;
  detailB: RagasRunDetail;
  labelA: string;
  labelB: string;
  scored?: boolean;
}) {
  const byA = new Map(detailA.results.map((r) => [r.case_id, r] as const));
  const byB = new Map(detailB.results.map((r) => [r.case_id, r] as const));
  const ids = Array.from(new Set([...byA.keys(), ...byB.keys()]));
  // Answers only if either run was cancelled (incomplete scoring) or the pair
  // ran without scoring (METRICS='[]'); live streaming passes `scored` directly.
  const showScores =
    detailA.status !== 'CANCELLED' && detailB.status !== 'CANCELLED' &&
    (scored ?? (detailA.metrics !== '[]' && detailB.metrics !== '[]'));
  // Collapsed by default — see CaseTable.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const keys = ids.map((cid) => String(cid));
  const allClosed = opened.size === 0;
  const toggle = (k: string) =>
    setOpened((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (ids.length === 0) {
    return <div className="py-8 text-center text-xs text-muted">결과가 없습니다</div>;
  }
  return (
    <div className="divide-y divide-line">
      {ids.length > 1 && (
        <CollapseAllStrip allClosed={allClosed} onToggle={() => setOpened(allClosed ? new Set(keys) : new Set())} />
      )}
      {ids.map((cid) => {
        const key = String(cid);
        const isClosed = !opened.has(key);
        const a = byA.get(cid);
        const b = byB.get(cid);
        const q = a?.question ?? b?.question ?? '—';
        const gt = a?.ground_truth ?? b?.ground_truth ?? null;
        const aMean = caseMean(a);
        const bMean = caseMean(b);
        return (
          <div key={key}>
            <button
              type="button"
              onClick={() => toggle(key)}
              className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
            >
              <Chevron open={!isClosed} className="mt-1" />
              <span className={cnstr('min-w-0 flex-1 text-sm text-ink', isClosed ? 'truncate' : 'whitespace-pre-wrap break-words font-medium')}>
                {q}
              </span>
              {isClosed && (a?.answer != null || b?.answer != null) && (
                <span className="mt-0.5 flex min-w-0 flex-[2] items-baseline gap-2.5 text-xs text-muted">
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold">A</span> {a?.answer ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold">B</span> {b?.answer ?? '—'}</span>
                </span>
              )}
              {isClosed && showScores && (
                aMean != null || bMean != null
                  ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      <span className={cnstr(aMean != null && bMean != null && aMean > bMean && 'font-semibold text-ink')}>A {fmt3(aMean)}</span>
                      {' · '}
                      <span className={cnstr(aMean != null && bMean != null && bMean > aMean && 'font-semibold text-ink')}>B {fmt3(bMean)}</span>
                    </span>
                  : <span className="shrink-0 text-[11px] text-muted">채점 중…</span>
              )}
            </button>
            {!isClosed && (
              <div className="px-4 pb-3.5 pl-10">
                {gt && <p className="mb-3 whitespace-pre-wrap text-xs text-muted"><span className="font-medium">Ground truth ·</span> {gt}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            )}
          </div>
        );
      })}
    </div>
  );
}

// Per-case A/B score box — its own collapsible section (collapsed by default):
// the header always shows both means (winner bold); bars unfold on demand.
function CaseScoreBars({ a, b }: { a?: RagasResultRow; b?: RagasResultRow }) {
  const [open, setOpen] = useState(false);
  const rows = buildMetricRows(a, b);
  const scored = rows.some((r) => r.av != null || r.bv != null);
  const aMean = caseMean(a);
  const bMean = caseMean(b);
  if (!scored) {
    return (
      <div className="mt-3 overflow-hidden rounded-sm border border-line bg-surface">
        <div className="py-3 text-center text-[11px] text-muted">채점 중…</div>
      </div>
    );
  }
  return (
    <div className="mt-3 overflow-hidden rounded-sm border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 bg-surface-2/60 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <Chevron open={open} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">점수</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">
          <span className={cnstr(aMean != null && bMean != null && aMean > bMean && 'font-semibold text-ink')}>A {fmt3(aMean)}</span>
          {' · '}
          <span className={cnstr(aMean != null && bMean != null && bMean > aMean && 'font-semibold text-ink')}>B {fmt3(bMean)}</span>
        </span>
      </button>
      {open && <div className="border-t border-line"><PairedMetricList rows={rows} /></div>}
    </div>
  );
}

// Single-run score view: one bar per metric on a 0..1 scale — the single-side
// counterpart of the A/B paired bars. Wrapped in its own collapsible section
// (collapsed by default) whose header always shows the case average.
function ScoreBars({ row }: { row: RagasResultRow }) {
  const [open, setOpen] = useState(false);
  const scored = RAGAS_METRICS.some((m) => row[m] != null);
  if (!scored) {
    return row.answer == null && row.error_msg
      ? <span className="text-[11px] text-bad">{row.error_msg}</span>
      : <span className="text-[11px] text-muted">채점 중…</span>;
  }
  const mean = caseMean(row);
  return (
    <div className="overflow-hidden rounded-sm border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 bg-surface-2/60 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <Chevron open={open} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">점수</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">평균 <span className="font-semibold text-ink">{fmt3(mean)}</span></span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
          {RAGAS_METRICS.map((m) => {
            const v = row[m] != null ? Number(row[m]) : null;
            const pct = v != null ? Math.max(0, Math.min(1, v)) * 100 : 0;
            return (
              <li key={m} className="grid grid-cols-[minmax(92px,auto)_1fr_auto] items-center gap-3">
                <span className="truncate text-[11px] text-muted" title={METRIC_DESCRIPTIONS[m]}>{METRIC_LABELS[m]}</span>
                <div className="relative h-2 overflow-hidden rounded-full bg-bg">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct + '%' }} />
                </div>
                <span className={'w-12 shrink-0 text-right font-mono text-xs tabular-nums ' + (v != null ? 'text-ink' : 'text-muted')}>{fmt3(v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Small rotating disclosure chevron shared by collapsible rows.
function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      className={cnstr('shrink-0 text-muted transition-transform', open && 'rotate-90', className)}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
// Tiny class joiner (page-local; the ui components use @/lib/cn).
function cnstr(...xs: (string | false | undefined)[]) { return xs.filter(Boolean).join(' '); }

// Mean of one case's available metric scores (null until something is scored).
function caseMean(r: RagasResultRow | undefined): number | null {
  if (!r) return null;
  const vs = RAGAS_METRICS.map((m) => r[m]).filter((v): v is number => v != null);
  return vs.length ? vs.reduce((s, v) => s + Number(v), 0) / vs.length : null;
}

/** 'Collapse all / Expand all' strip shown above case lists with >1 case. */
function CollapseAllStrip({ allClosed, onToggle }: { allClosed: boolean; onToggle: () => void }) {
  return (
    <div className="flex justify-end bg-surface-2/60 px-4 py-1.5">
      <button type="button" onClick={onToggle} className="text-[11px] font-medium text-muted hover:text-ink">
        {allClosed ? '모두 펼치기' : '모두 접기'}
      </button>
    </div>
  );
}

// Answer-centric case view: each case is a collapsible block. The header line is
// the question (plus its average score when collapsed); the body holds ground
// truth, answer, and the per-metric score bars.
function CaseTable({ detail, bordered, scored }: { detail: RagasRunDetail; bordered?: boolean; scored?: boolean }) {
  // Answers only (no score chips) for: cancelled runs (incomplete scoring),
  // legacy direct calls (engine 'direct'), and no-scoring runs (METRICS='[]').
  // Live streaming passes `scored` explicitly since its detail stub has no metadata.
  const showScores =
    detail.status !== 'CANCELLED' && (scored ?? (detail.engine !== 'direct' && detail.metrics !== '[]'));
  // Collapsed by default — tracking the *opened* set keeps late-arriving
  // (streamed) rows collapsed too.
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const ids = detail.results.map((r) => r.ragas_result_id);
  const allClosed = opened.size === 0;
  const toggle = (id: number) =>
    setOpened((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const list = (
    <div className="divide-y divide-line">
      {ids.length > 1 && (
        <CollapseAllStrip allClosed={allClosed} onToggle={() => setOpened(allClosed ? new Set(ids) : new Set())} />
      )}
      {detail.results.map((r) => {
        const isClosed = !opened.has(r.ragas_result_id);
        const mean = caseMean(r);
        return (
          <div key={r.ragas_result_id}>
            <button
              type="button"
              onClick={() => toggle(r.ragas_result_id)}
              className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
            >
              <Chevron open={!isClosed} className="mt-1" />
              <span className={cnstr('min-w-0 flex-1 text-sm text-ink', isClosed ? 'truncate' : 'whitespace-pre-wrap break-words font-medium')}>
                {r.question ?? '—'}
              </span>
              {isClosed && r.answer && (
                <span className="mt-0.5 min-w-0 flex-1 truncate text-xs text-muted">{r.answer}</span>
              )}
              {isClosed && showScores && (
                mean != null
                  ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted">평균 <span className="font-semibold text-ink">{fmt3(mean)}</span></span>
                  : r.answer == null && r.error_msg
                    ? <span className="shrink-0 text-[11px] text-bad">오류</span>
                    : <span className="shrink-0 text-[11px] text-muted">채점 중…</span>
              )}
            </button>
            {!isClosed && (
              <div className={cnstr('px-4 pb-3.5 pl-10', !!r.ground_truth && 'grid gap-4 sm:grid-cols-2')}>
                {r.ground_truth && (
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Ground truth</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{r.ground_truth}</p>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">답변</p>
                  <div className="mt-0.5"><AnswerBox text={r.answer} error={r.error_msg} /></div>
                  {showScores && <div className="mt-3"><ScoreBars row={r} /></div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {detail.results.length === 0 && (
        <div className="py-8 text-center text-xs text-muted">결과가 없습니다</div>
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

/** Metric picker as an always-visible chip row (= inview .exclude-chip):
 * selected chips are accent-tinted, deselected ones sit quiet. No disclosure
 * to unfold, so the settings strip keeps a single stable line. */
function MetricChips({ metrics, setMetrics }: { metrics: string[]; setMetrics: (f: (cur: string[]) => string[]) => void }) {
  return (
    <>
      {RAGAS_METRICS.map((m) => {
        const on = metrics.includes(m);
        return (
          <button
            key={m}
            type="button"
            title={METRIC_DESCRIPTIONS[m]}
            aria-pressed={on}
            onClick={() => setMetrics((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
            className={cnstr(
              'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              on ? 'border-accent/25 bg-accent-soft/60 text-accent' : 'border-transparent text-muted hover:bg-surface-2',
            )}
          >
            {METRIC_LABELS[m]}
          </button>
        );
      })}
    </>
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
