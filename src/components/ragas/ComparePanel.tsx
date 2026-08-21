'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select, Textarea } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { clearActiveRun, readActiveRun, saveActiveRun, type ActiveCompareRun } from '@/lib/activeRun';
import { connectRagasRunStream as connectRagasRunWs } from '@/lib/sse-client';
import { CompareSummaryDashboard } from './RunSummaryDashboard';
import LastRunPreview from './LastRunPreview';
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
  EndpointSelect,
  InlineDivider,
  InlineField,
  ErrBox,
  EvalOptions,
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
  useEndpoints,
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
  elapsed_ms: number;
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
    elapsed_ms: side.elapsed_ms,
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
  const { roles } = useModelRoles();
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
  // 어느 API 를 부르는가. endpoint 모드에서만 A·B 가 서로 다른 API 가 되고,
  // 나머지 모드에서는 한 API 를 두 사이드가 공유한다.
  const endpoints = useEndpoints();
  const [epA, setEpA] = useState<number | null>(null);
  const [epB, setEpB] = useState<number | null>(null);
  useEffect(() => {
    const has = (id: number | null) => id != null && endpoints.some((e) => e.endpoint_id === id);
    setEpA((cur) => (has(cur) ? cur : endpoints[0]?.endpoint_id ?? null));
    setEpB((cur) => (has(cur) ? cur : endpoints[1]?.endpoint_id ?? endpoints[0]?.endpoint_id ?? null));
  }, [endpoints]);
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
  // endpoint 모드는 서로 다른 두 API 가 있어야 비교가 성립한다; 나머지 모드는
  // 두 사이드가 같은 API 하나를 쓴다.
  const apiReady = mode === 'endpoint' ? epA != null && epB != null && epA !== epB : epA != null;
  const targetReady = apiReady && (mode === 'endpoint' || mode === 'model' || byVersion);
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
    endpointId: number | null,
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
      }, { side, endpointId });
    });

  /** Stream both sides and settle the panel's status. Shared by a fresh run and
   * by a resume after refresh — the server replays what each run already emitted. */
  async function attachBoth(saved: ActiveCompareRun) {
    runIdsRef.current = [saved.runIdA, saved.runIdB];
    const ev = await Promise.all([
      waitDone(saved.runIdA, setLiveA, setDetailA, saved.side ? 'a' : null, saved.endpointA),
      waitDone(saved.runIdB, setLiveB, setDetailB, saved.side ? 'b' : null, saved.endpointB),
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
        endpointA: epA,
        endpointB: ep ? epB : epA,
        urlA: null,
        urlB: null,
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
    // Each side pins exactly the axis under test and nothing else: its own API in
    // endpoint mode, a version in version mode, models in model mode. Everything
    // that is not the axis calls the same API on both sides.
    const sideSpec = (ep: number | null, ver: number | null, models: ModelDrafts) =>
      mode === 'endpoint' ? { endpoint_id: ep, models: {} }
      : mode === 'version' ? { endpoint_id: epA, prompt_id: ver, models: {} }
      : { endpoint_id: epA, models: toSelection(models) };
    try {
      const r = await api.post<{ a: ManualSide; b: ManualSide }>('/flow/test/direct/ab', {
        message,
        score: scoreOn,
        metrics: scoreOn ? metrics : undefined,
        expected_output: gt,
        a: sideSpec(epA, verA, modelsA),
        b: sideSpec(epB, verB, modelsB),
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
      {/* Single 과 같은 두 줄: 대상(무엇을 A/B 로 가를지)과 그 컨트롤이 한 줄,
          입력·채점·실행이 다음 줄. 정확히 한 축만 갈린다 — 두 축을 동시에 다르게
          두는 복합 비교는 무엇 때문에 결과가 달라졌는지 알 수 없다. */}
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <InlineField label="대상">
            <SegToggle
              value={mode}
              onChange={setMode}
              options={[
                { id: 'version', label: '프롬프트', disabled: !PROMPT_TARGET_ENABLED, hint: PROMPT_TARGET_BLOCKED_HINT },
                { id: 'endpoint', label: 'API' },
                { id: 'model', label: '모델' },
              ]}
            />
          </InlineField>

          <InlineDivider />

          {mode === 'endpoint' ? (
            // 두 사이드가 각각 등록된 API 하나씩. 프롬프트·모델은 그대로 둔다.
            <>
              <InlineField label="A">
                <EndpointSelect endpoints={endpoints} value={epA} onChange={setEpA} />
              </InlineField>
              <InlineField label="B">
                <EndpointSelect endpoints={endpoints} value={epB} onChange={setEpB} />
              </InlineField>
              {epA != null && epA === epB && <span className="text-caption text-bad">A ≠ B</span>}
            </>
          ) : (
            <InlineField label="API">
              <EndpointSelect endpoints={endpoints} value={epA} onChange={setEpA} />
              {mode === 'version' && (
                <>
                  <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="h-9 w-40">
                    <option value="" disabled>노드</option>
                    {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
                  </Select>
                  <VersionSelect versions={versions} value={verA} onChange={setVerA} className="h-9 w-28" placeholder="A" />
                  <VersionSelect versions={versions} value={verB} onChange={setVerB} className="h-9 w-28" placeholder="B" />
                  {verA && verB && verA === verB && <span className="text-caption text-bad">A ≠ B</span>}
                </>
              )}
            </InlineField>
          )}
        </div>

        {mode === 'model' && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
            <ModelPicker
              roles={roles}
              columns={[
                { key: 'a', label: 'A', drafts: modelsA, onChange: setModelsA },
                { key: 'b', label: 'B', drafts: modelsB, onChange: setModelsB },
              ]}
            />
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-line pt-2.5">
          <InlineField label="입력">
            <SegToggle
              value={source}
              onChange={setSource}
              options={[{ id: 'dataset', label: '데이터셋' }, { id: 'manual', label: '직접 입력' }]}
            />
            {source === 'dataset' && <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />}
          </InlineField>

          <InlineDivider />

          <InlineField label="채점">
            <ScoreToggle on={scoreOn} onChange={setScoreOn} />
            {scoreOn && (
              <>
                <EvalOptions metrics={metrics} setMetrics={setMetrics} />
                {metrics.length === 0 && <span className="text-caption text-bad">하나 이상</span>}
              </>
            )}
          </InlineField>

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <StatusPill status={source === 'dataset' ? status : callStatus} />
            {modelErr && <span className="text-caption text-bad">{modelErr}</span>}
            {source === 'dataset' ? (
              <Button
                variant={status === 'running' ? 'secondary' : 'primary'}
                className="whitespace-nowrap"
                disabled={status === 'running' ? cancelling : !canRun}
                onClick={status === 'running' ? cancel : run}
              >
                {status === 'running' ? (cancelling ? '취소 중…' : '취소') : '비교 실행'}
              </Button>
            ) : (
              <Button variant="primary" className="whitespace-nowrap" disabled={!canCall} onClick={callAb}>
                {callStatus === 'running' ? '호출 중…' : 'A · B 호출'}
              </Button>
            )}
          </div>
        </div>

        {source === 'manual' && (
          <div className="mt-2.5 grid gap-2.5 border-t border-line pt-2.5 sm:grid-cols-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="메시지 * (A · B 공통)"
              className="w-full text-sm"
            />
            {exactOn && (
              <Textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={3}
                placeholder="기대 정답"
                title="응답 JSON 의 body 와 비교합니다. 비우면 정답 일치는 채점하지 않습니다."
                className="w-full text-sm"
              />
            )}
          </div>
        )}
      </Card>

      {source === 'manual' ? (
        <>
          {callError && <ErrBox msg={callError} />}
          {callStatus === 'idle' && !callError && (
            <LastRunPreview kind="compare" />
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
        <LastRunPreview kind="compare" />
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
              <p className="mb-1.5 eyebrow">A</p>
              <RunProgress rows={liveA} total={total} scoreOn={scoreOn} metrics={runMetrics} />
            </div>
            <div>
              <p className="mb-1.5 eyebrow">B</p>
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
            </div>
          </Card>
        </div>
      )}
        </>
      )}
    </div>
  );
}
