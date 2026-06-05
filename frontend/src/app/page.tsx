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
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  return (
    <div className="space-y-5">
      <SegToggle
        value={mode}
        onChange={setMode}
        options={[
          { id: 'single', label: '단일' },
          { id: 'compare', label: '버전 비교' },
        ]}
      />
      {mode === 'single' ? <SingleRunPanel /> : <ComparePanel />}
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
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<string[]>([...RAGAS_METRICS]);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live streaming state: results trickle in (answers first, then scores).
  const [live, setLive] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const runIdRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  async function run() {
    if (!datasetId) return;
    setError(null); setDetail(null); setShowDetail(false); setStatus('running');
    setLive([]); setTotal(0); setCancelling(false); runIdRef.current = null;
    try {
      const r = await api.post<{ ragas_run_id: number }>('/flow/test/ragas', { dataset_id: datasetId, metrics });
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
        <div className="flex flex-wrap items-center gap-3">
          <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
          <Button disabled={!datasetId || status === 'running'} onClick={run}>
            {status === 'running' ? '평가 중…' : 'RAGAS 실행'}
          </Button>
          {status === 'running' && (
            <Button variant="secondary" size="sm" disabled={cancelling} onClick={cancel}>
              {cancelling ? '취소 중…' : '실행 취소'}
            </Button>
          )}
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
          <div className="text-sm text-ink">데이터셋을 선택하고 <span className="font-medium">RAGAS 실행</span>을 누르세요.</div>
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
          <div className="mb-4 flex items-center gap-2 text-xs text-muted">
            <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'}>{detail.status}</Badge>
            <span>엔진 {detail.engine ?? '—'}</span>
            <span>·</span>
            <span>케이스 {detail.results.length}건 평균</span>
            <button onClick={() => setShowDetail((v) => !v)} className="ml-auto text-xs font-medium text-accent hover:underline">
              {showDetail ? '접기' : `케이스 상세 (${detail.results.length})`}
            </button>
          </div>
          <MetricTiles run={detail} />
          {showDetail && <div className="mt-4"><CaseTable detail={detail} /></div>}
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
  const [showCases, setShowCases] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live streaming: answers for both versions trickle in, then scores fill in.
  const [liveA, setLiveA] = useState<RagasResultRow[]>([]);
  const [liveB, setLiveB] = useState<RagasResultRow[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (nodeNm == null) { setVersions([]); return; }
    api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`).then(setVersions).catch(() => setVersions([]));
  }, [nodeNm]);

  // default A = active version, B = next most-recent
  useEffect(() => {
    const active = versions.find((v) => v.is_active === 'Y');
    const other = versions.find((v) => v.prompt_id !== active?.prompt_id);
    setVerA(active?.prompt_id ?? versions[0]?.prompt_id ?? null);
    setVerB(other?.prompt_id ?? versions[1]?.prompt_id ?? null);
  }, [versions]);

  const canRun = !!(nodeNm && verA && verB && verA !== verB && datasetId) && status !== 'running';
  const verLabel = (id: number | null) => versions.find((v) => v.prompt_id === id)?.version_no ?? '';

  async function run() {
    if (!canRun) return;
    setError(null); setDetailA(null); setDetailB(null); setShowCases(false); setStatus('running');
    setLiveA([]); setLiveB([]); setTotal(0);
    try {
      const r = await api.post<{ ragas_run_a_id: number; ragas_run_b_id: number }>('/flow/test/ragas/ab', {
        dataset_id: datasetId, node_nm: nodeNm, prompt_id_a: verA, prompt_id_b: verB, metrics,
      });
      const waitDone = (
        id: number,
        setLive: (f: (cur: RagasResultRow[]) => RagasResultRow[]) => void,
        setDet: (d: RagasRunDetail) => void,
      ) =>
        new Promise<void>((resolve) => {
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
                resolve();
              }
            },
          });
        });
      await Promise.all([
        waitDone(r.ragas_run_a_id, setLiveA, setDetailA),
        waitDone(r.ragas_run_b_id, setLiveB, setDetailB),
      ]);
      setStatus('done');
    } catch (e) { setError(errText(e)); setStatus('failed'); }
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
          <Button className="whitespace-nowrap" disabled={!canRun} onClick={run}>{status === 'running' ? '비교 중…' : '버전 비교 실행'}</Button>
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
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-medium text-ink">{nodeNm}</span>
            <Badge tone="neutral">A · v{verLabel(verA)}</Badge>
            <span>vs</span>
            <Badge tone="accent">B · v{verLabel(verB)}</Badge>
            <span className="ml-auto">엔진 {detailA.engine ?? '—'}</span>
            <button onClick={() => setShowCases((v) => !v)} className="text-xs font-medium text-accent hover:underline">
              {showCases ? '케이스 접기' : '케이스별 보기'}
            </button>
          </div>
          <MetricCompareTable detailA={detailA} detailB={detailB} />
          {showCases && (
            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
              <CaseCompareTable detailA={detailA} detailB={detailB} labelA={verLabel(verA)} labelB={verLabel(verB)} />
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
                    <TD><Badge tone={r.status === 'FAILED' ? 'bad' : r.status === 'DONE' ? 'ok' : 'neutral'}>{r.status}</Badge></TD>
                    <TD className="text-xs text-muted">{r.engine ?? '—'}</TD>
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
      <MetricCompareTable detailA={a} detailB={b} />
      <CaseCompareTable detailA={a} detailB={b} labelA={labelA} labelB={labelB} />
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

function MetricTiles({ run }: { run: RagasRunDetail }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {RAGAS_METRICS.map((m) => (
        <div key={m} className="rounded-lg border border-line bg-bg/60 p-3">
          <div className="truncate text-[11px] text-muted">{METRIC_LABELS[m]}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{fmt3(run[m])}</div>
        </div>
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
  return (
    <Table>
      <THead>
        <TR>
          <TH>질문</TH>
          <TH>버전</TH>
          <TH>답변</TH>
          {RAGAS_METRICS.map((m) => (<TH key={m} className="text-right whitespace-nowrap">{METRIC_LABELS[m]}</TH>))}
        </TR>
      </THead>
      <TBody>
        {ids.map((cid) => {
          const a = byA.get(cid);
          const b = byB.get(cid);
          const q = a?.question ?? b?.question ?? '—';
          const gt = a?.ground_truth ?? b?.ground_truth ?? null;
          return (
            <Fragment key={cid ?? 'null'}>
              <TR className="border-t-2 border-line">
                <TD rowSpan={2} className="max-w-[15rem] border-r border-line">
                  <Clamp>{q}</Clamp>
                  {gt && <div className="mt-1 text-[11px] text-muted">정답: {gt}</div>}
                </TD>
                <TD className="whitespace-nowrap"><Badge tone="neutral">A · v{labelA}</Badge></TD>
                <TD className="max-w-[20rem]"><Clamp>{a?.answer ?? a?.error_msg ?? '—'}</Clamp></TD>
                {RAGAS_METRICS.map((m) => (
                  <TD key={m} className="text-right font-mono text-xs tabular-nums text-muted">{fmt2(a?.[m])}</TD>
                ))}
              </TR>
              <TR>
                <TD className="whitespace-nowrap"><Badge tone="accent">B · v{labelB}</Badge></TD>
                <TD className="max-w-[20rem]"><Clamp>{b?.answer ?? b?.error_msg ?? '—'}</Clamp></TD>
                {RAGAS_METRICS.map((m) => {
                  const av = a?.[m];
                  const bv = b?.[m];
                  const cls = av != null && bv != null ? (bv > av ? 'text-ok' : bv < av ? 'text-bad' : 'text-muted') : 'text-muted';
                  return <TD key={m} className={'text-right font-mono text-xs tabular-nums ' + cls}>{fmt2(bv)}</TD>;
                })}
              </TR>
            </Fragment>
          );
        })}
        {ids.length === 0 && (
          <TR><TD colSpan={3 + RAGAS_METRICS.length} className="py-4 text-center text-xs text-muted">결과 행 없음</TD></TR>
        )}
      </TBody>
    </Table>
  );
}

function CaseTable({ detail, bordered }: { detail: RagasRunDetail; bordered?: boolean }) {
  const inner = (
    <Table>
      <THead>
        <TR>
          <TH>질문</TH><TH>답변</TH>
          {RAGAS_METRICS.map((m) => (<TH key={m} className="text-right whitespace-nowrap">{METRIC_LABELS[m]}</TH>))}
        </TR>
      </THead>
      <TBody>
        {detail.results.map((r) => (
          <TR key={r.ragas_result_id}>
            <TD className="max-w-[16rem]"><Clamp>{r.question ?? '—'}</Clamp></TD>
            <TD className="max-w-[16rem]"><Clamp>{r.answer ?? r.error_msg ?? '—'}</Clamp></TD>
            {RAGAS_METRICS.map((m) => (<TD key={m} className="text-right font-mono text-xs tabular-nums">{fmt2(r[m])}</TD>))}
          </TR>
        ))}
        {detail.results.length === 0 && (
          <TR><TD colSpan={2 + RAGAS_METRICS.length} className="py-4 text-center text-xs text-muted">결과 행 없음</TD></TR>
        )}
      </TBody>
    </Table>
  );
  if (detail.error_msg) {
    return (
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line bg-bad/5 px-3 py-2 text-xs text-bad">{detail.error_msg}</div>
        {inner}
      </div>
    );
  }
  return bordered ? <div className="overflow-hidden rounded-lg border border-line bg-surface">{inner}</div> : inner;
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
        <option key={v.prompt_id} value={v.prompt_id}>v{v.version_no}{v.is_active === 'Y' ? ' (활성)' : ''}</option>
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
function Clamp({ children }: { children: React.ReactNode }) {
  return <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-sans text-xs text-ink">{children}</pre>;
}
