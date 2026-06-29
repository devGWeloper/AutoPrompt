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
  type Dataset,
  type FlowCurrent,
  type FlowNode,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type RagasRunSummary,
  type RunWsMessage,
  type TestCase,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';
const errText = (e: unknown) => (e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
const fmt2 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(2) : '—');
const fmt3 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(3) : '—');

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

type Tab = 'run' | 'datasets' | 'records';
const TABS: { id: Tab; label: string }[] = [
  { id: 'run', label: '평가 실행' },
  { id: 'datasets', label: '데이터셋' },
  { id: 'records', label: '평가 기록' },
];

export default function RagasHomePage() {
  const [tab, setTab] = useState<Tab>('run');
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="px-6">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="flex-1 overflow-auto px-6 py-5">
        {tab === 'run' && <RagasPanel />}
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

// ---- run tab (single | compare) -------------------------------------------

function RagasPanel() {
  const [mode, setMode] = useState<'single' | 'compare' | 'direct'>('single');
  return (
    <div className="space-y-5">
      <SegToggle
        value={mode}
        onChange={setMode}
        options={[
          { id: 'single', label: '단일 프롬프트 실행' },
          { id: 'compare', label: '프롬프트 버전 비교' },
          { id: 'direct', label: '현재 버전 실행(GaiA)' },
        ]}
      />
      {mode === 'single' && <SingleRunPanel />}
      {mode === 'compare' && <ComparePanel />}
      {mode === 'direct' && <DirectPanel />}
    </div>
  );
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
        <label className="mb-1 block text-xs font-medium text-muted">Base URL</label>
        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="기본값: EXTERNAL_AGENT_BASE_URL" className="w-full text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Auth Key</label>
        <Input value={authKey} onChange={(e) => setAuthKey(e.target.value)} placeholder="기본값: EXTERNAL_AUTH_KEY" className="w-full text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">User ID</label>
        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="기본값: EXTERNAL_USER_ID" className="w-full text-sm" />
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
      <Card className="p-4">
        <div className="mb-3">
          <SegToggle
            value={source}
            onChange={setSource}
            options={[
              { id: 'manual', label: '직접 입력' },
              { id: 'dataset', label: '데이터셋' },
            ]}
          />
        </div>

        {source === 'manual' ? (
          <>
            <label className="mb-1 block text-xs font-medium text-muted">메시지 <span className="text-bad">*</span></label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="외부 API로 그대로 보낼 메시지"
              className="w-full text-sm"
            />
          </>
        ) : (
          <div className="flex items-center gap-3">
            <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
            <span className="text-xs text-muted">선택한 데이터셋의 모든 케이스 질문을 외부 API로 보냅니다 (채점 없음).</span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" disabled={!canSend} onClick={send}>
            {status === 'running' ? '호출 중…' : '호출'}
          </Button>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs font-medium text-muted hover:text-ink"
          >
            {showAdvanced ? '엔드포인트 설정 숨기기' : '엔드포인트 설정 (선택)'}
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
              ? <>메시지를 입력하고 <span className="font-medium">호출</span>을 누르세요.</>
              : <>데이터셋을 선택하고 <span className="font-medium">호출</span>을 누르세요.</>}
          </div>
          <div className="text-xs text-muted">채점 없이 외부 API 응답을 그대로 받아옵니다.</div>
        </Card>
      )}

      {status === 'running' && (
        <Card className="px-6 py-12 text-center text-xs text-muted">외부 API 호출 중…</Card>
      )}

      {/* Manual single-message result */}
      {result && status !== 'running' && (
        <Card className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">응답</p>
          <div className="mt-0.5"><AnswerBox text={result.response} /></div>
          {result.docs.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">문맥 ({result.docs.length})</p>
              <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto pl-4 text-xs text-muted">
                {result.docs.map((d, i) => (<li key={i} className="whitespace-pre-wrap break-words">{d}</li>))}
              </ol>
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-xs font-medium text-muted hover:text-ink">
              {showRaw ? '원본 응답 숨기기' : '원본 응답 (JSON)'}
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-bg/60 p-3 text-xs text-ink">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            )}
          </div>
        </Card>
      )}

      {/* Dataset result — one block per case (answer-centric, no scores) */}
      {rows && status !== 'running' && (
        <Card className="p-4">
          <div className="mb-3 text-xs text-muted">케이스 {rows.length}건</div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="divide-y divide-line">
              {rows.map((r) => (
                <div key={r.case_id} className="px-4 py-3.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">질문</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{r.question || '—'}</p>
                  <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">답변</p>
                  <div className="mt-0.5"><AnswerBox text={r.answer} error={r.error} /></div>
                  {r.docs.length > 0 && (
                    <ol className="mt-2 max-h-40 list-decimal space-y-1 overflow-y-auto pl-4 text-xs text-muted">
                      {r.docs.map((d, i) => (<li key={i} className="whitespace-pre-wrap break-words">{d}</li>))}
                    </ol>
                  )}
                </div>
              ))}
              {rows.length === 0 && <div className="py-8 text-center text-xs text-muted">케이스 없음</div>}
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
  const wsRef = useRef<WebSocket | null>(null);

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
      <Card className="p-4">
        <div className="flex items-center gap-3 overflow-x-auto [&>*]:shrink-0">
          <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="w-44">
            <option value="" disabled>노드 선택</option>
            {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
          </Select>
          <VersionSelect versions={versions} value={ver} onChange={setVer} placeholder="버전 선택" />
          <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
          <Button
            variant={status === 'running' ? 'secondary' : 'primary'}
            className="whitespace-nowrap"
            disabled={status === 'running' ? cancelling : !canRun}
            onClick={status === 'running' ? cancel : run}
          >
            {status === 'running' ? (cancelling ? '취소 중…' : '실행 취소') : 'RAGAS 실행'}
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
          <div className="text-sm text-ink">노드·버전·데이터셋을 선택하고 <span className="font-medium">RAGAS 실행</span>을 누르세요.</div>
          <div className="text-xs text-muted">지난 평가 결과는 ‘평가 기록’ 탭에서 볼 수 있습니다.</div>
        </Card>
      )}

      {/* Live streaming view while running: answers appear first, scores fill in. */}
      {status === 'running' && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted">
            <Badge tone="neutral">{cancelling ? 'CANCELLING' : 'RUNNING'}</Badge>
            <span>답변 {answered}/{total || '…'}</span>
            <span>·</span>
            <span>채점 {scored}/{total || '…'}</span>
          </div>
          {live.length > 0
            ? <CaseTable detail={{ results: live } as RagasRunDetail} />
            : <div className="py-8 text-center text-xs text-muted">답변 생성 중…</div>}
        </Card>
      )}

      {detail && status !== 'running' && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'}>{detail.status}</Badge>
            <span>엔진 {detail.engine ?? '—'}</span>
            <span>·</span>
            <span>케이스 {detail.results.length}건</span>
          </div>
          <CaseTable detail={detail} />
          {detail.status === 'CANCELLED'
            ? <p className="mt-3 text-xs text-muted">취소된 평가 — 채점 결과 없이 답변만 표시합니다.</p>
            : (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">평균 점수</div>
                <MetricSummary run={detail} />
              </div>
            )}
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
      <Card className="p-4">
        <div className="flex items-center gap-3 overflow-x-auto [&>*]:shrink-0">
          <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="w-44">
            <option value="" disabled>노드 선택</option>
            {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
          </Select>
          <VersionSelect versions={versions} value={verA} onChange={setVerA} placeholder="버전 A" />
          <span className="text-xs text-muted">vs</span>
          <VersionSelect versions={versions} value={verB} onChange={setVerB} placeholder="버전 B" />
          <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
          <Button
            variant={status === 'running' ? 'secondary' : 'primary'}
            className="whitespace-nowrap"
            disabled={status === 'running' ? cancelling : !canRun}
            onClick={status === 'running' ? cancel : run}
          >
            {status === 'running' ? (cancelling ? '취소 중…' : '실행 취소') : '버전 비교 실행'}
          </Button>
          <StatusPill status={status} />
        </div>
        {verA && verB && verA === verB && (
          <p className="mt-2 text-xs text-bad">버전 A와 B는 서로 달라야 합니다.</p>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <MetricChecks metrics={metrics} setMetrics={setMetrics} />
        </div>
      </Card>

      {error && <ErrBox msg={error} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">노드와 비교할 <span className="font-medium">두 버전</span>을 고르고 실행하세요.</div>
          <div className="text-xs text-muted">선택한 노드의 시스템 프롬프트만 A/B로 바꿔 같은 데이터셋으로 채점합니다.</div>
        </Card>
      )}

      {/* Live A/B streaming while running: both versions' answers appear first, scores fill in. */}
      {status === 'running' && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="neutral">RUNNING</Badge>
            <Badge tone="neutral">A · v{verLabel(verA)}</Badge>
            <span>vs</span>
            <Badge tone="accent">B · v{verLabel(verB)}</Badge>
            <span className="ml-auto">답변 A {answeredA}/{total || '…'} · B {answeredB}/{total || '…'}</span>
          </div>
          {liveA.length > 0 || liveB.length > 0
            ? <div className="overflow-hidden rounded-lg border border-line bg-surface">
                <CaseCompareTable
                  detailA={{ results: liveA } as RagasRunDetail}
                  detailB={{ results: liveB } as RagasRunDetail}
                  labelA={verLabel(verA)} labelB={verLabel(verB)}
                />
              </div>
            : <div className="py-8 text-center text-xs text-muted">답변 생성 중…</div>}
        </Card>
      )}

      {detailA && detailB && status !== 'running' && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-medium text-ink">{nodeNm}</span>
            <Badge tone="neutral">A · v{verLabel(verA)}</Badge>
            <span>vs</span>
            <Badge tone="accent">B · v{verLabel(verB)}</Badge>
            <span className="ml-auto">엔진 {detailA.engine ?? '—'}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <CaseCompareTable detailA={detailA} detailB={detailB} labelA={verLabel(verA)} labelB={verLabel(verB)} />
          </div>
          {detailA.status === 'CANCELLED' || detailB.status === 'CANCELLED'
            ? <p className="mt-3 text-xs text-muted">취소된 평가 — 채점 결과 없이 답변만 표시합니다.</p>
            : (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">지표 평균 비교</div>
                <MetricCompareTable detailA={detailA} detailB={detailB} />
              </div>
            )}
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
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 데이터셋 이름" className="w-64" />
          <Button variant="secondary" disabled={!newName.trim()} onClick={createDataset}>데이터셋 생성</Button>
        </div>
      </Card>
      {error && <ErrBox msg={error} />}
      <div className="grid grid-cols-[18rem_1fr] gap-5">
        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">데이터셋</h3>
          <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
            {datasets.map((d) => (
              <li key={d.dataset_id} className="flex items-center gap-2">
                <button
                  onClick={() => setSelDataset(d.dataset_id)}
                  className={
                    'flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors ' +
                    (selDataset === d.dataset_id ? 'border-accent/40 bg-accent/5 font-medium text-ink' : 'border-line text-ink hover:bg-bg')
                  }
                >
                  {d.dataset_nm}
                </button>
                <Button variant="danger" size="sm" onClick={() => delDataset(d.dataset_id)}>삭제</Button>
              </li>
            ))}
            {datasets.length === 0 && <li className="px-1 py-2 text-sm text-muted">데이터셋 없음</li>}
          </ul>
        </Card>
        <Card className="p-4">
          {selDataset == null ? (
            <div className="py-8 text-center text-sm text-muted">데이터셋을 선택하세요.</div>
          ) : (
            <>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">케이스 ({cases.length})</h3>
              <div className="mb-4 space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">질문 <span className="text-bad">*</span></label>
                  <Input value={caseQuestion} onChange={(e) => setCaseQuestion(e.target.value)} placeholder="평가할 질문" className="w-full text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">문맥 <span className="font-normal">(선택 · 한 줄에 하나)</span></label>
                  <Textarea value={caseContexts} onChange={(e) => setCaseContexts(e.target.value)} rows={3} placeholder={'근거 문맥 1\n근거 문맥 2'} className="w-full text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">정답 <span className="font-normal">(선택 · 정확도 지표에만 사용)</span></label>
                  <Input value={caseGroundTruth} onChange={(e) => setCaseGroundTruth(e.target.value)} placeholder="기대 정답 (ground truth)" className="w-full text-sm" />
                </div>
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" disabled={!caseQuestion.trim()} onClick={addCase}>케이스 추가</Button>
                </div>
              </div>
              <div>
                <Table>
                  <THead><TR><TH className="w-2/5">질문</TH><TH className="w-2/5">문맥</TH><TH>정답</TH><TH /></TR></THead>
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
                          <TD className="text-right align-top"><Button variant="danger" size="sm" onClick={() => delCase(c.case_id)}>삭제</Button></TD>
                        </TR>
                      );
                    })}
                    {cases.length === 0 && <TR><TD colSpan={4} className="py-6 text-center text-muted">케이스 없음</TD></TR>}
                  </TBody>
                </Table>
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
  const cols = 4 + RAGAS_METRICS.length;
  const groups = groupRuns(ragas);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">평가 기록 <span className="text-muted">({groups.length})</span></h2>
        <Button variant="secondary" size="sm" onClick={reload}>새로고침</Button>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>run</TH><TH>유형 / 상태</TH><TH>엔진</TH>
            {RAGAS_METRICS.map((m) => (<TH key={m} className="text-right whitespace-nowrap">{METRIC_LABELS[m]}</TH>))}
            <TH>생성</TH><TH />
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
                          <Badge tone="neutral">직접 호출</Badge>
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
                        {open === r.ragas_run_id ? '접기' : '상세'}
                      </button>
                      <a href={`${API_BASE}/ragas-runs/${r.ragas_run_id}/export?fmt=csv`} className="mr-3 text-xs font-medium text-muted hover:text-ink">CSV</a>
                      <button onClick={() => del(r.ragas_run_id)} className="text-xs font-medium text-bad hover:underline">삭제</button>
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
                      <Badge tone="accent">비교 v{g.a.version_no ?? '—'}→v{g.b.version_no ?? '—'}</Badge>
                      <span className="text-xs text-muted">{stat}</span>
                    </div>
                  </TD>
                  <TD className="text-xs text-muted">{g.b.engine ?? '—'}</TD>
                  {RAGAS_METRICS.map((m) => (<TD key={m} className="text-right font-mono text-xs tabular-nums">{fmt2(g.b[m])}</TD>))}
                  <TD className="whitespace-nowrap text-xs text-muted">{g.a.created_dt}</TD>
                  <TD className="whitespace-nowrap text-right">
                    <button onClick={() => setOpen(open2 ? null : g.groupId)} className="mr-3 text-xs font-medium text-accent hover:underline">
                      {open2 ? '접기' : '비교'}
                    </button>
                    <a href={`${API_BASE}/ragas-runs/ab/${g.groupId}/export?fmt=csv`} className="mr-3 text-xs font-medium text-muted hover:text-ink">CSV</a>
                    <button onClick={() => delPair([g.a.ragas_run_id, g.b.ragas_run_id])} className="text-xs font-medium text-bad hover:underline">삭제</button>
                  </TD>
                </TR>
                {open2 && (
                  <TR><TD colSpan={cols} className="bg-bg/60 p-3"><AbCompareView aId={g.a.ragas_run_id} bId={g.b.ragas_run_id} labelA={g.a.version_no ?? ''} labelB={g.b.version_no ?? ''} /></TD></TR>
                )}
              </Fragment>
            );
          })}
          {groups.length === 0 && (<TR><TD colSpan={cols} className="py-10 text-center text-sm text-muted">RAGAS 평가 기록이 없습니다.</TD></TR>)}
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
  if (!a || !b) return <div className="text-xs text-muted">불러오는 중…</div>;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <CaseCompareTable detailA={a} detailB={b} labelA={labelA} labelB={labelB} />
      </div>
      {a.status === 'CANCELLED' || b.status === 'CANCELLED'
        ? <p className="text-xs text-muted">취소된 평가 — 채점 결과 없이 답변만 표시합니다.</p>
        : (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">지표 평균 비교</div>
            <MetricCompareTable detailA={a} detailB={b} />
          </div>
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

// Compact average-score summary (secondary to the answers).
function MetricSummary({ run }: { run: RagasRunDetail }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RAGAS_METRICS.map((m) => (
        <span key={m} className="inline-flex items-center gap-1.5 rounded border border-line bg-bg/60 px-2 py-1 text-xs text-muted">
          {METRIC_LABELS[m]}
          <span className="font-mono tabular-nums text-ink">{fmt3(run[m])}</span>
        </span>
      ))}
    </div>
  );
}

function MetricCompareTable({ detailA, detailB }: { detailA: RagasRunDetail; detailB: RagasRunDetail }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <Table>
        <THead>
          <TR>
            <TH>지표</TH>
            <TH className="text-right">A · v{detailA.version_no ?? '—'}</TH>
            <TH className="text-right">B · v{detailB.version_no ?? '—'}</TH>
            <TH className="text-right">Δ (B−A)</TH>
          </TR>
        </THead>
        <TBody>
          {RAGAS_METRICS.map((m) => {
            const av = detailA[m];
            const bv = detailB[m];
            const d = av != null && bv != null ? Number(bv) - Number(av) : null;
            return (
              <TR key={m}>
                <TD className="font-medium text-ink">{METRIC_LABELS[m]}</TD>
                <TD className="text-right font-mono tabular-nums">{fmt3(av)}</TD>
                <TD className="text-right font-mono tabular-nums">{fmt3(bv)}</TD>
                <TD className={'text-right font-mono tabular-nums ' + (d == null ? 'text-muted' : d >= 0 ? 'text-ok' : 'text-bad')}>
                  {d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(3)}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

/** Score chips for one side of an A/B case. When ``vs`` is given (the other
 * side), each value is coloured better/worse to preserve the comparison. */
function AbScoreChips({ row, vs, compare }: { row?: RagasResultRow; vs?: RagasResultRow; compare?: boolean }) {
  const present = RAGAS_METRICS.filter((m) => row?.[m] != null);
  if (present.length === 0) {
    return row?.answer == null && row?.error_msg
      ? <span className="text-[11px] text-bad">{row.error_msg}</span>
      : <span className="text-[11px] text-muted">채점 대기…</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {present.map((m) => {
        const v = Number(row![m]);
        const o = vs?.[m];
        const cls = compare && o != null
          ? (v > Number(o) ? 'text-ok' : v < Number(o) ? 'text-bad' : 'text-ink')
          : 'text-ink';
        return (
          <span key={m} className="inline-flex items-center gap-1 rounded border border-line bg-bg/60 px-1.5 py-0.5 text-[11px] text-muted">
            {METRIC_LABELS[m]}
            <span className={'font-mono tabular-nums ' + cls}>{fmt2(row![m])}</span>
          </span>
        );
      })}
    </div>
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
// side as the focus; scores are small chips (B coloured vs A for comparison).
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
    return <div className="py-8 text-center text-xs text-muted">결과 행 없음</div>;
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
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">질문</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{q}</p>
            {gt && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted"><span className="font-medium">정답 ·</span> {gt}</p>}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-bg/40 p-3">
                <Badge tone="neutral">A · v{labelA}</Badge>
                <div className="mt-2"><AnswerBox text={a?.answer} error={a?.error_msg} /></div>
                {showScores && <div className="mt-2.5"><AbScoreChips row={a} /></div>}
              </div>
              <div className="rounded-lg border border-line bg-bg/40 p-3">
                <Badge tone="accent">B · v{labelB}</Badge>
                <div className="mt-2"><AnswerBox text={b?.answer} error={b?.error_msg} /></div>
                {showScores && <div className="mt-2.5"><AbScoreChips row={b} vs={a} compare /></div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact, secondary score chips for one case (answer-centric layout). */
function ScoreChips({ row }: { row: RagasResultRow }) {
  const present = RAGAS_METRICS.filter((m) => row[m] !== null);
  if (present.length === 0) {
    return row.answer == null && row.error_msg
      ? <span className="text-[11px] text-bad">{row.error_msg}</span>
      : <span className="text-[11px] text-muted">채점 대기…</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {present.map((m) => (
        <span key={m} className="inline-flex items-center gap-1 rounded border border-line bg-bg/60 px-1.5 py-0.5 text-[11px] text-muted">
          {METRIC_LABELS[m]}
          <span className="font-mono tabular-nums text-ink">{fmt2(row[m])}</span>
        </span>
      ))}
    </div>
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
        <div key={r.ragas_result_id} className="px-4 py-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">질문</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{r.question ?? '—'}</p>

          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">답변</p>
          <div className="mt-0.5"><AnswerBox text={r.answer} error={r.error_msg} /></div>
          {r.ground_truth && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-muted"><span className="font-medium">정답 ·</span> {r.ground_truth}</p>
          )}

          {showScores && <div className="mt-3"><ScoreChips row={r} /></div>}
        </div>
      ))}
      {detail.results.length === 0 && (
        <div className="py-8 text-center text-xs text-muted">결과 행 없음</div>
      )}
    </div>
  );
  if (detail.error_msg) {
    return (
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line bg-bad/5 px-3 py-2 text-xs text-bad">{detail.error_msg}</div>
        {list}
      </div>
    );
  }
  return bordered ? <div className="overflow-hidden rounded-lg border border-line bg-surface">{list}</div> : list;
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
          {m}
        </label>
      ))}
    </div>
  );
}

function DatasetSelect({ datasets, value, onChange }: { datasets: Dataset[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="w-48">
      <option value="" disabled>데이터셋</option>
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
  return <span className="text-sm text-muted">상태 · {status}</span>;
}
function ErrBox({ msg }: { msg: string }) {
  return <div className="rounded-lg border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{msg}</div>;
}
