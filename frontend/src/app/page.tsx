'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
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
  type Dataset,
  type RagasRunDetail,
  type RagasRunSummary,
  type RunWsMessage,
  type TestCase,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';
const errText = (e: unknown) => (e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
const fmt2 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(2) : '—');
const fmt3 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(3) : '—');

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
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-7xl">
          {tab === 'run' && <RagasPanel />}
          {tab === 'datasets' && <DatasetsPanel />}
          {tab === 'records' && <RecordsPanel />}
        </div>
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

// ---- 1) RAGAS run ----------------------------------------------------------

function RagasPanel() {
  const { datasets } = useFlowDatasets();
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<string[]>([...RAGAS_METRICS]);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!datasetId) return;
    setError(null); setDetail(null); setShowDetail(false); setStatus('running');
    try {
      const r = await api.post<{ ragas_run_id: number }>('/flow/test/ragas', { dataset_id: datasetId, metrics });
      const ws = connectRagasRunWs(r.ragas_run_id, {
        onMessage: async (m: RunWsMessage) => {
          if (m.event === 'DONE' || m.event === 'FAILED') {
            setDetail(await api.get<RagasRunDetail>(`/ragas-runs/${r.ragas_run_id}`));
            setStatus(m.event === 'FAILED' ? 'failed' : 'done');
            ws.close();
          }
        },
      });
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={datasetId ?? ''} onChange={(e) => setDatasetId(Number(e.target.value))} className="w-56">
            <option value="" disabled>데이터셋 선택</option>
            {datasets.map((d) => (<option key={d.dataset_id} value={d.dataset_id}>{d.dataset_nm}</option>))}
          </Select>
          <Button disabled={!datasetId || status === 'running'} onClick={run}>
            {status === 'running' ? '평가 중…' : 'RAGAS 실행'}
          </Button>
          <StatusPill status={status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
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
      </Card>

      {error && <ErrBox msg={error} />}
      {detail?.error_msg && <ErrBox msg={detail.error_msg} />}

      {!detail && !error && (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <div className="text-sm text-ink">
            데이터셋을 선택하고 <span className="font-medium">RAGAS 실행</span>을 누르세요.
          </div>
          <div className="text-xs text-muted">지난 평가 결과는 ‘평가 기록’ 탭에서 볼 수 있습니다.</div>
        </Card>
      )}

      {detail && (
        <Card className="p-4">
          <div className="mb-4 flex items-center gap-2 text-xs text-muted">
            <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'}>{detail.status}</Badge>
            <span>엔진 {detail.engine ?? '—'}</span>
            <span>·</span>
            <span>케이스 {detail.results.length}건 평균</span>
            <button
              onClick={() => setShowDetail((v) => !v)}
              className="ml-auto text-xs font-medium text-accent hover:underline"
            >
              {showDetail ? '접기' : `케이스 상세 (${detail.results.length})`}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {RAGAS_METRICS.map((m) => (
              <div key={m} className="rounded-lg border border-line bg-bg/60 p-3">
                <div className="truncate text-[11px] text-muted">{m}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{fmt3(detail[m])}</div>
              </div>
            ))}
          </div>
          {showDetail && (
            <div className="mt-4">
              <Table>
                <THead>
                  <TR>
                    <TH>질문</TH>
                    <TH>답변</TH>
                    {RAGAS_METRICS.map((m) => (<TH key={m} className="text-right">{m.slice(0, 4)}</TH>))}
                  </TR>
                </THead>
                <TBody>
                  {detail.results.map((r) => (
                    <TR key={r.ragas_result_id}>
                      <TD className="max-w-[18rem]"><Clamp>{r.question}</Clamp></TD>
                      <TD className="max-w-[18rem]"><Clamp>{r.answer ?? r.error_msg}</Clamp></TD>
                      {RAGAS_METRICS.map((m) => (
                        <TD key={m} className="text-right font-mono text-xs tabular-nums">{fmt2(r[m])}</TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---- 2) datasets -----------------------------------------------------------

function DatasetsPanel() {
  const { datasets, reload } = useFlowDatasets();
  const [selDataset, setSelDataset] = useState<number | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [newName, setNewName] = useState('');
  const [caseInput, setCaseInput] = useState('{"question": "", "ground_truth": ""}');
  const [caseExpected, setCaseExpected] = useState('');
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
    if (selDataset == null) return;
    try { await api.post(`/datasets/${selDataset}/cases`, { input_data: caseInput, expected_output: caseExpected || null }); setCaseExpected(''); loadCases(); }
    catch (e) { setError(errText(e)); }
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
          <ul className="space-y-1.5">
            {datasets.map((d) => (
              <li key={d.dataset_id} className="flex items-center gap-2">
                <button
                  onClick={() => setSelDataset(d.dataset_id)}
                  className={
                    'flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors ' +
                    (selDataset === d.dataset_id
                      ? 'border-accent/40 bg-accent/5 font-medium text-ink'
                      : 'border-line text-ink hover:bg-bg')
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
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">케이스 ({cases.length})</h3>
              <p className="mb-3 text-xs text-muted">
                input_data 는 평가 입력 JSON. 인식 키: question, contexts(list|str), ground_truth.
              </p>
              <div className="mb-4 grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input value={caseInput} onChange={(e) => setCaseInput(e.target.value)} placeholder='{"question": "..."}' className="font-mono text-xs" />
                <Input value={caseExpected} onChange={(e) => setCaseExpected(e.target.value)} placeholder="expected_output (선택)" className="text-xs" />
                <Button variant="secondary" size="sm" onClick={addCase}>추가</Button>
              </div>
              <Table>
                <THead>
                  <TR><TH>input</TH><TH>expected</TH><TH /></TR>
                </THead>
                <TBody>
                  {cases.map((c) => (
                    <TR key={c.case_id}>
                      <TD className="font-mono text-xs">{c.input_data}</TD>
                      <TD className="text-xs">{c.expected_output ?? '—'}</TD>
                      <TD className="text-right"><Button variant="danger" size="sm" onClick={() => delCase(c.case_id)}>삭제</Button></TD>
                    </TR>
                  ))}
                  {cases.length === 0 && <TR><TD colSpan={3} className="py-6 text-center text-muted">케이스 없음</TD></TR>}
                </TBody>
              </Table>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---- 3) records ------------------------------------------------------------

function RecordsPanel() {
  const [ragas, setRagas] = useState<RagasRunSummary[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const reload = useCallback(() => {
    api.get<RagasRunSummary[]>('/ragas-runs').then(setRagas).catch(() => setRagas([]));
  }, []);
  useEffect(reload, [reload]);
  async function del(id: number) { await api.del(`/ragas-runs/${id}`); if (open === id) setOpen(null); reload(); }
  const cols = 4 + RAGAS_METRICS.length;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">평가 기록 <span className="text-muted">({ragas.length})</span></h2>
        <Button variant="secondary" size="sm" onClick={reload}>새로고침</Button>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>run</TH><TH>상태</TH><TH>엔진</TH>
            {RAGAS_METRICS.map((m) => (<TH key={m} className="text-right">{m.slice(0, 4)}</TH>))}
            <TH>생성</TH><TH />
          </TR>
        </THead>
        <TBody>
          {ragas.map((r) => (
            <Fragment key={r.ragas_run_id}>
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
              {r.error_msg && (
                <TR><TD colSpan={cols} className="bg-bad/5 text-xs text-bad">⚠ {r.error_msg}</TD></TR>
              )}
              {open === r.ragas_run_id && (
                <TR><TD colSpan={cols} className="bg-bg/60 p-3"><RagasRunDetailView ragasId={r.ragas_run_id} /></TD></TR>
              )}
            </Fragment>
          ))}
          {ragas.length === 0 && (<TR><TD colSpan={cols} className="py-10 text-center text-sm text-muted">RAGAS 평가 기록이 없습니다.</TD></TR>)}
        </TBody>
      </Table>
    </Card>
  );
}

function RagasRunDetailView({ ragasId }: { ragasId: number }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  useEffect(() => { api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`).then(setDetail).catch(() => setDetail(null)); }, [ragasId]);
  if (!detail) return <div className="text-xs text-muted">불러오는 중…</div>;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      {detail.error_msg && <div className="border-b border-line bg-bad/5 px-3 py-2 text-xs text-bad">{detail.error_msg}</div>}
      <Table>
        <THead>
          <TR>
            <TH>질문(입력)</TH><TH>답변(출력)</TH>
            {RAGAS_METRICS.map((m) => (<TH key={m} className="text-right">{m.slice(0, 4)}</TH>))}
            <TH>오류</TH>
          </TR>
        </THead>
        <TBody>
          {detail.results.map((r) => (
            <TR key={r.ragas_result_id}>
              <TD className="max-w-[16rem]"><Clamp>{r.question ?? '—'}</Clamp></TD>
              <TD className="max-w-[16rem]"><Clamp>{r.answer ?? '—'}</Clamp></TD>
              {RAGAS_METRICS.map((m) => (<TD key={m} className="text-right font-mono text-xs tabular-nums">{fmt2(r[m])}</TD>))}
              <TD className="text-xs text-bad">{r.error_msg ?? ''}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

// ---- small local helpers ---------------------------------------------------

function StatusPill({ status }: { status: string }) {
  return <span className="text-sm text-muted">상태 · {status}</span>;
}
function ErrBox({ msg }: { msg: string }) {
  return <div className="rounded-lg border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{msg}</div>;
}
function Clamp({ children }: { children: React.ReactNode }) {
  return <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-sans text-xs text-ink">{children}</pre>;
}
