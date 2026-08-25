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
import LastRunPreview from './LastRunPreview';
import {
  ALL_METRICS,
  EXACT_MATCH,
  type RagasMetric,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type RunWsMessage,
  type Endpoint,
} from '@/lib/types';
import {
  CategorySelect,
  DatasetSelect,
  EndpointSelect,
  InlineDivider,
  InlineField,
  ErrBox,
  PROMPT_TARGET_ENABLED,
  EvalOptions,
  ScoreToggle,
  SegToggle,
  StatusPill,
  VersionSelect,
  CaseTable,
  ScoreBars,
  ElapsedTag,
  AnswerBox,
  PendingHint,
  SAMPLE_MESSAGE,
  errText,
  fmt3,
  RunProgress,
  scoredMetrics,
  upsertResult,
  useAgentDefaults,
  useEndpoints,
  useDatasetCategories,
  useFlowDatasets,
  usePromptNodes,
} from './shared';
import type { AgentDefaults } from './shared';
import {
  ModelPicker,
  draftsFromRoles,
  modelDraftError,
  toSelection,
  useModelRoles,
  type ModelDrafts,
} from './ModelPicker';

// ---- direct call (raw external-API smoke test, no scoring) ------------------

type DirectResult = {
  response: string;
  docs: string[];
  raw: Record<string, unknown>;
  scores: Partial<Record<RagasMetric, number | null>> | null;
  /** The call succeeded but the scorer did not — a separate failure. */
  score_error: string | null;
  /** How long the endpoint took, in ms. Scoring time is not in it. */
  elapsed_ms: number;
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
    elapsed_ms: res.elapsed_ms,
    ...metricVals,
  } as RagasResultRow;
}

/** Credentials that only apply to a manual call — a dataset run reaches the
 * agent through the run's SSE stream, which carries the endpoint id and nothing
 * else. Each box holds its fallback as the placeholder: the key comes from the
 * selected API's first header (masked), the id from config. */
function AuthOverrides({
  authKey, setAuthKey, userId, setUserId, endpoint, defaults,
}: {
  authKey: string; setAuthKey: (v: string) => void;
  userId: string; setUserId: (v: string) => void;
  endpoint: Endpoint | undefined;
  defaults: AgentDefaults | null;
}) {
  const header = endpoint?.headers[0];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <label className="mb-1 block eyebrow">Auth Key</label>
        <Input
          value={authKey}
          onChange={(e) => setAuthKey(e.target.value)}
          placeholder={header ? `${header.name}: ${header.value}` : '—'}
          title={header ? `${header.name}: ${header.value}` : undefined}
          className="w-full text-sm"
        />
      </div>
      <div className="min-w-0">
        <label className="mb-1 block eyebrow">User ID</label>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={defaults?.userId ?? '—'}
          className="w-full text-sm"
        />
      </div>
    </div>
  );
}

/** Single tab. Three questions, asked in the same order as the Compare tab:
 * 대상 (which prompt version, or which endpoint as-is) × 입력 (a dataset or one
 * typed message) × 채점. The two axes are independent — every combination runs. */
export default function SingleRunPanel() {
  const { datasets } = useFlowDatasets();
  const nodes = usePromptNodes();
  // What is under test. 'endpoint' swaps no prompt version: the endpoint answers
  // exactly as it currently stands (As-is).
  // 프롬프트 버전 대상이 막혀 있는 동안에는 엔드포인트로 시작한다 — 고를 수 없는
  // 대상이 기본값이면 패널이 열리자마자 아무것도 못 하는 상태가 된다.
  const [target, setTarget] = useState<'prompt' | 'endpoint' | 'model'>(
    PROMPT_TARGET_ENABLED ? 'prompt' : 'endpoint',
  );
  const [source, setSource] = useState<'dataset' | 'manual'>('dataset');
  // 어느 API 를 부를지. 설정에 등록된 것 중에서만 고른다 — 목록이 하나뿐이면
  // 고를 것도 없으므로 그것으로 열린다.
  const endpoints = useEndpoints();
  const agentDefaults = useAgentDefaults();
  const [endpointId, setEndpointId] = useState<number | null>(null);
  useEffect(() => {
    setEndpointId((cur) => (cur != null && endpoints.some((e) => e.endpoint_id === cur) ? cur : endpoints[0]?.endpoint_id ?? null));
  }, [endpoints]);
  const [nodeNm, setNodeNm] = useState<string>('');
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [ver, setVer] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  // Which slice of that dataset runs. null = all of it. Reset with the
  // dataset — a category name means nothing in the next one.
  const [caseType, setCaseType] = useState<string | null>(null);
  const { cats: folders } = useDatasetCategories(datasetId);
  useEffect(() => { setCaseType(null); }, [datasetId]);
  // Models for this run, pre-filled with the saved role defaults — the boxes are
  // the pin, so what the form shows is what the run stores and the agent reads.
  const { roles } = useModelRoles();
  const [models, setModels] = useState<ModelDrafts>({});
  useEffect(() => { setModels(draftsFromRoles(roles)); }, [roles]);
  // Only blocks the run when the models are what's being tested — in the other
  // targets the drafts are not sent at all, so a stale typo in them is harmless.
  const modelErr = target === 'model' ? modelDraftError(models) : null;
  // 정답 일치 is the default evaluation option (no judge LLM required).
  const [metrics, setMetrics] = useState<string[]>([EXACT_MATCH]);
  const [scoreOn, setScoreOn] = useState(true);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live streaming state: results trickle in (answers first, then scores).
  const [live, setLive] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);
  // What the *server* said this run scores. Survives a refresh (the RUNNING event
  // is replayed on reattach), unlike the `metrics` form state above.
  const [runMetrics, setRunMetrics] = useState<RagasMetric[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Node/version the running run was started with. Kept separately from the form
  // so the live header stays right after a refresh, when the form is back to
  // its defaults but the run is still going.
  const [runMeta, setRunMeta] = useState<{ nodeNm: string; verLabel: string } | null>(null);
  const runIdRef = useRef<number | null>(null);
  const resumedRef = useRef(false);
  const wsRef = useRef<EventSource | null>(null);
  // Manual (raw single message) state.
  const [message, setMessage] = useState(SAMPLE_MESSAGE);
  const [expected, setExpected] = useState("");
  const [authKey, setAuthKey] = useState('');
  const [userId, setUserId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [callResult, setCallResult] = useState<DirectResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const manualScores = callResult ? directScoresRow(callResult) : null;
  // 기대 정답이 쓰이는 곳은 정답 일치만이 아니다 — RAGAS 의 answer_correctness ·
  // context_recall 도 이 값으로 채점하므로, 채점을 켠 실행이면 늘 받는다.
  const wantsExpected = scoreOn;

  useEffect(() => {
    if (!nodeNm) { setVersions([]); return; }
    api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`).then(setVersions).catch(() => setVersions([]));
  }, [nodeNm]);
  // Default to the latest version of the selected node (list is newest-first).
  useEffect(() => { setVer(versions[0]?.prompt_id ?? null); }, [versions]);

  // Every run names the API it calls; a prompt-version target additionally needs
  // both halves of the identity. The button's disabled state is the whole
  // message — each unmet condition is a control still sitting empty above it.
  const targetReady = target !== 'prompt' || (!!nodeNm && ver != null);
  const apiReady = endpointId != null;
  const scoreReady = !scoreOn || metrics.length > 0;
  const canRun = apiReady && targetReady && scoreReady && !modelErr && !!datasetId;
  const canCall =
    apiReady && targetReady && scoreReady && !modelErr && callStatus !== 'running' && !!message.trim();

  /** Open the run's event stream. Used both when starting a run and when
   * reattaching to one a previous page load left in flight — the server replays
   * everything already emitted, so either entry point ends up with the same view. */
  function attach(runId: number, epId: number | null) {
    runIdRef.current = runId;
    const ws = connectRagasRunWs(runId, {
      onMessage: async (m: RunWsMessage) => {
        if (m.event === 'RUNNING') {
          setTotal(m.total ?? 0);
          if (m.metrics) setRunMetrics(m.metrics);
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
    }, { side: 'a', endpointId: epId });
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
    // A run recorded without a node was aimed at an endpoint, not a version.
    // A resumed version run predates the block, so it must not drop the form
    // back into the blocked target — the run itself still streams either way.
    setTarget(saved.nodeNm && PROMPT_TARGET_ENABLED ? 'prompt' : 'endpoint');
    setScoreOn(saved.scoreOn);
    setRunMeta({ nodeNm: saved.nodeNm, verLabel: saved.verLabel });
    setStatus('running');
    attach(saved.runId, saved.endpointId);
    // Mount only: a resume must not re-fire when the form state settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (!canRun) return;
    setError(null); setDetail(null); setStatus('running');
    setLive([]); setTotal(0); setRunMetrics(null); setCancelling(false); runIdRef.current = null;
    const byPrompt = target === 'prompt';
    // Only the target under test is pinned; everything else runs as the agent's
    // own config has it. A URL belongs to an endpoint test, models to a model test.

    const meta = { nodeNm: byPrompt ? nodeNm : '', verLabel: verLabel(byPrompt ? ver : null) };
    setRunMeta(meta);
    try {
      const r = await api.post<{ ragas_run_id: number }>('/flow/test/ragas', {
        dataset_id: datasetId, case_type: caseType, metrics: scoreOn ? metrics : [], score: scoreOn,
        node_nm: byPrompt ? nodeNm : null, prompt_id: byPrompt ? ver : null,
        models: target === 'model' ? toSelection(models) : {},
      });
      saveActiveRun('single', { runId: r.ragas_run_id, endpointId, baseUrl: null, scoreOn, ...meta });
      attach(r.ragas_run_id, endpointId);
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
    const byPrompt = target === 'prompt';
    try {
      setCallResult(await api.post<DirectResult>('/flow/test/direct', {
        message,
        // The three targets are exclusive — only the one under test is pinned.
        // A version is swapped active, or a URL is called as it stands, or the
        // models are overridden; never more than one at a time.
        prompt_id: byPrompt ? ver : null,
        endpoint_id: endpointId,
        auth_key: authKey.trim() || null,
        user_id: userId.trim() || null,
        score: scoreOn,
        metrics: scoreOn ? metrics : undefined,
        expected_output: wantsExpected ? expected.trim() || null : null,
        models: target === 'model' ? toSelection(models) : {},
      }));
      setCallStatus('done');
    } catch (e) { setCallError(errText(e)); setCallStatus('failed'); }
  }

  const verLabel = (id: number | null) => {
    // Model target: same as-is call as endpoint, but flagged separately so the
    // run header reads as "testing the model" rather than "testing the endpoint".
    if (target === 'model') return '모델';
    // No version = nothing was swapped; the endpoint itself is what ran.
    if (!id) return '엔드포인트';
    const found = versions.find((v) => v.prompt_id === id);
    return found ? `v${found.version_no}` : `ID ${id}`;
  };

  return (
    <div className="space-y-5">
      {/* 실행 조건은 두 줄이다: API·대상 한 줄, 입력·채점·실행 한 줄. 항목마다
          한 행을 주면 화면의 절반이 아직 누르지도 않은 폼이 된다. */}
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          {/* 대상 = 무엇을 바꾸는가. 셋 중 하나만 변인이고 나머지는 손대지
              않는다 — 그래서 고른 것의 컨트롤만 옆에 나온다. 대상이 API 앞에
              서는 건 Compare 와 같은 순서라서이기도 하고, 무엇을 시험하는지가
              정해져야 어느 API 로 부를지가 의미를 갖기 때문이다. */}
          <InlineField label="대상">
            <SegToggle
              value={target}
              onChange={setTarget}
              options={[
                {
                  id: 'prompt',
                  label: '프롬프트',
                  title: '고른 프롬프트 버전을 활성화한 뒤 실행합니다',
                  disabled: !PROMPT_TARGET_ENABLED,
                },
                {
                  id: 'endpoint',
                  label: '변경 없음',
                  // 'As-is' 였던 자리. 무엇을 바꾸지 않는다는 건지가 이름만으로는
                  // 서지 않아서, 고르는 순간 무슨 실행이 되는지를 이름으로 옮겼다.
                  title: '프롬프트도 모델도 바꾸지 않고 지금 설정 그대로 실행합니다 — 비교의 기준값',
                },
                { id: 'model', label: '모델', title: 'role 별 모델을 바꿔서 실행합니다' },
              ]}
            />
            {target === 'prompt' && (
              <>
                <Select value={nodeNm} onChange={(e) => setNodeNm(e.target.value)} className="h-9 w-40">
                  <option value="" disabled>노드</option>
                  {nodes.map((n) => (
                    <option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>
                  ))}
                </Select>
                <VersionSelect versions={versions} value={ver} onChange={setVer} className="h-9 w-28" placeholder="버전" />
              </>
            )}
          </InlineField>

          <InlineDivider />

          <InlineField label="API">
            <EndpointSelect endpoints={endpoints} value={endpointId} onChange={setEndpointId} />
          </InlineField>

          {target === 'endpoint' && source === 'manual' && (
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="rounded-sm border border-line px-2 py-1 text-caption text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {showAdvanced ? '인증 −' : '인증 +'}
            </button>
          )}
        </div>

        {/* 모델 대상일 때만 role 표가 열린다 — 다른 대상에서는 실행에 쓰이지도 않는다. */}
        {target === 'model' && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
            <ModelPicker roles={roles} columns={[{ key: 'a', drafts: models, onChange: setModels }]} />
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-line pt-2.5">
          <InlineField label="입력">
            <SegToggle
              value={source}
              onChange={setSource}
              options={[{ id: 'dataset', label: '데이터셋' }, { id: 'manual', label: '직접 입력' }]}
            />
            {source === 'dataset' && (
              <>
                <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
                <CategorySelect cats={folders} value={caseType} onChange={setCaseType} />
              </>
            )}
          </InlineField>

          <InlineDivider />

          {/* 실행 버튼은 방금 고른 입력 바로 옆에 선다. 카드 오른쪽 끝으로
              밀어두면 폼과 버튼 사이가 비어, 조건을 다 채우고도 어디를 눌러야
              하는지 한 번 더 찾게 된다. */}
          <div className="flex shrink-0 items-center gap-2.5">
            {source === 'dataset' ? (
              <Button
                size="lg"
                variant={status === 'running' ? 'secondary' : 'primary'}
                className="whitespace-nowrap"
                disabled={status === 'running' ? cancelling : !canRun}
                onClick={status === 'running' ? cancel : run}
              >
                {status === 'running' ? (cancelling ? '취소 중…' : '취소') : '실행'}
              </Button>
            ) : (
              <Button size="lg" variant="primary" className="whitespace-nowrap" disabled={!canCall} onClick={call}>
                {callStatus === 'running' ? '호출 중…' : '호출'}
              </Button>
            )}
            <StatusPill status={source === 'dataset' ? status : callStatus} />
            {modelErr && <span className="text-caption text-bad">{modelErr}</span>}
          </div>
        </div>

        {/* 채점은 자기 줄을 쓴다 — 지표가 켜지고 꺼질 때마다 위 줄이 접혀서 실행
            버튼까지 밀려 내려가던 자리다. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-2.5">
          <InlineField label="채점">
            <ScoreToggle on={scoreOn} onChange={setScoreOn} />
            {scoreOn && (
              <>
                <EvalOptions metrics={metrics} setMetrics={setMetrics} />
                {metrics.length === 0 && <span className="text-caption text-bad">하나 이상</span>}
              </>
            )}
          </InlineField>
        </div>

        {source === 'manual' && (
          <div className="mt-2.5 grid gap-2.5 border-t border-line pt-2.5 sm:grid-cols-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="메시지 *"
              className="w-full text-sm"
            />
            {wantsExpected && (
              <Textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={3}
                placeholder="기대 정답"
                className="w-full text-sm"
              />
            )}
          </div>
        )}

        
        {/* Auth overrides ride on the direct call only — a dataset run reaches
            the endpoint through its own stream. */}
        {target === 'endpoint' && source === 'manual' && showAdvanced && (
          <div className="py-3">
            <AuthOverrides
              authKey={authKey}
              setAuthKey={setAuthKey}
              userId={userId}
              setUserId={setUserId}
              endpoint={endpoints.find((e) => e.endpoint_id === endpointId)}
              defaults={agentDefaults}
            />
          </div>
        )}
      </Card>

      {source === 'manual' ? (
        <>
          {callError && <ErrBox msg={callError} />}
          {callStatus === 'idle' && !callError && (
            <LastRunPreview kind="single" />
          )}
          {callStatus === 'running' && (
            <Card className="px-6 py-12 text-center"><PendingHint label="외부 API 호출 중…" /></Card>
          )}
          {callResult && callStatus !== 'running' && (
            <Card>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-ink">Response</h3>
                <ElapsedTag ms={callResult.elapsed_ms} />
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
                    <p className="mb-1.5 eyebrow">Contexts ({callResult.docs.length})</p>
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
                    <pre className="mt-2 max-h-72 overflow-auto rounded-sm border border-line bg-surface-2 p-3 text-xs text-ink">
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
            <LastRunPreview kind="single" />
          )}

          {/* Live streaming view while running: answers appear first, scores fill in. */}
          {status === 'running' && (
            <Card>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
                <h3 className="mr-1 text-sm font-semibold text-ink">Results</h3>
                <Badge tone="neutral" dot>{cancelling ? 'CANCELLING' : 'RUNNING'}</Badge>
                {(runMeta?.nodeNm ?? nodeNm) && <span className="font-medium text-ink">{runMeta?.nodeNm ?? nodeNm}</span>}
                <Badge tone="neutral">{runMeta?.verLabel ?? verLabel(ver)}</Badge>
              </div>
              <div className="border-b border-line px-4 py-3">
                <RunProgress rows={live} total={total} scoreOn={scoreOn} metrics={runMetrics} />
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
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
