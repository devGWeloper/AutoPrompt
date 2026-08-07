'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { clearActiveRun, readActiveRun, saveActiveRun, type ActiveSingleRun } from '@/lib/activeRun';
import { connectRagasRunStream as connectRagasRunWs } from '@/lib/sse-client';
import { SingleRunSummaryDashboard } from './RunSummaryDashboard';
import {
  ALL_METRICS,
  EXACT_MATCH,
  type RagasMetric,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type RunWsMessage,
} from '@/lib/types';
import {
  DatasetSelect,
  ErrBox,
  EvalOptions,
  ScoreToggle,
  SegToggle,
  StatusPill,
  VersionSelect,
  CaseTable,
  ScoreBars,
  AnswerBox,
  PendingHint,
  errText,
  fmt3,
  scoredMetrics,
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
  /** The call succeeded but the scorer did not — a separate failure. */
  score_error: string | null;
};

/** Adapt a manual call's inline scores to the RagasResultRow shape ScoreBars renders. */
function directScoresRow(res: DirectResult): RagasResultRow | null {
  if (!res.scores) return null;
  const metricVals = Object.fromEntries(ALL_METRICS.map((m) => [m, res.scores?.[m] ?? null]));
  // Nothing scored (e.g. 정답 일치 with no expected answer) → no score block.
  if (Object.values(metricVals).every((v) => v == null)) return null;
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
  // 정답 일치 is the default evaluation option (no judge LLM required).
  const [metrics, setMetrics] = useState<string[]>([EXACT_MATCH]);
  const [scoreOn, setScoreOn] = useState(true);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live streaming state: results trickle in (answers first, then scores).
  const [live, setLive] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  // Node/version the running run was started with. Kept separately from the form
  // so the live header stays right after a refresh, when the form is back to
  // its defaults but the run is still going.
  const [runMeta, setRunMeta] = useState<{ nodeNm: string; verLabel: string } | null>(null);
  const runIdRef = useRef<number | null>(null);
  const resumedRef = useRef(false);
  const wsRef = useRef<EventSource | null>(null);
  // Manual (raw single message) state.
  const [message, setMessage] = useState('');
  const [expected, setExpected] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [userId, setUserId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [callResult, setCallResult] = useState<DirectResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const manualScores = callResult ? directScoresRow(callResult) : null;
  const answered = live.filter((r) => r.answer != null || r.error_msg != null).length;
  const scored = live.filter((r) => ALL_METRICS.some((m) => r[m] != null)).length;
  const exactOn = scoreOn && metrics.includes(EXACT_MATCH);

  useEffect(() => {
    if (!nodeNm) { setVersions([]); return; }
    api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`).then(setVersions).catch(() => setVersions([]));
  }, [nodeNm]);
  // Default to the latest version of the selected node (list is newest-first).
  useEffect(() => { setVer(versions[0]?.prompt_id ?? null); }, [versions]);

  const canRun = !!datasetId && (!scoreOn || metrics.length > 0) && (!nodeNm || ver != null);
  const canCall = callStatus !== 'running' && !!message.trim() && (!scoreOn || metrics.length > 0);

  /** Open the run's event stream. Used both when starting a run and when
   * reattaching to one a previous page load left in flight — the server replays
   * everything already emitted, so either entry point ends up with the same view. */
  function attach(runId: number, url: string | null) {
    runIdRef.current = runId;
    const ws = connectRagasRunWs(runId, {
      onMessage: async (m: RunWsMessage) => {
        if (m.event === 'RUNNING') {
          setTotal(m.total ?? 0);
        } else if (m.event === 'ANSWER' || m.event === 'SCORE') {
          setTotal(m.total);
          setLive((cur) => upsertResult(cur, m.result));
        } else if (m.event === 'DONE' || m.event === 'FAILED' || m.event === 'CANCELLED') {
          clearActiveRun('single');
          setDetail(await api.get<RagasRunDetail>(`/ragas-runs/${runId}`));
          setStatus(m.event === 'DONE' ? 'done' : m.event === 'CANCELLED' ? 'cancelled' : 'failed');
          ws.close();
        }
      },
    }, { side: 'a', baseUrl: url });
    wsRef.current = ws;
  }

  // Resume a run this tab was streaming before a refresh. The run kept executing
  // on the server; only the connection was lost.
  useEffect(() => {
    if (resumedRef.current) return; // React StrictMode runs mount effects twice in dev
    resumedRef.current = true;
    const saved = readActiveRun<ActiveSingleRun>('single');
    if (!saved) return;
    setSource('dataset');
    setScoreOn(saved.scoreOn);
    setRunMeta({ nodeNm: saved.nodeNm, verLabel: saved.verLabel });
    setStatus('running');
    attach(saved.runId, saved.baseUrl);
    // Mount only: a resume must not re-fire when the form state settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (!canRun) return;
    setError(null); setDetail(null); setStatus('running');
    setLive([]); setTotal(0); setCancelling(false); runIdRef.current = null;
    const url = baseUrl.trim() || null;
    const meta = { nodeNm, verLabel: verLabel(nodeNm ? ver : null) };
    setRunMeta(meta);
    try {
      const r = await api.post<{ ragas_run_id: number }>('/flow/test/ragas', {
        dataset_id: datasetId, metrics: scoreOn ? metrics : [], score: scoreOn,
        node_nm: nodeNm || null, prompt_id: nodeNm ? ver : null,
      });
      saveActiveRun('single', { runId: r.ragas_run_id, baseUrl: url, scoreOn, ...meta });
      attach(r.ragas_run_id, url);
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
        expected_output: exactOn ? expected.trim() || null : null,
      }));
      setCallStatus('done');
    } catch (e) { setCallError(errText(e)); setCallStatus('failed'); }
  }

  const verLabel = (id: number | null) => {
    if (!id) return 'As-is';
    const found = versions.find((v) => v.prompt_id === id);
    return found ? `v${found.version_no}` : `ID ${id}`;
  };

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        <div className="flex items-center gap-3 overflow-x-auto [&>*]:shrink-0">
          <SegToggle
            value={source}
            onChange={setSource}
            options={[{ id: 'dataset', label: 'Dataset' }, { id: 'manual', label: 'Manual' }]}
          />
          {source === 'dataset' ? (
            <>
              <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="w-44">
                <option value="">As-is (Current prompt)</option>
                {nodes.map((n) => (
                  <option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>
                ))}
              </Select>
              {nodeNm && (
                <VersionSelect versions={versions} value={ver} onChange={setVer} className="w-44" placeholder="Select version" />
              )}
              <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
            </>
          ) : (
            <span className="text-xs text-muted">외부 에이전트에 메시지 하나를 그대로 보냅니다.</span>
          )}
          <Button
            variant={status === 'running' ? 'secondary' : 'primary'}
            className="whitespace-nowrap"
            disabled={status === 'running' ? cancelling : !canRun}
            onClick={status === 'running' ? cancel : run}
          >
            {status === 'running' ? (cancelling ? 'Cancelling…' : 'Cancel run') : 'Run evaluation'}
          </Button>
          <StatusPill status={status} />
        </div>

        <div className="mt-3 flex flex-wrap items-start gap-x-1.5 gap-y-2 border-t border-line pt-3">
          <ScoreToggle on={scoreOn} onChange={setScoreOn} />
          {scoreOn && (
            <>
              <span aria-hidden className="mx-1.5 mt-1 h-4 w-px shrink-0 bg-line" />
              <EvalOptions metrics={metrics} setMetrics={setMetrics} />
              {metrics.length === 0 && <span className="ml-1 mt-1 text-[11px] text-bad">평가 옵션을 하나 이상 선택하세요</span>}
            </>
          )}
        </div>

        {source === 'dataset' && (
          <div className="mt-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-medium text-muted hover:text-ink"
            >
              {showAdvanced ? '엔드포인트 설정 숨기기' : '엔드포인트 설정 (선택)'}
            </button>
            {showAdvanced && (
              <div className="mt-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="비우면 config.yml 의 agent.baseUrl 을 사용합니다"
                  className="w-full text-sm"
                />
              </div>
            )}
          </div>
        )}

        {source === 'manual' && (
          <>
            <div className="mt-3 border-t border-line pt-3">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Message <span className="text-bad">*</span></label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Message sent as-is to the external API"
                className="w-full text-sm"
              />
            </div>
            {exactOn && (
              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">기대 정답</label>
                <Textarea
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  rows={3}
                  placeholder="응답 JSON 의 body 와 비교할 정답 (비우면 정답 일치는 채점하지 않습니다)"
                  className="w-full text-sm"
                />
              </div>
            )}
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
              <div className="text-xs text-muted">외부 API 응답을 그대로 보여주며, 채점을 켜면 정답 일치(O/X)와 지표 점수를 함께 표시합니다.</div>
            </Card>
          )}
          {callStatus === 'running' && (
            <Card className="px-6 py-12 text-center"><PendingHint label="외부 API 호출 중…" /></Card>
          )}
          {callResult && callStatus !== 'running' && (
            <Card>
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-ink">Response</h3>
              </div>
              <div className="p-4">
                <AnswerBox text={callResult.response} />
                {callResult.score_error && (
                  <p className="mt-4 rounded-sm border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">
                    채점 실패 — {callResult.score_error}
                  </p>
                )}
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
              <div className="text-sm text-ink">데이터셋을 선택한 뒤 <span className="font-medium">Run evaluation</span>을 누르세요.</div>
              <div className="text-xs text-muted">프롬프트 버전을 고르면 그 버전으로 교체해 평가하고, As-is면 현재 상태 그대로 평가합니다. 지난 결과는 Records 탭에서 확인할 수 있습니다.</div>
            </Card>
          )}

          {/* Live streaming view while running: answers appear first, scores fill in. */}
          {status === 'running' && (
            <Card>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
                <h3 className="mr-1 text-sm font-semibold text-ink">Results</h3>
                <Badge tone="neutral" dot>{cancelling ? 'CANCELLING' : 'RUNNING'}</Badge>
                {(runMeta?.nodeNm ?? nodeNm) && <span className="font-medium text-ink">{runMeta?.nodeNm ?? nodeNm}</span>}
                <Badge tone="neutral">{runMeta?.verLabel ?? verLabel(ver)}</Badge>
                <span className="ml-auto">Answered {answered}/{total || '…'}{scoreOn ? ` · Scored ${scored}/${total || '…'}` : ''}</span>
              </div>
              <div className="p-4">
                {live.length > 0 ? (
                  <div className="overflow-hidden rounded-sm border border-line bg-surface">
                    <CaseTable detail={{ results: live } as RagasRunDetail} scored={scoreOn} />
                  </div>
                ) : (
                  <div className="py-8 text-center"><PendingHint label="답변 생성 중…" /></div>
                )}
              </div>
            </Card>
          )}

          {detail && status !== 'running' && (
            <div className="space-y-4">
              {/* Anything scored at all — runMean is RAGAS-only, so gating on it
                  would drop the dashboard for a 정답 일치 only run. */}
              {scoredMetrics(detail).length > 0 && <SingleRunSummaryDashboard detail={detail} />}
              <Card>
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
                  <h3 className="mr-1 text-sm font-semibold text-ink">Results Detail</h3>
                  <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'} dot>{detail.status}</Badge>
                  {detail.node_nm && <span className="font-medium text-ink">{detail.node_nm}</span>}
                  {detail.prompt_id && <Badge tone="neutral">{verLabel(detail.prompt_id)}</Badge>}
                  <span className="ml-auto flex items-center gap-2">
                    <span>Engine {detail.engine ?? '—'}</span>
                    <span>·</span>
                    <span>{detail.results.length} case{detail.results.length === 1 ? '' : 's'}</span>
                  </span>
                </div>
                <div className="p-4">
                  <div className="overflow-hidden rounded-sm border border-line bg-surface">
                    <CaseTable detail={detail} />
                  </div>
                  {detail.status === 'CANCELLED' && (
                    <p className="mt-3 text-xs text-muted">취소된 실행 — 답변만 저장되고 점수는 없습니다.</p>
                  )}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
