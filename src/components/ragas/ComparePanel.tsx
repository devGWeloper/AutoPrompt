'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { clearActiveRun, readActiveRun, saveActiveRun, type ActiveCompareRun } from '@/lib/activeRun';
import { connectRagasRunStream as connectRagasRunWs } from '@/lib/sse-client';
import { CompareSummaryDashboard } from './RunSummaryDashboard';
import {
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

export default function ComparePanel() {
  const { datasets } = useFlowDatasets();
  const nodes = usePromptNodes();
  const [nodeNm, setNodeNm] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [verA, setVerA] = useState<number | null>(null);
  const [verB, setVerB] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  // 정답 일치 is the default evaluation option (no judge LLM required).
  const [metrics, setMetrics] = useState<string[]>([EXACT_MATCH]);
  const [scoreOn, setScoreOn] = useState(true);
  // Temporary: the two versions currently live behind different endpoints, so a
  // comparison can be driven by endpoints (config agent.baseUrlA / baseUrlB, or
  // URLs typed here) instead of by two prompt versions of one node.
  const [mode, setMode] = useState<'version' | 'endpoint'>('version');
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
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

  // Endpoint mode identifies the two sides by URL, so no version is needed.
  const byVersion = mode === 'version' && !!(nodeNm && verA && verB && verA !== verB);
  const canRun =
    !!datasetId && (mode === 'endpoint' || byVersion) && (!scoreOn || metrics.length > 0) && status !== 'running';
  const verLabel = (id: number | null) => (mode === 'version' ? versions.find((v) => v.prompt_id === id)?.version_no ?? '' : '');
  const labA = runLabels?.[0] ?? verLabel(verA);
  const labB = runLabels?.[1] ?? verLabel(verB);

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
    // Version mode compares two prompt versions on the same endpoint, so the
    // A/B side (and its own URL) only applies in endpoint mode.
    const ep = mode === 'endpoint';
    const labels: [string, string] = [verLabel(verA), verLabel(verB)];
    setRunLabels(labels);
    try {
      const r = await api.post<{ ragas_run_a_id: number; ragas_run_b_id: number }>('/flow/test/ragas/ab', {
        dataset_id: datasetId,
        node_nm: byVersion ? nodeNm : null,
        prompt_id_a: byVersion ? verA : null,
        prompt_id_b: byVersion ? verB : null,
        metrics: scoreOn ? metrics : [], score: scoreOn,
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
        <FormRow label="대상">
          <SegToggle
            value={mode}
            onChange={setMode}
            options={[{ id: 'version', label: '프롬프트 버전' }, { id: 'endpoint', label: '엔드포인트' }]}
          />
          {mode === 'version' ? (
            <>
              <Select value={nodeNm ?? ''} onChange={(e) => setNodeNm(e.target.value)} className="w-44">
                <option value="" disabled>노드 선택</option>
                {nodes.map((n) => (<option key={n.node_nm} value={n.node_nm}>{n.node_nm}</option>))}
              </Select>
              <VersionSelect versions={versions} value={verA} onChange={setVerA} placeholder="버전 A" />
              <span className="text-xs text-muted">vs</span>
              <VersionSelect versions={versions} value={verB} onChange={setVerB} placeholder="버전 B" />
              {verA && verB && verA === verB && (
                <span className="w-full text-xs text-bad">버전 A와 B는 서로 달라야 합니다.</span>
              )}
            </>
          ) : (
            /* 임시: 두 버전이 서로 다른 엔드포인트에 떠 있어 각 쪽 URL로 비교한다.
               프롬프트 교체 없이 각 URL을 그대로 호출한다. */
            <>
              <span className="text-[11px] font-semibold text-muted">A</span>
              <Input value={urlA} onChange={(e) => setUrlA(e.target.value)} placeholder="비우면 config 의 agent.baseUrlA" className="w-64 text-sm" />
              <span className="text-[11px] font-semibold text-muted">B</span>
              <Input value={urlB} onChange={(e) => setUrlB(e.target.value)} placeholder="비우면 config 의 agent.baseUrlB" className="w-64 text-sm" />
            </>
          )}
        </FormRow>

        <FormRow label="입력">
          <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
          <span className="text-xs text-muted">두 대상 모두 같은 데이터셋으로 실행합니다.</span>
        </FormRow>

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
          <Button
            variant={status === 'running' ? 'secondary' : 'primary'}
            className="whitespace-nowrap"
            disabled={status === 'running' ? cancelling : !canRun}
            onClick={status === 'running' ? cancel : run}
          >
            {status === 'running' ? (cancelling ? 'Cancelling…' : 'Cancel run') : 'Run comparison'}
          </Button>
          <StatusPill status={status} />
          {mode === 'version' && !byVersion && (
            <span className="text-[11px] text-muted">노드와 서로 다른 두 버전을 선택하세요</span>
          )}
        </div>
      </Card>

      {error && <ErrBox msg={error} />}

      {status === 'idle' && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">비교할 <span className="font-medium">두 대상</span>과 데이터셋을 선택한 뒤 실행하세요.</div>
          <div className="text-xs text-muted"><span className="font-medium">프롬프트 버전</span>은 해당 노드의 프롬프트만 교체해 A/B로 실행합니다. 두 버전이 서로 다른 API에 떠 있다면 <span className="font-medium">엔드포인트</span>로 바꿔 각 URL을 그대로 호출하세요. 어느 쪽이든 두 실행 모두 같은 데이터셋으로 채점됩니다.</div>
        </Card>
      )}

      {/* Live A/B streaming while running: both versions' answers appear first, scores fill in. */}
      {status === 'running' && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
            <h3 className="mr-1 text-sm font-semibold text-ink">Comparison</h3>
            <Badge tone="neutral" dot>RUNNING</Badge>
            <Badge tone="neutral">A · {sideLabel(labA)}</Badge>
            <span>vs</span>
            <Badge tone="accent">B · {sideLabel(labB)}</Badge>
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
              <Badge tone="neutral">A · {sideLabel(labA)}</Badge>
              <span>vs</span>
              <Badge tone="accent">B · {sideLabel(labB)}</Badge>
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
    </div>
  );
}
