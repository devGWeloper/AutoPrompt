'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { connectRagasRunWs } from '@/lib/ws';
import {
  RAGAS_METRICS,
  type RagasMetric,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type RunWsMessage,
} from '@/lib/types';
import {
  DatasetSelect,
  ErrBox,
  MetricChips,
  ScoreToggle,
  SegToggle,
  StatusPill,
  VersionSelect,
  CaseTable,
  ScoreBars,
  AnswerBox,
  errText,
  fmt3,
  runMean,
  upsertResult,
  useFlowDatasets,
  usePromptNodes,
} from './shared';

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

/** Evaluate tab: dataset runs are always RAGAS-scored — either with a prompt
 * version swapped in, or 'As-is' against the agent's current prompts (the old
 * Direct dataset mode, now scored). Manual mode sends one raw message with no
 * scoring (smoke test), keeping the endpoint overrides. */
export default function SingleRunPanel() {
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
