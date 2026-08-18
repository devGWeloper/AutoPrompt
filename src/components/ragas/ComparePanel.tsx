'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { clearActiveRun, readActiveRun, saveActiveRun, type ActiveCompareRun } from '@/lib/activeRun';
import { connectRagasRunStream as connectRagasRunWs } from '@/lib/sse-client';
import { CompareSummaryDashboard } from './RunSummaryDashboard';
import {
  ALL_METRICS,
  EXACT_MATCH,
  type PromptVersionSummary,
  type RagasMetric,
  type RagasResultRow,
  type RagasRunDetail,
  type RunWsMessage,
} from '@/lib/types';
import { CaseCompareTable, CompareVerdict } from './CompareTable';
import {
  DatasetSelect,
  ErrBox,
  EvalOptions,
  FormRow,
  PROMPT_TARGET_BLOCKED_HINT,
  PROMPT_TARGET_ENABLED,
  ScoreToggle,
  PendingHint,
  RunProgress,
  SegToggle,
  StatusPill,
  VersionSelect,
  errText,
  sideLabel,
  upsertResult,
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

/** One side's answer to a manual A/B call. */
type ManualSide = {
  response: string;
  docs: string[];
  scores: Partial<Record<RagasMetric, number | null>> | null;
  score_error: string | null;
};

/** Wrap one manual answer as the single-case run detail `CaseCompareTable`
 * renders, so a one-message A/B reads exactly like a dataset comparison —
 * paired answers, paired metric bars, the same Δ badges. Both sides use the
 * same case_id so the table pairs them onto one row. */
function manualDetail(side: ManualSide, question: string, groundTruth: string | null): RagasRunDetail {
  const metricVals = Object.fromEntries(ALL_METRICS.map((m) => [m, side.scores?.[m] ?? null]));
  const row = {
    ragas_result_id: 0,
    ragas_run_id: 0,
    case_id: 0,
    question,
    answer: side.response,
    contexts: JSON.stringify(side.docs),
    ground_truth: groundTruth,
    // The call itself succeeded (a failed call throws), so an error here is the
    // scorer's — which is the rule the compare table already reads by.
    error_msg: side.score_error,
    trace_var_nm: null,
    trace_value: null,
    ...metricVals,
  } as RagasResultRow;
  return { status: 'DONE', results: [row] } as RagasRunDetail;
}

/** How one side of a model comparison is named in the result badges: the first
 * pinned model. An unpinned side runs the agent's own config, which is a real
 * thing to compare against and so is said out loud rather than left blank. */
function modelLabel(drafts: ModelDrafts): string {
  const hit = Object.values(drafts).find((d) => d.model.trim() !== '');
  return hit?.model.trim() || 'config 기본값';
}

export default function ComparePanel() {
  const { datasets } = useFlowDatasets();
  const nodes = usePromptNodes();
  const [nodeNm, setNodeNm] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [verA, setVerA] = useState<number | null>(null);
  const [verB, setVerB] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  // One model set per side, used only when 모델 is the axis under test. Both
  // start from the same saved defaults, so a fresh model comparison begins from
  // a known baseline and you change just the side you want to move.
  const { roles, setRoles } = useModelRoles();
  const [modelsA, setModelsA] = useState<ModelDrafts>({});
  const [modelsB, setModelsB] = useState<ModelDrafts>({});
  useEffect(() => {
    const d = draftsFromRoles(roles);
    setModelsA(d);
    setModelsB(d);
  }, [roles]);
  // 정답 일치 is the default evaluation option (no judge LLM required).
  const [metrics, setMetrics] = useState<string[]>([EXACT_MATCH]);
  const [scoreOn, setScoreOn] = useState(true);
  // Temporary: the two versions currently live behind different endpoints, so a
  // comparison can be driven by endpoints (config agent.a.url / agent.b.url, or
  // URLs typed here) instead of by two prompt versions of one node.
  // 프롬프트 버전 대상이 막혀 있는 동안에는 엔드포인트로 시작한다 — 고를 수 없는
  // 대상이 기본값이면 패널이 열리자마자 아무것도 못 하는 상태가 된다.
  const [mode, setMode] = useState<'version' | 'endpoint' | 'model'>(
    PROMPT_TARGET_ENABLED ? 'version' : 'endpoint',
  );
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
  // Only blocks the run when the models are the axis under test — the other
  // modes never send the drafts, so a stale typo in them is harmless.
  const modelErr = mode === 'model' ? modelDraftError(modelsA, modelsB) : null;
  // Dataset vs one typed message — the same input axis the Single tab offers.
  const [source, setSource] = useState<'dataset' | 'manual'>('dataset');
  const [message, setMessage] = useState('');
  const [expected, setExpected] = useState('');
  const [callStatus, setCallStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  // The question/ground truth are snapshotted with the answers: editing the
  // textarea afterwards must not relabel a result that was already produced.
  const [ab, setAb] = useState<{ a: ManualSide; b: ManualSide; question: string; gt: string | null } | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [detailA, setDetailA] = useState<RagasRunDetail | null>(null);
  const [detailB, setDetailB] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live streaming: answers for both versions trickle in, then scores fill in.
  const [liveA, setLiveA] = useState<RagasResultRow[]>([]);
  const [liveB, setLiveB] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);
  // Server-declared metric list for this run — survives a refresh, unlike the form.
  const [runMetrics, setRunMetrics] = useState<RagasMetric[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Side labels captured when the run started. The form resets on a refresh, but
  // the results on screen still belong to the run that produced them.
  const [runLabels, setRunLabels] = useState<[string, string] | null>(null);
  const runIdsRef = useRef<number[]>([]);
  const resumedRef = useRef(false);

  useEffect(() => {
    if (nodeNm == null) { setVersions([]); return; }
    api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`).then(setVersions).catch(() => setVersions([]));
  }, [nodeNm]);

  // default A = latest version, B = next most-recent (list is newest-first)
  useEffect(() => {
    setVerA(versions[0]?.prompt_id ?? null);
    setVerB(versions[1]?.prompt_id ?? null);
  }, [versions]);

  // Endpoint mode identifies the two sides by URL; model mode runs both sides on
  // the configured default endpoint and varies only the models. Neither needs a version.
  const byVersion = mode === 'version' && !!(nodeNm && verA && verB && verA !== verB);
  const targetReady = mode === 'endpoint' || mode === 'model' || byVersion;
  const scoreReady = !scoreOn || metrics.length > 0;
  const canRun = targetReady && scoreReady && !modelErr && !!datasetId && status !== 'running';
  const canCall = targetReady && scoreReady && !modelErr && !!message.trim() && callStatus !== 'running';
  const exactOn = scoreOn && metrics.includes(EXACT_MATCH);
  const verLabel = (id: number | null) => (mode === 'version' ? versions.find((v) => v.prompt_id === id)?.version_no ?? '' : '');
  // What each side is actually varying — that is what the result badges should
  // name. Model mode's sides differ only by model, so the model name is the label.
  const curLabels = (): [string, string] =>
    mode === 'model'
      ? [modelLabel(modelsA), modelLabel(modelsB)]
      : [verLabel(verA), verLabel(verB)];
  const labA = runLabels?.[0] ?? curLabels()[0];
  const labB = runLabels?.[1] ?? curLabels()[1];
  // `sideLabel` reads a label as a prompt version ("v3") or, when blank, as the
  // endpoint — neither of which describes a model-mode side.
  const dispLabel = (label: string) => (mode === 'model' ? label : sideLabel(label));

  const waitDone = (
    id: number,
    setLive: (f: (cur: RagasResultRow[]) => RagasResultRow[]) => void,
    setDet: (d: RagasRunDetail) => void,
    side: 'a' | 'b' | null,
    baseUrl: string | null,
  ) =>
    new Promise<string>((resolve) => {
      const ws = connectRagasRunWs(id, {
        onMessage: async (m: RunWsMessage) => {
          if (m.event === 'RUNNING') {
            setTotal((t) => Math.max(t, m.total ?? 0));
            if (m.metrics) setRunMetrics(m.metrics);
          } else if (m.event === 'ANSWER' || m.event === 'SCORE') {
            setTotal((t) => Math.max(t, m.total));
            setLive((cur) => upsertResult(cur, m.result));
          } else if (m.event === 'DONE' || m.event === 'FAILED' || m.event === 'CANCELLED') {
            setDet(await api.get<RagasRunDetail>(`/ragas-runs/${id}`));
            ws.close();
            resolve(m.event);
          }
        },
      }, { side, baseUrl });
    });

  /** Stream both sides and settle the panel's status. Shared by a fresh run and
   * by a resume after refresh — the server replays what each run already emitted. */
  async function attachBoth(saved: ActiveCompareRun) {
    runIdsRef.current = [saved.runIdA, saved.runIdB];
    const ev = await Promise.all([
      waitDone(saved.runIdA, setLiveA, setDetailA, saved.side ? 'a' : null, saved.urlA),
      waitDone(saved.runIdB, setLiveB, setDetailB, saved.side ? 'b' : null, saved.urlB),
    ]);
    clearActiveRun('compare');
    setStatus(ev.includes('FAILED') ? 'failed' : ev.includes('CANCELLED') ? 'cancelled' : 'done');
  }

  // Resume the pair this tab was streaming before a refresh; both runs kept
  // executing on the server.
  useEffect(() => {
    if (resumedRef.current) return; // React StrictMode runs mount effects twice in dev
    resumedRef.current = true;
    const saved = readActiveRun<ActiveCompareRun>('compare');
    if (!saved) return;
    setScoreOn(saved.scoreOn);
    setRunLabels([saved.labelA, saved.labelB]);
    setStatus('running');
    void attachBoth(saved);
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (!canRun) return;
    setError(null); setDetailA(null); setDetailB(null); setStatus('running');
    setLiveA([]); setLiveB([]); setTotal(0); setRunMetrics(null); setCancelling(false); runIdsRef.current = [];
    // Only endpoint mode gives the two sides their own URL. Version and model
    // mode both run against the configured default endpoint — they vary the
    // prompt or the models, and the endpoint is held as it is.
    const ep = mode === 'endpoint';
    const byModel = mode === 'model';
    const labels = curLabels();
    setRunLabels(labels);
    try {
      const r = await api.post<{ ragas_run_a_id: number; ragas_run_b_id: number }>('/flow/test/ragas/ab', {
        dataset_id: datasetId,
        node_nm: byVersion ? nodeNm : null,
        prompt_id_a: byVersion ? verA : null,
        prompt_id_b: byVersion ? verB : null,
        metrics: scoreOn ? metrics : [], score: scoreOn,
        models_a: byModel ? toSelection(modelsA) : {},
        models_b: byModel ? toSelection(modelsB) : {},
      });
      const saved: ActiveCompareRun = {
        runIdA: r.ragas_run_a_id,
        runIdB: r.ragas_run_b_id,
        side: ep,
        urlA: ep ? urlA.trim() || null : null,
        urlB: ep ? urlB.trim() || null : null,
        labelA: labels[0], labelB: labels[1],
        scoreOn,
      };
      saveActiveRun('compare', saved);
      await attachBoth(saved);
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  /** One message, both sides. The server calls A then B in sequence — a
   * prompt-version side swaps ACTIVE_YN globally, so the two cannot overlap. */
  async function callAb() {
    if (!canCall) return;
    setCallError(null); setAb(null); setCallStatus('running');
    setRunLabels(curLabels());
    const gt = exactOn ? expected.trim() || null : null;
    // Each side pins exactly the axis under test and nothing else: a URL in
    // endpoint mode, a version in version mode, models in model mode.
    const sideSpec = (url: string, ver: number | null, models: ModelDrafts) =>
      mode === 'endpoint' ? { base_url: url.trim() || null, models: {} }
      : mode === 'version' ? { prompt_id: ver, models: {} }
      : { models: toSelection(models) };
    try {
      const r = await api.post<{ a: ManualSide; b: ManualSide }>('/flow/test/direct/ab', {
        message,
        score: scoreOn,
        metrics: scoreOn ? metrics : undefined,
        expected_output: gt,
        a: sideSpec(urlA, verA, modelsA),
        b: sideSpec(urlB, verB, modelsB),
      });
      setAb({ ...r, question: message, gt });
      setCallStatus('done');
    } catch (e) { setCallError(errText(e)); setCallStatus('failed'); }
  }

  async function cancel() {
    const ids = runIdsRef.current;
    if (!ids.length) return;
    setCancelling(true);
    // Cancel both runs; ignore per-id errors (e.g. one already finished → 409).
    await Promise.all(ids.map((id) => api.post(`/ragas-runs/${id}/cancel`, {}).catch(() => {})));
  }

  return (
    <div className="space-y-5">
      {/* 대상 · 입력 · 채점 — the same three questions in the same order as the
          Single tab, so the two panels read alike. */}
      <Card tone="muted" className="divide-y divide-line px-4 py-1.5">
        {/* 프롬프트 버전 · 엔드포인트 · 모델 중 정확히 하나만 A/B 로 갈린다 — 두 축을
            동시에 다르게 두는 복합 비교는 읽기 어렵고 뭘 바꿔서 결과가 달라졌는지도
            불분명해지므로 허용하지 않는다. */}
        {/* 대상 = 무엇을 비교하는가. 고른 축 하나만 A/B 로 갈리고 나머지는 손대지
            않는다 — 그래서 고른 것의 컨트롤만 아래에 나온다. 엔드포인트를 비교하는데
            모델 표가 같이 떠 있으면 그건 이미 As-is 비교가 아니다. */}
        <FormRow label="대상" alignTop>
          <div className="flex w-full flex-wrap items-center gap-2">
            <SegToggle
              value={mode}
              onChange={setMode}
              options={[
                { id: 'version', label: '프롬프트 버전', disabled: !PROMPT_TARGET_ENABLED, hint: PROMPT_TARGET_BLOCKED_HINT },
                { id: 'endpoint', label: '엔드포인트' },
                { id: 'model', label: '모델' },
              ]}
            />
            {!PROMPT_TARGET_ENABLED && (
              <span className="text-xs text-muted">{PROMPT_TARGET_BLOCKED_HINT}</span>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2">
            {mode === 'version' ? (
              <>
                <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="w-44">
                  <option value="" disabled>노드 선택</option>
                  {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
                </Select>
                <VersionSelect versions={versions} value={verA} onChange={setVerA} placeholder="버전 A" />
                <span className="text-xs text-muted">vs</span>
                <VersionSelect versions={versions} value={verB} onChange={setVerB} placeholder="버전 B" />
                <span className="text-xs text-muted">이 노드의 프롬프트만 교체하고, 모델은 config 그대로 실행합니다.</span>
                {verA && verB && verA === verB && (
                  <span className="w-full text-xs text-bad">버전 A와 B는 서로 달라야 합니다.</span>
                )}
              </>
            ) : mode === 'endpoint' ? (
              /* 임시: 두 버전이 서로 다른 엔드포인트에 떠 있어 각 쪽 URL로 비교한다.
                 프롬프트 · 모델 교체 없이 각 URL을 그대로 호출한다. */
              <>
                <span className="text-[11px] font-semibold text-muted">A</span>
                <Input value={urlA} onChange={(e) => setUrlA(e.target.value)} placeholder="비우면 config 의 agent.a.url" className="w-64 text-sm" />
                <span className="text-[11px] font-semibold text-muted">B</span>
                <Input value={urlB} onChange={(e) => setUrlB(e.target.value)} placeholder="비우면 config 의 agent.b.url" className="w-64 text-sm" />
                <span className="w-full text-xs text-muted">각 엔드포인트를 프롬프트 · 모델 교체 없이 현재 상태(As-is) 그대로 호출합니다.</span>
              </>
            ) : (
              <>
                <ModelPicker
                  roles={roles}
                  onRolesChange={setRoles}
                  columns={[
                    { key: 'a', label: 'A', drafts: modelsA, onChange: setModelsA },
                    { key: 'b', label: 'B', drafts: modelsB, onChange: setModelsB },
                  ]}
                />
                <span className="w-full text-xs text-muted">같은 엔드포인트(config 기본값)에 모델만 바꿔 두 번 실행합니다.</span>
              </>
            )}
          </div>
        </FormRow>

        <FormRow label="입력">
          <SegToggle
            value={source}
            onChange={setSource}
            options={[{ id: 'dataset', label: '데이터셋' }, { id: 'manual', label: '직접 입력' }]}
          />
          {source === 'dataset'
            ? <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
            : <span className="text-xs text-muted">메시지 하나를 A · B 양쪽에 보냅니다.</span>}
        </FormRow>

        {source === 'manual' && (
          <div className="space-y-3 py-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Message <span className="text-bad">*</span></label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="A · B 양쪽에 그대로 전달되는 메시지"
                className="w-full text-sm"
              />
            </div>
            {exactOn && (
              <div>
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
          </div>
        )}

        <FormRow label="채점" alignTop>
          <ScoreToggle on={scoreOn} onChange={setScoreOn} />
          {scoreOn && (
            <>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />
              <EvalOptions metrics={metrics} setMetrics={setMetrics} />
              {metrics.length === 0 && <span className="text-[11px] text-bad">평가 옵션을 하나 이상 선택하세요</span>}
            </>
          )}
        </FormRow>

        <div className="flex flex-wrap items-center gap-3 py-3">
          {source === 'dataset' ? (
            <Button
              variant={status === 'running' ? 'secondary' : 'primary'}
              className="whitespace-nowrap"
              disabled={status === 'running' ? cancelling : !canRun}
              onClick={status === 'running' ? cancel : run}
            >
              {status === 'running' ? (cancelling ? 'Cancelling…' : 'Cancel run') : 'Run comparison'}
            </Button>
          ) : (
            <Button variant="primary" className="whitespace-nowrap" disabled={!canCall} onClick={callAb}>
              {callStatus === 'running' ? 'Calling…' : 'Call A · B'}
            </Button>
          )}
          <StatusPill status={source === 'dataset' ? status : callStatus} />
          {mode === 'version' && !byVersion && (
            <span className="text-[11px] text-muted">노드와 서로 다른 두 버전을 선택하세요</span>
          )}
          {modelErr && <span className="text-[11px] text-bad">{modelErr}</span>}
        </div>
      </Card>

      {source === 'manual' ? (
        <>
          {callError && <ErrBox msg={callError} />}
          {callStatus === 'idle' && !callError && (
            <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
              <div className="text-sm text-ink">비교할 <span className="font-medium">대상</span>의 A · B를 채우고 메시지를 입력한 뒤 <span className="font-medium">Call A · B</span>를 누르세요.</div>
              <div className="text-xs text-muted">같은 메시지를 양쪽에 보내 답변을 나란히 보여줍니다. 채점을 켜면 지표도 A/B로 비교합니다.</div>
            </Card>
          )}
          {callStatus === 'running' && (
            <Card className="px-6 py-12 text-center"><PendingHint label="A · B 순차 호출 중…" /></Card>
          )}
          {ab && callStatus !== 'running' && (
            <Card>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
                <h3 className="mr-1 text-sm font-semibold text-ink">Manual Comparison</h3>
                <Badge tone="neutral">A · {dispLabel(labA)}</Badge>
                <span>vs</span>
                <Badge tone="accent">B · {dispLabel(labB)}</Badge>
              </div>
              <div className="p-4">
                <div className="overflow-hidden rounded-sm border border-line bg-surface">
                  <CaseCompareTable
                    detailA={manualDetail(ab.a, ab.question, ab.gt)}
                    detailB={manualDetail(ab.b, ab.question, ab.gt)}
                    labelA={labA} labelB={labB}
                    scored={scoreOn}
                    defaultAllOpen
                  />
                </div>
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
      {error && <ErrBox msg={error} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">비교할 <span className="font-medium">대상</span>과 데이터셋을 선택한 뒤 실행하세요.</div>
          <div className="text-xs text-muted">고른 대상 하나만 A/B로 갈리고 나머지는 config 그대로 갑니다 — <span className="font-medium">프롬프트 버전</span>은 해당 노드의 프롬프트만, <span className="font-medium">엔드포인트</span>는 각 URL을 그대로, <span className="font-medium">모델</span>은 같은 엔드포인트에 모델만 바꿔 실행합니다. 어느 쪽이든 두 실행 모두 같은 데이터셋으로 채점됩니다.</div>
        </Card>
      )}

      {/* Live A/B streaming while running: both versions' answers appear first, scores fill in. */}
      {status === 'running' && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
            <h3 className="mr-1 text-sm font-semibold text-ink">Comparison</h3>
            <Badge tone="neutral" dot>RUNNING</Badge>
            <Badge tone="neutral">A · {dispLabel(labA)}</Badge>
            <span>vs</span>
            <Badge tone="accent">B · {dispLabel(labB)}</Badge>
          </div>
          {/* One progress block per side — A and B run as two independent streams
              and routinely sit in different phases. */}
          <div className="grid gap-4 border-b border-line px-4 py-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">A</p>
              <RunProgress rows={liveA} total={total} scoreOn={scoreOn} metrics={runMetrics} />
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">B</p>
              <RunProgress rows={liveB} total={total} scoreOn={scoreOn} metrics={runMetrics} />
            </div>
          </div>
          <div className="p-4">
            {liveA.length > 0 || liveB.length > 0
              ? <div className="overflow-hidden rounded-sm border border-line bg-surface">
                  <CaseCompareTable
                    detailA={{ results: liveA } as RagasRunDetail}
                    detailB={{ results: liveB } as RagasRunDetail}
                    labelA={labA} labelB={labB}
                    scored={scoreOn}
                  />
                </div>
              : <div className="py-8 text-center"><PendingHint label="답변 생성 중…" /></div>}
          </div>
        </Card>
      )}

      {detailA && detailB && status !== 'running' && (
        <div className="space-y-4">
          <CompareSummaryDashboard
            detailA={detailA}
            detailB={detailB}
            labelA={labA}
            labelB={labB}
          />
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
              <h3 className="mr-1 text-sm font-semibold text-ink">Comparison Detail</h3>
              {nodeNm && <span className="font-medium text-ink">{nodeNm}</span>}
              <Badge tone="neutral">A · {dispLabel(labA)}</Badge>
              <span>vs</span>
              <Badge tone="accent">B · {dispLabel(labB)}</Badge>
              <span className="ml-auto flex items-center gap-2.5">
                <CompareVerdict detailA={detailA} detailB={detailB} />
                <span>Engine {detailA.engine ?? '—'}</span>
              </span>
            </div>
            <div className="p-4">
              <div className="overflow-hidden rounded-sm border border-line bg-surface">
                <CaseCompareTable detailA={detailA} detailB={detailB} labelA={labA} labelB={labB} />
              </div>
              {(detailA.status === 'CANCELLED' || detailB.status === 'CANCELLED') && (
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
