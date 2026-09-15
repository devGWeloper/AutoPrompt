'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Select, Textarea } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { clearActiveRun, readActiveRun, saveActiveRun, type ActiveSingleRun } from '@/lib/activeRun';
import { SINGLE_ATTACH_EVENT } from '@/lib/rerun';
import RerunButton from './RerunButton';
import { connectRagasRunStream as connectRagasRunWs } from '@/lib/sse-client';
import { SingleRunSummaryDashboard } from './RunSummaryDashboard';
import { KeyBreakdown } from './KeyBreakdown';
import LastRunPreview from './LastRunPreview';
import AddExpectedButton from './AddExpectedButton';
import CasePickerModal from './CasePickerModal';
import { ValuePanel, valueFields } from './MatchDiff';
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
  CategorySelect,
  DatasetSelect,
  EndpointSelect,
  FORM_LABEL_COL,
  FormRow,
  ErrBox,
  PROMPT_TARGET_ENABLED,
  EvalOptions,
  ScoreToggle,
  SegToggle,
  StatusPill,
  TraceTag,
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
  useEndpoints,
  useDatasetCategories,
  useFlowDatasets,
  usePromptNodes,
} from './shared';
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
  /** Request → first token, in ms. null unless the endpoint streamed. */
  ttft_ms: number | null;
  /** Variable the node captured mid-flow, when it captured one. It is what
   * 정답 일치 was decided on, so it is shown next to the answer. */
  trace_var_nm: string | null;
  trace_value: string | null;
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
    ttft_ms: res.ttft_ms,
    // Carried through so the score block previews what was judged, not the
    // answer it was not judged on.
    trace_var_nm: res.trace_var_nm, trace_value: res.trace_value,
    ...metricVals,
  } as RagasResultRow;
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
  // Hand-picked cases within the dataset/folder above. null = all of them. A pick
  // belongs to one dataset and folder, so changing either drops it.
  const [pickedCases, setPickedCases] = useState<Set<number> | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => { setPickedCases(null); }, [datasetId, caseType]);
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
          // 상태 전환이 먼저다. 아래 상세 조회는 기록이 지워진 실행이면 실패하는데,
          // 그 실패가 여기서 던져지면 패널은 영영 '실행 중'으로 남는다 — 실행
          // 버튼은 취소 버튼인 채, 취소할 실행은 없는 상태.
          clearActiveRun('single');
          ws.close();
          setStatus(m.event === 'DONE' ? 'done' : m.event === 'CANCELLED' ? 'cancelled' : 'failed');
          try {
            setDetail(await api.get<RagasRunDetail>(`/ragas-runs/${runId}`));
          } catch (e) {
            setError(m.event === 'FAILED' && m.error ? m.error : errText(e));
          }
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

  /** Switch the panel onto a run that was created elsewhere — a re-test started
   * from this panel or from the records drawer. */
  function follow(s: ActiveSingleRun) {
    wsRef.current?.close();
    setError(null); setDetail(null); setStatus('running');
    setLive([]); setTotal(0); setRunMetrics(null); setCancelling(false);
    setSource('dataset');
    setScoreOn(s.scoreOn);
    setRunMeta({ nodeNm: s.nodeNm, verLabel: s.verLabel });
    attach(s.runId, s.endpointId);
  }

  useEffect(() => {
    const onAttach = (e: Event) => follow((e as CustomEvent<ActiveSingleRun>).detail);
    window.addEventListener(SINGLE_ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(SINGLE_ATTACH_EVENT, onAttach);
    // follow only touches setters and refs, so the first render's copy is enough.
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
        case_ids: pickedCases ? Array.from(pickedCases) : null,
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
    } catch (e) {
      setCancelling(false);
      // 취소할 실행이 없다는 답(404 기록이 지워짐 / 409 이미 끝남)이면, 멈춰 있는
      // 건 실행이 아니라 이 화면이다 — 스트림을 닫고 실행 버튼을 되돌린다.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        wsRef.current?.close();
        clearActiveRun('single');
        await settle(id);
        return;
      }
      setError(errText(e));
    }
  }

  /** End the panel on whatever the record says, or — when there is no record
   * left to read — on the fact that there isn't one. */
  async function settle(id: number) {
    try {
      const d = await api.get<RagasRunDetail>(`/ragas-runs/${id}`);
      setDetail(d);
      setStatus(d.status === 'DONE' ? 'done' : d.status === 'CANCELLED' ? 'cancelled' : 'failed');
    } catch {
      setStatus('failed');
      setError('실행 기록이 없습니다 — 실행 중에 기록이 삭제된 것 같습니다. 다시 실행해 주세요.');
    }
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
        score: scoreOn,
        metrics: scoreOn ? metrics : undefined,
        expected_output: wantsExpected ? expected.trim() || null : null,
        models: target === 'model' ? toSelection(models) : {},
      }));
      setCallStatus('done');
    } catch (e) { setCallError(errText(e)); setCallStatus('failed'); }
  }

  const verLabel = (id: number | null) => {
    // 모델 대상은 버전을 바꾸지 않는다는 점에서 Default 와 같은 호출이지만,
    // 헤더가 "모델을 시험한 실행"으로 읽히도록 따로 이름을 단다.
    if (target === 'model') return 'Model';
    // 버전이 없으면 바꾼 것이 없다 — 대상 토글과 같은 이름으로 적는다.
    if (!id) return 'Default';
    const found = versions.find((v) => v.prompt_id === id);
    return found ? `v${found.version_no}` : `ID ${id}`;
  };

  return (
    <div className="space-y-5">
      {/* 실행 조건. 줄마다 라벨 열 폭이 같아서 모든 컨트롤이 한 세로선에서
          시작하고, 순서는 Compare 와 같다: 무엇을 바꾸나(대상) → 어디로
          보내나(Agent) → 무엇을 넣나(입력) → 어떻게 재나(채점). 실행 버튼은 조건을
          다 채운 끝, 같은 세로선의 맨 아래 줄에 선다 — 카드 오른쪽 끝으로 밀지
          않으므로 폼과 버튼 사이가 비지 않는다. */}
      <Card>
        <div className="grid gap-y-2 px-4 py-3">
          {/* 대상 = 무엇을 바꾸는가. 셋 중 하나만 변인이고 나머지는 손대지
              않는다 — 그래서 고른 것의 컨트롤만 옆에 나온다. */}
          <FormRow label="대상">
            <SegToggle
              value={target}
              onChange={setTarget}
              options={[
                {
                  id: 'endpoint',
                  // 'As-is' 였던 자리. 아무것도 바꾸지 않은 실행이자 이 폼의
                  // 기본값이라, 이름은 그 사실만 말하고 맨 앞에 선다. 무슨
                  // 실행이 되는지는 툴팁이 말한다.
                  label: 'Default',
                  title: '프롬프트도 모델도 건드리지 않고, 고른 Agent 를 지금 상태 그대로 호출합니다',
                },
                { id: 'model', label: 'Model', title: 'role 별 모델을 바꿔서 실행합니다' },
                {
                  id: 'prompt',
                  label: 'Prompt',
                  title: '고른 프롬프트 버전을 활성화한 뒤 실행합니다',
                  disabled: !PROMPT_TARGET_ENABLED,
                },
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
          </FormRow>

          <FormRow label="Agent">
            <EndpointSelect endpoints={endpoints} value={endpointId} onChange={setEndpointId} />
          </FormRow>

          {/* 모델 대상일 때만 role 표가 열린다 — 다른 대상에서는 실행에 쓰이지도 않는다. */}
          {target === 'model' && (
            <FormRow label="모델">
              <ModelPicker roles={roles} columns={[{ key: 'a', drafts: models, onChange: setModels }]} />
            </FormRow>
          )}

          <FormRow label="입력">
            <SegToggle
              value={source}
              onChange={setSource}
              options={[{ id: 'dataset', label: '데이터셋' }, { id: 'manual', label: '직접 입력' }]}
            />
            {source === 'dataset' && (
              <>
                <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
                <CategorySelect cats={folders} value={caseType} onChange={setCaseType} />
                {datasetId != null && (
                  <span className="inline-flex items-center">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => setPicking(true)}
                      title="이 데이터셋(폴더)에서 돌릴 케이스만 고릅니다"
                    >
                      {pickedCases ? `선택 ${pickedCases.size}건` : '케이스 선택'}
                    </Button>
                    {pickedCases && (
                      <button
                        type="button"
                        aria-label="선택 해제"
                        title="선택 해제 — 전체 실행"
                        onClick={() => setPickedCases(null)}
                        className="ml-1 rounded-full p-1 text-muted-soft transition-colors hover:bg-surface-3 hover:text-ink"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    {picking && (
                      <CasePickerModal
                        datasetId={datasetId}
                        caseType={caseType}
                        value={pickedCases}
                        onClose={() => setPicking(false)}
                        onApply={setPickedCases}
                      />
                    )}
                  </span>
                )}
              </>
            )}
          </FormRow>

          {source === 'manual' && (
            <FormRow label="메시지">
              <div className="grid w-full gap-2.5 sm:grid-cols-2">
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
            </FormRow>
          )}

          <FormRow label="채점">
            <ScoreToggle on={scoreOn} onChange={setScoreOn} />
            {scoreOn && (
              <>
                <EvalOptions metrics={metrics} setMetrics={setMetrics} />
                {metrics.length === 0 && <span className="text-caption text-bad">하나 이상</span>}
              </>
            )}
          </FormRow>
        </div>

        {/* 실행 줄: 조건을 다 채운 끝, 컨트롤과 같은 세로선에서 시작한다. */}
        <div className={cn(FORM_LABEL_COL, 'items-center rounded-b-md border-t border-line bg-surface-2 px-4 py-2.5')}>
          <span />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
              <CardHeader title="Response" right={<ElapsedTag ms={callResult.elapsed_ms} />} />
              <div className="p-4">
                {(() => {
                  // 기대 정답 없이 부른 JSON 결과는 키 · 값 표로, 그 자리에서 정답으로 굳힐 수 있게.
                  const scoredText = callResult.trace_value ?? callResult.response;
                  const keyed = !expected.trim() && !!valueFields(scoredText, !callResult.trace_value);
                  const add = !expected.trim() && (
                    <AddExpectedButton
                      question={message}
                      contexts={callResult.docs}
                      answer={callResult.response}
                      traceValue={callResult.trace_value}
                    />
                  );
                  if (!keyed) {
                    return (
                      <>
                        {add && <div className="mb-2 flex justify-end">{add}</div>}
                        <AnswerBox text={callResult.response} />
                      </>
                    );
                  }
                  return (
                    <>
                      <ValuePanel
                        text={scoredText!}
                        unwrapBody={!callResult.trace_value}
                        label={callResult.trace_value ? '중간 변수' : '답변'}
                        tag={callResult.trace_value ? callResult.trace_var_nm || 'trace' : null}
                        trailing={add}
                      />
                      {callResult.trace_value && (
                        <div className="mt-4">
                          <p className="mb-1.5 eyebrow">답변</p>
                          <AnswerBox text={callResult.response} />
                        </div>
                      )}
                    </>
                  );
                })()}
                {/* 응답에 실리지 않는 중간 변수를 노드가 남겼을 때만 나온다.
                    정답 일치는 답변이 아니라 이 값으로 매겨진다. 위에서 표로 이미
                    보였으면 되풀이하지 않는다. */}
                {callResult.trace_value && !(!expected.trim() && valueFields(callResult.trace_value, false)) && (
                  <div className="mt-4 border-t border-line pt-3">
                    <p className="mb-1.5 flex items-center gap-1.5 eyebrow">
                      중간 변수 <TraceTag name={callResult.trace_var_nm} />
                    </p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-line bg-surface-2 p-3 text-xs text-ink">
                      {callResult.trace_value}
                    </pre>
                  </div>
                )}
                {callResult.score_error && (
                  <p className="mt-4 rounded-sm border border-bad-line bg-bad-soft px-3 py-2 text-xs text-bad">
                    채점 실패 — {callResult.score_error}
                  </p>
                )}
                {manualScores && <div className="mt-4"><ScoreBars row={manualScores} verdict /></div>}
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
            <Card className="overflow-hidden">
              <CardHeader title="Results">
                <Badge tone="neutral" dot>{cancelling ? 'CANCELLING' : 'RUNNING'}</Badge>
                {(runMeta?.nodeNm ?? nodeNm) && <span className="font-medium text-ink">{runMeta?.nodeNm ?? nodeNm}</span>}
                <Badge tone="neutral">{runMeta?.verLabel ?? verLabel(ver)}</Badge>
              </CardHeader>
              <div className="border-b border-line px-4 py-3">
                <RunProgress rows={live} total={total} scoreOn={scoreOn} metrics={runMetrics} />
              </div>
              {live.length > 0 ? (
                <CaseTable detail={{ results: live } as RagasRunDetail} scored={scoreOn} />
              ) : (
                <div className="py-10 text-center"><PendingHint label="답변 생성 중…" /></div>
              )}
            </Card>
          )}

          {detail && status !== 'running' && (
            <div className="space-y-4">
              {/* Anything scored at all — runMean is RAGAS-only, so gating on it
                  would drop the dashboard for a 정답 일치 only run. */}
              {scoredMetrics(detail).length > 0 && <SingleRunSummaryDashboard detail={detail} />}
              {/* 어떤 키가 자주 깨졌나 — 케이스 목록을 열기 전에 답하는 판. */}
              <KeyBreakdown rows={detail.results} />
              <Card className="overflow-hidden">
                <CardHeader
                  title="Results Detail"
                  right={
                    <>
                      <span>Engine {detail.engine ?? '—'}</span>
                      <span>·</span>
                      <span>{detail.results.length} case{detail.results.length === 1 ? '' : 's'}</span>
                      <RerunButton detail={detail} className="ml-1" />
                    </>
                  }
                >
                  <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'} dot>{detail.status}</Badge>
                  {detail.node_nm && <span className="font-medium text-ink">{detail.node_nm}</span>}
                  {detail.prompt_id && <Badge tone="neutral">{verLabel(detail.prompt_id)}</Badge>}
                </CardHeader>
                <CaseTable detail={detail} />
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
