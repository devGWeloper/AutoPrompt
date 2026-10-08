'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select, Textarea } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api';
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
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  RAGAS_METRICS,
  type RagasMetric,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type RunWsMessage,
} from '@/lib/types';
import {
  CategorySelect,
  DatasetPurposeLine,
  DatasetSelect,
  folderLabel,
  EndpointSelect,
  InlineDivider,
  InlineField,
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
  RerunSummary,
  RunDurationTag,
  usePickedCases,
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
// 임시 — 실행 조건 폼의 E안(머리띠 한 줄)을 지금 폼과 토글해서 보기 위한 것.
import {
  FormSkinToggle,
  MenuCols,
  MenuFoot,
  MenuRow,
  MenuSection,
  PlayIcon,
  RunToolbar,
  ToolbarMenu,
  useFormSkin,
} from './RunSetupToolbar';
// 임시 — O안(담아서 한 번에). 바구니·기록 레일과 담을 목록.
import {
  CartRail,
  CartRailFolded,
  useCart,
  useRecentRuns,
} from './RunCart';

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
  // 이번 패스가 도는 케이스들. 전체 실행이면 전부라 표식이 의미가 없고, 제자리
  // 재실행이면 부분 집합이라 그 줄만 '다시 도는 중' 으로 선다.
  const [rerunning, setRerunning] = useState<Set<number> | null>(null);
  // 끝난 실행의 케이스 목록에서 고른 것 — 새 실행이 뜨면 비운다.
  const rerunPick = usePickedCases(detail?.ragas_run_id);
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

  // ---- 임시: 실행 조건 폼 프로토타입(E안) --------------------------------
  // 아래 카드와 완전히 같은 상태를 읽고 쓴다. 어느 쪽 폼으로 고르든 실행되는
  // 내용은 같고, 머리띠는 값을 버튼에 적어 두는 것만 다르다.
  const [skin, setSkin] = useFormSkin();
  const pickedDataset = datasets.find((d) => d.dataset_id === datasetId);
  const folderHit = caseType != null ? folders.find((c) => c.type_cd === caseType) : null;
  // 몇 건이 도는지 — 고른 케이스가 있으면 그 수, 폴더를 좁혔으면 폴더의 수,
  // 아니면 데이터셋 전체. 실행 버튼에 그대로 적는 값이다.
  const runCount = pickedCases
    ? pickedCases.size
    : folderHit
      ? folderHit.case_count
      : pickedDataset?.case_count ?? null;
  const targetLabel = target === 'endpoint' ? 'Default' : target === 'model' ? 'Model' : 'Prompt';
  const agentLabel = endpoints.find((e) => e.endpoint_id === endpointId)?.endpoint_nm ?? 'API 선택';
  const dataLabel = source === 'manual'
    ? '직접 입력'
    : !pickedDataset
      ? '데이터셋 선택'
      : [pickedDataset.dataset_nm, folderHit ? folderLabel(folderHit.type_cd) : null]
          .filter(Boolean).join(' · ');
  // 건수는 값이 아니라 값에 딸린 수 — 이름과 한 덩어리로 이어 붙이면 어디까지가
  // 데이터셋 이름인지 흐려진다.
  const dataBadge = source === 'manual'
    ? undefined
    : pickedCases
      ? `선택 ${pickedCases.size}건`
      : runCount != null
        ? `${runCount}건`
        : undefined;
  const ragasCount = metrics.filter((m) => m !== EXACT_MATCH).length;
  const scoreLabel = !scoreOn
    ? '없음'
    : metrics.length === 0
      ? '지표 선택'
      : [metrics.includes(EXACT_MATCH) ? 'Action Test' : null, ragasCount ? `RAGAS ${ragasCount}` : null]
          .filter(Boolean).join(' + ');

  // ---- 임시: O안(담아서 한 번에) ----------------------------------------
  // 바구니는 데이터셋·폴더·케이스를 섞어 모으고, 데이터셋 하나로 떨어질 때만
  // 실제로 돈다(한 실행이 데이터셋 하나만 받는다). 기록은 레일 아래에 상주하고,
  // 누르면 그 실행이 이 패널의 결과 자리에 뜬다.
  const cart = useCart();
  const { runs: recentRuns, reload: reloadRuns } = useRecentRuns(14, skin === 'cart');
  const [railOpen, setRailOpen] = useState(true);
  const [openRunId, setOpenRunId] = useState<number | null>(null);
  // 방금 끝난 실행이 기록 맨 위에 서야 한다 — 레일이 들고 있는 목록은 패널이
  // 열릴 때 한 번 읽은 것이다.
  useEffect(() => {
    if (status === 'done' || status === 'failed' || status === 'cancelled') reloadRuns();
  }, [status, reloadRuns]);
  // 바구니는 데이터셋으로만 담는다 — '직접 입력' 으로 둔 채 이 스킨으로 넘어오면
  // 아래가 수동 호출 화면인 채 바구니로 돌릴 길이 없는 상태가 된다.
  useEffect(() => {
    if (skin === 'cart') setSource('dataset');
  }, [skin]);

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
          // 남겨 둔 줄이 있을 때만 표식이 뜻을 가진다 — 빈 목록에서 시작하는
          // 보통의 실행은 어차피 도는 것만 나오므로 '다시 도는 중' 이 군더더기다.
          setRerunning((cur) => (cur === null ? null : new Set((m.case_ids ?? []).filter((x): x is number => x != null))));
        } else if (m.event === 'ANSWER' || m.event === 'SCORE') {
          setTotal(m.total);
          setLive((cur) => upsertResult(cur, m.result));
        } else if (m.event === 'DONE' || m.event === 'FAILED' || m.event === 'CANCELLED') {
          // 상태 전환이 먼저다. 아래 상세 조회는 기록이 지워진 실행이면 실패하는데,
          // 그 실패가 여기서 던져지면 패널은 영영 '실행 중'으로 남는다 — 실행
          // 버튼은 취소 버튼인 채, 취소할 실행은 없는 상태.
          clearActiveRun('single');
          ws.close();
          setRerunning(null);
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

  /**
   * Switch the panel onto a run that was armed elsewhere — a re-run started from
   * this panel or from the records drawer.
   *
   * 재실행은 그 실행을 그 자리에서 다시 돌리는 것이라, 목록을 비우고 시작하면
   * 방금까지 보던 스물네 줄이 사라졌다가 세 줄로 돌아온다. 그래서 스트림을 열기
   * **전에** 지금 기록을 읽어 깔아 둔다 — 서버는 스트림이 열릴 때 비로소 그
   * 케이스들의 옛 줄을 지우므로, 이 순서에서만 옛 줄을 온전히 받을 수 있다.
   */
  async function follow(s: ActiveSingleRun) {
    wsRef.current?.close();
    setError(null); setDetail(null); setStatus('running');
    setTotal(0); setRunMetrics(null); setCancelling(false);
    setSource('dataset');
    setScoreOn(s.scoreOn);
    setRunMeta({ nodeNm: s.nodeNm, verLabel: s.verLabel });
    let seeded = false;
    try {
      const prev = await api.get<RagasRunDetail>(`/ragas-runs/${s.runId}`);
      if (prev.results.length) {
        setLive(prev.results);
        // 빈 집합으로 시작해 RUNNING 이 실제 목록을 채운다. null 이면 '남겨 둔 줄이
        // 없는 실행' 이라 표식을 아예 달지 않는다.
        setRerunning(new Set());
        seeded = true;
      }
    } catch {
      // 기록을 못 읽어도 실행은 돈다 — 예전처럼 빈 목록에서 채워 나간다.
    }
    if (!seeded) { setLive([]); setRerunning(null); }
    attach(s.runId, s.endpointId);
  }

  useEffect(() => {
    const onAttach = (e: Event) => follow((e as CustomEvent<ActiveSingleRun>).detail);
    window.addEventListener(SINGLE_ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(SINGLE_ATTACH_EVENT, onAttach);
    // follow only touches setters and refs, so the first render's copy is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run() {
    if (!canRun || datasetId == null) return;
    void startRun({ datasetId, caseType, caseIds: pickedCases ? Array.from(pickedCases) : null });
  }

  /**
   * 실행을 띄운다. 폼이 고른 값으로 부를 때는 `run()` 이 감싸고, 바구니는 자기가
   * 모은 것을 그대로 넘긴다 — 바구니를 폼 상태에 먼저 써 넣고 부르면, 데이터셋이
   * 바뀔 때 고른 케이스를 비우는 effect 가 그 사이에 돌아 값이 날아간다.
   */
  async function startRun(
    { datasetId: dsId, caseType: type, caseIds }: { datasetId: number; caseType: string | null; caseIds: number[] | null },
  ) {
    if (!(apiReady && targetReady && scoreReady && !modelErr)) return;
    setError(null); setDetail(null); setStatus('running'); setOpenRunId(null);
    setLive([]); setTotal(0); setRunMetrics(null); setCancelling(false); setRerunning(null); runIdRef.current = null;
    const byPrompt = target === 'prompt';
    // Only the target under test is pinned; everything else runs as the agent's
    // own config has it. A URL belongs to an endpoint test, models to a model test.

    const meta = { nodeNm: byPrompt ? nodeNm : '', verLabel: verLabel(byPrompt ? ver : null) };
    setRunMeta(meta);
    try {
      const r = await api.post<{ ragas_run_id: number }>('/flow/test/ragas', {
        dataset_id: dsId, case_type: type, metrics: scoreOn ? metrics : [], score: scoreOn,
        case_ids: caseIds,
        node_nm: byPrompt ? nodeNm : null, prompt_id: byPrompt ? ver : null,
        models: target === 'model' ? toSelection(models) : {},
      });
      saveActiveRun('single', { runId: r.ragas_run_id, endpointId, baseUrl: null, scoreOn, ...meta });
      attach(r.ragas_run_id, endpointId);
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  /** 레일의 기록에서 고른 실행을 이 패널의 결과 자리에 띄운다 — 끝난 실행이
   * 남기는 모양과 같아서, 결과를 보려고 다른 화면으로 갈 일이 없다. */
  async function openRecord(id: number) {
    setOpenRunId(id);
    setError(null); setLive([]); setTotal(0); setRunMetrics(null); setRunMeta(null); setRerunning(null);
    try {
      const d = await api.get<RagasRunDetail>(`/ragas-runs/${id}`);
      setDetail(d);
      setStatus(d.status === 'FAILED' ? 'failed' : d.status === 'CANCELLED' ? 'cancelled' : 'done');
    } catch (e) {
      setError(errText(e));
    }
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

  // ---- 임시: 머리띠 칸이 여는 판 ----------------------------------------
  // 판은 '폼' 이 아니라 '고르는 목록' 이다. 셀렉트를 판 안에 다시 넣으면 칸을 누른
  // 뒤 또 눌러야 하고, 그게 이 머리띠가 꾸져 보이던 가장 큰 이유였다. 모양이 네
  // 칸 모두 같아야 하므로 한곳에서 만들어 E · O 두 스킨이 같이 쓴다.
  const agentMenu = (close: () => void) =>
    endpoints.length === 0 ? (
      // 등록된 API 가 없으면 고를 목록이 없다 — 설정으로 가는 길만 띄운다.
      <EndpointSelect endpoints={endpoints} value={endpointId} onChange={setEndpointId} className="h-9 w-full text-sm" />
    ) : (
      <div className="flex flex-col gap-0.5">
        {endpoints.map((e) => (
          <MenuRow
            key={e.endpoint_id}
            label={e.endpoint_nm}
            title={e.endpoint_url}
            selected={e.endpoint_id === endpointId}
            onClick={() => { setEndpointId(e.endpoint_id); close(); }}
          />
        ))}
      </div>
    );

  const targetMenu = (close: () => void) => (
    <div className="flex flex-col gap-0.5">
      <MenuRow
        label="Default"
        note="그대로"
        title="프롬프트도 모델도 건드리지 않고, 고른 Agent 를 지금 상태 그대로 호출합니다"
        selected={target === 'endpoint'}
        onClick={() => { setTarget('endpoint'); close(); }}
      />
      {/* 모델 · 프롬프트는 고른 뒤에 채울 것이 따라오므로 판을 닫지 않는다. */}
      <MenuRow
        label="Model"
        note="role 별 모델"
        title="role 별 모델을 바꿔서 실행합니다"
        selected={target === 'model'}
        onClick={() => setTarget('model')}
      />
      <MenuRow
        label="Prompt"
        note="버전 활성화"
        title="고른 프롬프트 버전을 활성화한 뒤 실행합니다"
        disabled={!PROMPT_TARGET_ENABLED}
        selected={target === 'prompt'}
        onClick={() => setTarget('prompt')}
      />
      {target === 'prompt' && (
        <>
          <MenuSection label="노드 · 버전" />
          <div className="flex gap-1.5 px-1 pb-1">
            <Select value={nodeNm} onChange={(e) => setNodeNm(e.target.value)} className="h-9 min-w-0 flex-1">
              <option value="" disabled>노드</option>
              {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
            </Select>
            <VersionSelect versions={versions} value={ver} onChange={setVer} className="h-9 w-24" placeholder="버전" />
          </div>
        </>
      )}
      {target === 'model' && (
        <>
          <MenuSection label="모델" />
          <div className="px-1 pb-1">
            <ModelPicker roles={roles} columns={[{ key: 'a', drafts: models, onChange: setModels }]} />
          </div>
        </>
      )}
    </div>
  );

  const dataMenu = (close: () => void) => (
    <div className="flex flex-col gap-0.5">
      <MenuRow label="데이터셋" note="케이스 묶음" selected={source === 'dataset'} onClick={() => setSource('dataset')} />
      <MenuRow label="직접 입력" note="메시지 하나" selected={source === 'manual'} onClick={() => { setSource('manual'); close(); }} />
      {source === 'dataset' && (
        <>
          <MenuSection label="데이터셋 · 폴더" />
          <MenuCols
            left={
              <div className="flex flex-col gap-0.5">
                {datasets.length === 0 && <p className="px-2 py-1.5 text-[11px] text-muted-soft">데이터셋 없음</p>}
                {datasets.map((d) => (
                  <MenuRow
                    key={d.dataset_id}
                    label={d.dataset_nm}
                    note={d.case_count != null ? String(d.case_count) : undefined}
                    title={d.description ?? undefined}
                    selected={d.dataset_id === datasetId}
                    onClick={() => setDatasetId(d.dataset_id)}
                  />
                ))}
              </div>
            }
            right={
              datasetId == null ? (
                <p className="px-2 py-1.5 text-[11px] text-muted-soft">데이터셋을 먼저 고르세요</p>
              ) : folders.length < 2 ? (
                // 폴더가 하나뿐이면 '전체' 와 그 폴더가 같은 실행이다.
                <p className="px-2 py-1.5 text-[11px] text-muted-soft">폴더 없음 — 전체 실행</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <MenuRow
                    label="전체"
                    note={pickedDataset?.case_count != null ? String(pickedDataset.case_count) : undefined}
                    selected={caseType == null}
                    onClick={() => { setCaseType(null); close(); }}
                  />
                  {folders.map((c) => (
                    <MenuRow
                      key={c.type_cd}
                      label={folderLabel(c.type_cd)}
                      note={String(c.case_count)}
                      disabled={c.case_count === 0}
                      selected={c.type_cd === caseType}
                      onClick={() => { setCaseType(c.type_cd); close(); }}
                    />
                  ))}
                </div>
              )
            }
          />
          {datasetId != null && (
            <MenuFoot>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setPicking(true); close(); }}
                title="이 데이터셋(폴더)에서 돌릴 케이스만 고릅니다"
              >
                {pickedCases ? `케이스 ${pickedCases.size}건 고름` : '케이스 고르기'}
              </Button>
              {pickedCases && (
                <Button variant="ghost" size="sm" onClick={() => setPickedCases(null)} title="선택 해제 — 전체 실행">
                  해제
                </Button>
              )}
            </MenuFoot>
          )}
        </>
      )}
    </div>
  );

  const scoreMenu = () => (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-8 items-center gap-2 px-2">
        <ScoreToggle on={scoreOn} onChange={setScoreOn} />
        <span className="text-[13px] font-medium text-ink">{scoreOn ? '채점함' : '채점 없이 응답만'}</span>
      </div>
      <MenuRow
        label={METRIC_LABELS[EXACT_MATCH]}
        title={METRIC_DESCRIPTIONS[EXACT_MATCH]}
        check={metrics.includes(EXACT_MATCH)}
        disabled={!scoreOn}
        onClick={() => setMetrics((cur) => (cur.includes(EXACT_MATCH) ? cur.filter((x) => x !== EXACT_MATCH) : [...cur, EXACT_MATCH]))}
      />
      <MenuSection label="RAGAS" />
      {RAGAS_METRICS.map((m) => (
        <MenuRow
          key={m}
          indent
          label={METRIC_LABELS[m]}
          title={METRIC_DESCRIPTIONS[m]}
          check={metrics.includes(m)}
          disabled={!scoreOn}
          onClick={() => setMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
        />
      ))}
      {scoreOn && metrics.length === 0 && (
        <p className="px-2 pt-1 text-caption text-bad">하나 이상 고르세요</p>
      )}
    </div>
  );

  // 본문. 스킨마다 바깥 틀만 다르고 안은 같다 — 'O · 바구니' 는 이 본문 왼쪽에
  // 레일을 세운다.
  const inner = (
    <>
      {/* 임시 — 어느 폼으로 볼지. 고르고 나면 이 줄과 안 고른 쪽을 지운다. */}
      <div className="flex items-center justify-end">
        <FormSkinToggle value={skin} onChange={setSkin} />
      </div>

      {/* 실행 조건은 두 줄이다: API·대상 한 줄, 입력·채점·실행 한 줄. 항목마다
          한 행을 주면 화면의 절반이 아직 누르지도 않은 폼이 된다. */}
      {skin === 'card' && (
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
          </InlineField>

          <InlineDivider />

          <InlineField label="Agent">
            <EndpointSelect endpoints={endpoints} value={endpointId} onChange={setEndpointId} />
          </InlineField>

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

          {source === 'dataset' && <DatasetPurposeLine datasets={datasets} datasetId={datasetId} />}
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

        
      </Card>
      )}

      {/* 임시 — O안. 데이터는 왼쪽 레일의 바구니가 들고 있으므로 머리띠에서
          '데이터'와 실행 단추를 뺀다. 두 곳에 실행 단추가 서면 어느 것이 바구니를
          돌리는지 알 수 없다. */}
      {skin === 'cart' && (
        <>
          <RunToolbar>
            <ToolbarMenu label="Agent" value={agentLabel} muted={endpointId == null} width={240}>
              {agentMenu}
            </ToolbarMenu>

            <ToolbarMenu label="대상" value={targetLabel} width={target === 'model' ? 560 : 300}>
              {targetMenu}
            </ToolbarMenu>

            <ToolbarMenu label="채점" value={scoreLabel} muted={scoreOn && metrics.length === 0} width={300}>
              {scoreMenu}
            </ToolbarMenu>

            <span className="flex-grow" />

            <div className="flex shrink-0 items-center gap-2.5 pl-2">
              {modelErr && <span className="text-caption text-bad">{modelErr}</span>}
              <StatusPill status={status} />
            </div>
          </RunToolbar>
        </>
      )}

      {/* 임시 — E안. 조건을 한 줄에 값으로만 적고, 칸을 누르면 고르는 목록이 아래로
          열린다. 판 안이 폼이 아니라 목록인 게 중요하다 — 셀렉트를 넣으면 칸을 누른
          뒤 또 눌러야 한다. */}
      {skin === 'toolbar' && (
        <div className="space-y-2.5">
          <RunToolbar>
            <ToolbarMenu label="Agent" value={agentLabel} muted={endpointId == null} width={240}>
              {agentMenu}
            </ToolbarMenu>

            <ToolbarMenu label="대상" value={targetLabel} width={target === 'model' ? 560 : 300}>
              {targetMenu}
            </ToolbarMenu>

            <ToolbarMenu
              label="데이터"
              value={dataLabel}
              badge={dataBadge}
              lead
              muted={source === 'dataset' && !pickedDataset}
              width={440}
            >
              {dataMenu}
            </ToolbarMenu>

            <ToolbarMenu label="채점" value={scoreLabel} muted={scoreOn && metrics.length === 0} width={300}>
              {scoreMenu}
            </ToolbarMenu>

            <span className="flex-grow" />

            <div className="flex shrink-0 items-center gap-2.5 pl-2">
              {modelErr && <span className="text-caption text-bad">{modelErr}</span>}
              <StatusPill status={source === 'dataset' ? status : callStatus} />
              {/* 띠에서 유일한 주 동작이라 한 단 큰 치수를 쓴다 — 셀렉트와 같은
                  h-9 로 두면 네 칸과 같은 무게가 되어 줄의 끝이 안 보인다. */}
              {source === 'dataset' ? (
                <Button
                  size="lg"
                  variant={status === 'running' ? 'secondary' : 'primary'}
                  className="whitespace-nowrap"
                  disabled={status === 'running' ? cancelling : !canRun}
                  onClick={status === 'running' ? cancel : run}
                >
                  {status === 'running' ? (
                    cancelling ? '취소 중…' : '취소'
                  ) : (
                    <>
                      <PlayIcon />
                      {runCount != null ? `${runCount}건 실행` : '실행'}
                    </>
                  )}
                </Button>
              ) : (
                <Button size="lg" variant="primary" className="whitespace-nowrap" disabled={!canCall} onClick={call}>
                  {callStatus === 'running' ? '호출 중…' : '호출'}
                </Button>
              )}
            </div>
          </RunToolbar>

          {source === 'manual' && (
            <Card className="grid gap-2.5 px-4 py-3 sm:grid-cols-2">
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
            </Card>
          )}

          {/* 케이스 고르기 판은 메뉴 밖에 둔다 — 메뉴 안에 두면 판을 누르는 순간
              메뉴가 닫히면서 판까지 사라진다. */}
          {picking && datasetId != null && (
            <CasePickerModal
              datasetId={datasetId}
              caseType={caseType}
              value={pickedCases}
              onClose={() => setPicking(false)}
              onApply={setPickedCases}
            />
          )}
        </div>
      )}

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
                    <CaseTable
                      detail={{ results: live } as RagasRunDetail}
                      scored={scoreOn}
                      rerunning={rerunning ?? undefined}
                    />
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
              {/* 어떤 키가 자주 깨졌나 — 케이스 목록을 열기 전에 답하는 판. */}
              <KeyBreakdown rows={detail.results} />
              <Card>
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
                  <h3 className="mr-1 text-sm font-semibold text-ink">Results Detail</h3>
                  <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'} dot>{detail.status}</Badge>
                  {detail.node_nm && <span className="font-medium text-ink">{detail.node_nm}</span>}
                  {detail.prompt_id && <Badge tone="neutral">{verLabel(detail.prompt_id)}</Badge>}
                  <span className="ml-auto flex items-center gap-2">
                    <RerunSummary detail={detail} />
                    <RunDurationTag runs={[detail]} />
                    <span>·</span>
                    <span>Engine {detail.engine ?? '—'}</span>
                    <span>·</span>
                    <span>{detail.results.length} case{detail.results.length === 1 ? '' : 's'}</span>
                    <RerunButton detail={detail} picking={rerunPick} className="ml-1" />
                  </span>
                </div>
                <div className="p-4">
                  <div className="overflow-hidden rounded-sm border border-line bg-surface">
                    <CaseTable detail={detail} picking={rerunPick} onPassChanged={() => void settle(detail.ragas_run_id)} />
                  </div>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );

  if (skin !== 'cart') return <div className="space-y-5">{inner}</div>;

  // 레일은 sticky 로 붙어 결과를 따라 내려가도 자리를 지킨다 — 담은 것과 기록이
  // 늘 보이는 것이 이 배치의 이유이고, 스크롤에 흘러가 버리면 그게 없어진다.
  return (
    <div className="flex items-start gap-4">
      {railOpen ? (
        <div className="sticky top-0 h-[calc(100vh-6.5rem)] w-[380px] shrink-0 overflow-hidden rounded-md border border-line bg-surface shadow-card">
          <CartRail
            cart={cart}
            datasets={datasets}
            runs={recentRuns}
            openRunId={openRunId}
            onOpenRun={(id) => void openRecord(id)}
            onCollapse={() => setRailOpen(false)}
            running={status === 'running'}
            cancelling={cancelling}
            onCancel={() => void cancel()}
            blockedReason={
              !apiReady ? 'Agent 를 고르세요'
              : !targetReady ? '노드와 버전을 고르세요'
              : !scoreReady ? '채점 지표를 하나 이상 고르세요'
              : modelErr
            }
            onRun={({ datasetId: dsId, caseIds }) => void startRun({ datasetId: dsId, caseType: null, caseIds })}
          />
        </div>
      ) : (
        <div className="sticky top-0">
          <CartRailFolded cases={cart.cases} onOpen={() => setRailOpen(true)} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-5">{inner}</div>
    </div>
  );
}
