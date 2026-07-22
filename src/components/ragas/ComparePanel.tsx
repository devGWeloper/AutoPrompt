'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { connectRagasRunWs } from '@/lib/ws';
import {
  RAGAS_METRICS,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
  type RunWsMessage,
} from '@/lib/types';
import { CaseCompareTable, CompareVerdict } from './CompareTable';
import {
  DatasetSelect,
  ErrBox,
  MetricChips,
  ScoreToggle,
  StatusPill,
  VersionSelect,
  errText,
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
