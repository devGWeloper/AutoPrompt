'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '@/components/ui/TopBar';
import { api, ApiError } from '@/lib/api';
import { MOCK } from '@/lib/mock';
import { connectFlowRunWs, connectRagasRunWs } from '@/lib/ws';
import {
  RAGAS_METRICS,
  type Dataset,
  type FlowVersionSummary,
  type RagasRunDetail,
  type RagasRunSummary,
  type RunWsMessage,
  type TestCase,
  type TestRunDetail,
  type TestRunOut,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';
const errText = (e: unknown) => (e instanceof ApiError ? JSON.stringify(e.detail) : String(e));

// ---- CSV export ------------------------------------------------------------
// In mock mode the backend /export endpoint isn't running, so build the CSV
// client-side from the (mocked) run detail. In real mode keep the link.
function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
async function exportTestCsv(runId: number) {
  const d = await api.get<TestRunDetail>(`/test-runs/${runId}`);
  downloadCsv(
    `test-run-${runId}.csv`,
    ['case_id', 'input_data', 'actual_output', 'is_passed', 'latency_ms', 'input_tokens', 'output_tokens', 'error_msg'],
    d.results.map((r) => [r.case_id, r.input_data, r.actual_output, r.is_passed, r.latency_ms, r.input_tokens, r.output_tokens, r.error_msg]),
  );
}
async function exportRagasCsv(ragasId: number) {
  const d = await api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`);
  downloadCsv(
    `ragas-run-${ragasId}.csv`,
    ['case_id', 'question', 'answer', ...RAGAS_METRICS, 'error_msg'],
    d.results.map((r) => [r.case_id, r.question, r.answer, ...RAGAS_METRICS.map((m) => r[m]), r.error_msg]),
  );
}
function CsvLink({ url, download, className }: { url: string; download: () => void; className: string }) {
  if (MOCK) return <button onClick={download} className={className}>CSV</button>;
  return <a href={url} className={className}>CSV</a>;
}

type Tab = 'flow' | 'batch' | 'ab' | 'ragas' | 'datasets' | 'records';
const TABS: { id: Tab; label: string }[] = [
  { id: 'flow', label: '플로우 실행' },
  { id: 'batch', label: '플로우 배치' },
  { id: 'ab', label: '플로우 A/B' },
  { id: 'ragas', label: '플로우 RAGAS' },
  { id: 'datasets', label: '데이터셋' },
  { id: 'records', label: '테스트 기록' },
];

export default function FlowTestHubPage() {
  const [tab, setTab] = useState<Tab>('flow');
  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar title="전체 테스트 (전체 플로우 단위)" />
      <div className="flex items-center gap-1 border-b-2 border-slate-200 bg-white px-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'px-4 py-3 text-sm font-bold ' +
              (tab === t.id ? 'border-b-4 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-6">
        {tab === 'flow' && <FlowRunPanel />}
        {tab === 'batch' && <BatchPanel />}
        {tab === 'ab' && <ABPanel />}
        {tab === 'ragas' && <RagasPanel />}
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
function useFlowVersions() {
  const [versions, setVersions] = useState<FlowVersionSummary[]>([]);
  useEffect(() => {
    api.get<FlowVersionSummary[]>('/flow/versions').then(setVersions).catch(() => setVersions([]));
  }, []);
  return versions;
}

// ---- 1) flow run (single, external) ----------------------------------------

function FlowRunPanel() {
  const [inputsText, setInputsText] = useState('{\n  "question": "샘플 질문"\n}');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [trace, setTrace] = useState<{ node_nm?: string; output?: string; latency_ms?: number; tokens?: number }[]>([]);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  async function run() {
    setError(null);
    setOutput(null);
    setTrace([]);
    let inputs: Record<string, string>;
    try {
      inputs = JSON.parse(inputsText);
    } catch (e) {
      setError(`입력 JSON 오류: ${String(e)}`);
      return;
    }
    setStatus('running');
    try {
      const run = await api.post<TestRunOut>('/flow/test/run', { inputs });
      wsRef.current?.close();
      wsRef.current = connectFlowRunWs(run.run_id, {
        onMessage: (m: RunWsMessage) => {
          if (m.event === 'NODE_DONE')
            setTrace((t) => [...t, { node_nm: m.node_nm, output: m.output, latency_ms: m.latency_ms, tokens: m.tokens }]);
          else if (m.event === 'DONE') { setOutput(m.output ?? ''); setStatus('done'); wsRef.current?.close(); }
          else if (m.event === 'FAILED') { setError(m.error); setStatus('failed'); wsRef.current?.close(); }
        },
      });
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  return (
    <div className="grid grid-cols-[26rem_1fr] gap-6">
      <div className="rounded-xl border-2 border-slate-200 bg-white p-5">
        <h2 className="text-base font-extrabold text-slate-700">입력</h2>
        <p className="mb-3 mt-1 text-xs font-medium text-slate-500">내부 모델 채팅 엔드포인트 호출 (RUN_MODE=external 필요).</p>
        <textarea value={inputsText} onChange={(e) => setInputsText(e.target.value)} rows={10}
          className="w-full rounded-md border-2 border-slate-300 p-3 font-mono text-sm" />
        <button onClick={run} disabled={status === 'running'}
          className="mt-3 w-full rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          {status === 'running' ? '실행 중...' : '전체 플로우 실행 ▶'}
        </button>
        <div className="mt-3 text-sm font-bold">상태: {status}</div>
        {error && <ErrBox msg={error} />}
      </div>
      <div className="rounded-xl border-2 border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-extrabold text-slate-700">트레이스</h2>
        <ol className="space-y-2">
          {trace.map((s, i) => (
            <li key={i} className="rounded-lg border-2 border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{i + 1}</span>
                <span className="font-bold">{s.node_nm}</span>
                <span className="ml-auto text-xs text-slate-400">{s.latency_ms ?? 0}ms · {s.tokens ?? 0} tok</span>
              </div>
              {s.output && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{s.output}</pre>}
            </li>
          ))}
        </ol>
        {output !== null && (
          <div className="mt-4 rounded-lg border-2 border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm font-extrabold text-emerald-700">최종 출력</div>
            <pre className="mt-1 whitespace-pre-wrap text-sm">{output}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- 2) flow batch ---------------------------------------------------------

function BatchPanel() {
  const { datasets } = useFlowDatasets();
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<TestRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  async function run() {
    if (!datasetId) return;
    setError(null); setDetail(null); setStatus('running');
    try {
      const r = await api.post<TestRunOut>('/flow/test/batch', { dataset_id: datasetId });
      wsRef.current?.close();
      wsRef.current = connectFlowRunWs(r.run_id, {
        onMessage: async (m: RunWsMessage) => {
          if (m.event === 'DONE') { setDetail(await api.get<TestRunDetail>(`/test-runs/${r.run_id}`)); setStatus('done'); wsRef.current?.close(); }
          else if (m.event === 'FAILED') { setError(m.error); setStatus('failed'); wsRef.current?.close(); }
        },
      });
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  return (
    <div className="space-y-4">
      <Controls>
        <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
        <RunButton disabled={!datasetId || status === 'running'} onClick={run} label="배치 실행" />
        <StatusText status={status} />
      </Controls>
      {error && <ErrBox msg={error} />}
      {detail && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-bold">케이스 {detail.total_cases}건 · 평균 {detail.avg_latency_ms ?? 0}ms · {detail.total_tokens ?? 0} tok</div>
          <ResultsTable rows={detail.results} />
        </div>
      )}
    </div>
  );
}

// ---- 3) flow A/B (two flow versions) ---------------------------------------

function ABPanel() {
  const { datasets } = useFlowDatasets();
  const versions = useFlowVersions();
  const [verA, setVerA] = useState<number | null>(null);
  const [verB, setVerB] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [status, setStatus] = useState('idle');
  const [aDetail, setADetail] = useState<TestRunDetail | null>(null);
  const [bDetail, setBDetail] = useState<TestRunDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!verA || !verB || !datasetId) return;
    setError(null); setADetail(null); setBDetail(null); setShowDetail(false); setStatus('running');
    try {
      const r = await api.post<{ run_a_id: number; run_b_id: number }>('/flow/test/ab', {
        dataset_id: datasetId, flow_ver_a: verA, flow_ver_b: verB,
      });
      const waitDone = (runId: number, set: (d: TestRunDetail) => void) =>
        new Promise<void>((resolve) => {
          const ws = connectFlowRunWs(runId, {
            onMessage: async (m: RunWsMessage) => {
              if (m.event === 'DONE' || m.event === 'FAILED') { set(await api.get<TestRunDetail>(`/test-runs/${runId}`)); ws.close(); resolve(); }
            },
          });
        });
      await Promise.all([waitDone(r.run_a_id, setADetail), waitDone(r.run_b_id, setBDetail)]);
      setStatus('done');
    } catch (e) { setError(errText(e)); setStatus('failed'); }
  }

  const byA = new Map((aDetail?.results ?? []).map((r) => [r.case_id, r]));
  const byB = new Map((bDetail?.results ?? []).map((r) => [r.case_id, r]));
  const caseIds = Array.from(new Set([...byA.keys(), ...byB.keys()]));
  const verLabel = (id: number | null) => versions.find((v) => v.flow_ver_id === id)?.flow_version_no ?? '';

  return (
    <div className="space-y-4">
      <Controls>
        <FlowVersionSelect versions={versions} value={verA} onChange={setVerA} placeholder="버전 A" />
        <FlowVersionSelect versions={versions} value={verB} onChange={setVerB} placeholder="버전 B" />
        <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
        <RunButton disabled={!verA || !verB || !datasetId || status === 'running'} onClick={run} label="A/B 실행" />
        <StatusText status={status} />
      </Controls>
      {error && <ErrBox msg={error} />}
      {(aDetail || bDetail) && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <ABSummary label={`A · v${verLabel(verA)}`} detail={aDetail} />
            <ABSummary label={`B · v${verLabel(verB)}`} detail={bDetail} />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setShowDetail((v) => !v)}
              className="rounded-md border-2 border-slate-300 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              {showDetail ? '접기' : `상세 (${caseIds.length}건 케이스별 비교)`}
            </button>
          </div>
          {showDetail && (
          <div className="overflow-auto rounded-xl border-2 border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr className="border-b-2 border-slate-200">
                  <th className="px-3 py-2 font-bold">case</th>
                  <th className="px-3 py-2 font-bold">입력</th>
                  <th className="px-3 py-2 font-bold">A 출력</th>
                  <th className="px-3 py-2 font-bold">B 출력</th>
                </tr>
              </thead>
              <tbody>
                {caseIds.map((cid) => {
                  const a = byA.get(cid); const b = byB.get(cid);
                  return (
                    <tr key={cid ?? 'null'} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono">{cid}</td>
                      <td className="px-3 py-2"><pre className="max-h-28 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{a?.input_data ?? b?.input_data ?? '-'}</pre></td>
                      <td className="px-3 py-2">
                        <div className="mb-1 text-xs text-slate-400">{a?.latency_ms ?? 0}ms</div>
                        <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-xs">{a?.actual_output ?? a?.error_msg ?? '-'}</pre>
                      </td>
                      <td className="px-3 py-2">
                        <div className="mb-1 text-xs text-slate-400">{b?.latency_ms ?? 0}ms</div>
                        <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-xs">{b?.actual_output ?? b?.error_msg ?? '-'}</pre>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}
    </div>
  );
}

function ABSummary({ label, detail }: { label: string; detail: TestRunDetail | null }) {
  return (
    <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
      <div className="text-sm font-extrabold text-slate-700">{label}</div>
      {detail ? (
        <div className="mt-1 text-sm text-slate-600">케이스 {detail.total_cases}건 · 평균 {detail.avg_latency_ms ?? 0}ms · {detail.total_tokens ?? 0} tok</div>
      ) : (
        <div className="mt-1 text-sm text-slate-400">실행 중...</div>
      )}
    </div>
  );
}

// ---- 4) flow RAGAS ---------------------------------------------------------

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
    <div className="space-y-4">
      <Controls>
        <DatasetSelect datasets={datasets} value={datasetId} onChange={setDatasetId} />
        <RunButton disabled={!datasetId || status === 'running'} onClick={run} label="RAGAS 실행" />
        <StatusText status={status} />
      </Controls>
      <div className="flex flex-wrap gap-3 text-xs">
        {RAGAS_METRICS.map((m) => (
          <label key={m} className="flex items-center gap-1 font-bold text-slate-600">
            <input type="checkbox" checked={metrics.includes(m)}
              onChange={(e) => setMetrics((cur) => (e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)))} />
            {m}
          </label>
        ))}
      </div>
      {error && <ErrBox msg={error} />}
      {detail?.error_msg && <ErrBox msg={detail.error_msg} />}
      {detail && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
          {/* 1개의 결과(평균) — 케이스별 점수의 평균 */}
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-bold">엔진: {detail.engine ?? '-'} · 상태: {detail.status}</span>
            <span className="text-xs text-slate-400">케이스 {detail.results.length}건 평균</span>
            <button
              onClick={() => setShowDetail((v) => !v)}
              className="ml-auto rounded-md border-2 border-slate-300 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              {showDetail ? '접기' : `상세 (${detail.results.length}건)`}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {RAGAS_METRICS.map((m) => (
              <span key={m} className="rounded bg-slate-100 px-2 py-1 font-bold">{m}: {detail[m] != null ? Number(detail[m]).toFixed(3) : '-'}</span>
            ))}
          </div>
          {showDetail && (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr className="border-b-2 border-slate-200">
                    <th className="px-3 py-2 font-bold">질문</th>
                    <th className="px-3 py-2 font-bold">답변</th>
                    {RAGAS_METRICS.map((m) => (<th key={m} className="px-2 py-2 font-bold">{m.slice(0, 4)}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {detail.results.map((r) => (
                    <tr key={r.ragas_result_id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2"><pre className="max-h-20 overflow-auto whitespace-pre-wrap text-xs">{r.question}</pre></td>
                      <td className="px-3 py-2"><pre className="max-h-20 overflow-auto whitespace-pre-wrap text-xs">{r.answer ?? r.error_msg}</pre></td>
                      {RAGAS_METRICS.map((m) => (<td key={m} className="px-2 py-2 font-mono text-xs">{r[m] != null ? Number(r[m]).toFixed(2) : '-'}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 5) flow datasets ------------------------------------------------------

function DatasetsPanel() {
  const { datasets, reload } = useFlowDatasets();
  const [selDataset, setSelDataset] = useState<number | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [newName, setNewName] = useState('');
  const [caseInput, setCaseInput] = useState('{"question": ""}');
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
    <div className="space-y-4">
      <Controls>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 플로우 데이터셋 이름"
          className="rounded-md border-2 border-slate-300 px-3 py-2 text-sm" />
        <RunButton disabled={!newName.trim()} onClick={createDataset} label="데이터셋 생성" />
      </Controls>
      {error && <ErrBox msg={error} />}
      <div className="grid grid-cols-[20rem_1fr] gap-4">
        <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-extrabold text-slate-700">데이터셋</h3>
          <ul className="space-y-2">
            {datasets.map((d) => (
              <li key={d.dataset_id} className="flex items-center gap-2">
                <button onClick={() => setSelDataset(d.dataset_id)}
                  className={'flex-1 rounded-md border-2 px-3 py-2 text-left text-sm font-bold ' + (selDataset === d.dataset_id ? 'border-blue-500 bg-blue-50' : 'border-slate-200')}>
                  {d.dataset_nm}
                </button>
                <button onClick={() => delDataset(d.dataset_id)} className="text-xs font-bold text-red-600">삭제</button>
              </li>
            ))}
            {datasets.length === 0 && <li className="text-sm text-slate-400">데이터셋 없음</li>}
          </ul>
        </div>
        <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
          {selDataset == null ? (
            <div className="text-sm text-slate-400">데이터셋을 선택하세요.</div>
          ) : (
            <>
              <h3 className="mb-2 text-sm font-extrabold text-slate-700">케이스 ({cases.length})</h3>
              <p className="mb-2 text-xs text-slate-500">input_data 는 플로우 입력 JSON (예: {'{"question": "..."}'}).</p>
              <div className="mb-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                <input value={caseInput} onChange={(e) => setCaseInput(e.target.value)} placeholder="input_data JSON"
                  className="rounded-md border-2 border-slate-300 px-2 py-1.5 font-mono text-xs" />
                <input value={caseExpected} onChange={(e) => setCaseExpected(e.target.value)} placeholder="expected_output (선택)"
                  className="rounded-md border-2 border-slate-300 px-2 py-1.5 text-xs" />
                <button onClick={addCase} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">추가</button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr className="border-b-2 border-slate-200"><th className="py-2 font-bold">input</th><th className="py-2 font-bold">expected</th><th></th></tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.case_id} className="border-b border-slate-100">
                      <td className="py-2 font-mono text-xs">{c.input_data}</td>
                      <td className="py-2 text-xs">{c.expected_output ?? '-'}</td>
                      <td className="py-2 text-right"><button onClick={() => delCase(c.case_id)} className="text-xs font-bold text-red-600">삭제</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- 6) records ------------------------------------------------------------

function RecordsPanel() {
  const [runs, setRuns] = useState<TestRunOut[]>([]);
  const [ragas, setRagas] = useState<RagasRunSummary[]>([]);
  const [openTest, setOpenTest] = useState<number | null>(null);
  const [openRagas, setOpenRagas] = useState<number | null>(null);
  const reload = useCallback(() => {
    api.get<TestRunOut[]>('/test-runs').then(setRuns).catch(() => setRuns([]));
    api.get<RagasRunSummary[]>('/ragas-runs').then(setRagas).catch(() => setRagas([]));
  }, []);
  useEffect(reload, [reload]);
  async function delRun(id: number) { await api.del(`/test-runs/${id}`); if (openTest === id) setOpenTest(null); reload(); }
  async function delRuns(ids: number[]) { await Promise.all(ids.map((id) => api.del(`/test-runs/${id}`))); setOpenTest(null); reload(); }
  async function delRagas(id: number) { await api.del(`/ragas-runs/${id}`); if (openRagas === id) setOpenRagas(null); reload(); }
  const detailBtn = 'mr-2 text-xs font-bold text-blue-600';

  // Collapse a flow A/B pair (two FLOW_AB runs sharing ab_group_id) into one row.
  type RunGroup = { kind: 'single'; run: TestRunOut } | { kind: 'ab'; groupId: number; members: TestRunOut[] };
  const groups: RunGroup[] = [];
  const seenGroup = new Set<number>();
  for (const r of runs) {
    if (r.run_type === 'FLOW_AB' && r.ab_group_id != null) {
      if (seenGroup.has(r.ab_group_id)) continue;
      seenGroup.add(r.ab_group_id);
      const members = runs
        .filter((x) => x.ab_group_id === r.ab_group_id)
        .sort((a, b) => a.run_id - b.run_id);
      groups.push({ kind: 'ab', groupId: r.ab_group_id, members });
    } else {
      groups.push({ kind: 'single', run: r });
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-700">테스트 실행 ({groups.length})</h2>
          <button onClick={reload} className="rounded-md border-2 border-slate-300 px-3 py-1.5 text-sm font-bold">새로고침</button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr className="border-b-2 border-slate-200">
              <th className="px-3 py-2 font-bold">run</th><th className="px-3 py-2 font-bold">유형</th><th className="px-3 py-2 font-bold">상태</th>
              <th className="px-3 py-2 font-bold">케이스</th><th className="px-3 py-2 font-bold">평균ms</th><th className="px-3 py-2 font-bold">tok</th>
              <th className="px-3 py-2 font-bold">생성</th><th className="px-3 py-2 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              if (g.kind === 'single') {
                const r = g.run;
                return (
                  <Fragment key={`r${r.run_id}`}>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-2 font-mono">#{r.run_id}</td>
                      <td className="px-3 py-2 font-bold">{r.run_type}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2">{r.total_cases}</td>
                      <td className="px-3 py-2">{r.avg_latency_ms ?? '-'}</td>
                      <td className="px-3 py-2">{r.total_tokens ?? '-'}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{r.created_dt}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setOpenTest(openTest === r.run_id ? null : r.run_id)} className={detailBtn}>
                          {openTest === r.run_id ? '접기' : '상세'}
                        </button>
                        <CsvLink url={`${API_BASE}/test-runs/${r.run_id}/export?fmt=csv`} download={() => exportTestCsv(r.run_id)} className="mr-2 text-xs font-bold text-slate-600" />
                        <button onClick={() => delRun(r.run_id)} className="text-xs font-bold text-red-600">삭제</button>
                      </td>
                    </tr>
                    {openTest === r.run_id && (
                      <tr><td colSpan={8} className="bg-slate-50 px-3 py-3"><TestRunDetailView runId={r.run_id} /></td></tr>
                    )}
                  </Fragment>
                );
              }
              // A/B pair → one row
              const [a, b] = g.members;
              const open = openTest === g.groupId;
              const status = a.status === b.status ? a.status : `${a.status} / ${b.status}`;
              return (
                <Fragment key={`ab${g.groupId}`}>
                  <tr className="border-b border-slate-100">
                    <td className="px-3 py-2 font-mono">#{a.run_id}/#{b.run_id}</td>
                    <td className="px-3 py-2 font-bold">FLOW_AB</td>
                    <td className="px-3 py-2">{status}</td>
                    <td className="px-3 py-2">{a.total_cases}</td>
                    <td className="px-3 py-2">{a.avg_latency_ms ?? '-'} · {b.avg_latency_ms ?? '-'}</td>
                    <td className="px-3 py-2">{a.total_tokens ?? '-'} · {b.total_tokens ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{a.created_dt}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setOpenTest(open ? null : g.groupId)} className={detailBtn}>
                        {open ? '접기' : '상세'}
                      </button>
                      <button onClick={() => delRuns([a.run_id, b.run_id])} className="text-xs font-bold text-red-600">삭제</button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50 px-3 py-3">
                        <div className="space-y-4">
                          {g.members.map((m, i) => (
                            <div key={m.run_id}>
                              <div className="mb-1 flex items-center gap-2 text-xs font-bold text-slate-600">
                                <span className="rounded bg-slate-900 px-2 py-0.5 text-white">{i === 0 ? 'A' : 'B'}</span>
                                <span className="font-mono">#{m.run_id}</span>
                                <span>케이스 {m.total_cases}건</span>
                                <CsvLink url={`${API_BASE}/test-runs/${m.run_id}/export?fmt=csv`} download={() => exportTestCsv(m.run_id)} className="ml-auto text-xs font-bold text-slate-600" />
                              </div>
                              <TestRunDetailView runId={m.run_id} />
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {groups.length === 0 && (<tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">테스트 실행 기록이 없습니다.</td></tr>)}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-base font-extrabold text-slate-700">RAGAS 실행 ({ragas.length})</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr className="border-b-2 border-slate-200">
              <th className="px-3 py-2 font-bold">run</th><th className="px-3 py-2 font-bold">상태</th><th className="px-3 py-2 font-bold">엔진</th>
              {RAGAS_METRICS.map((m) => (<th key={m} className="px-2 py-2 font-bold">{m.slice(0, 4)}</th>))}
              <th className="px-3 py-2 font-bold">생성</th><th className="px-3 py-2 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {ragas.map((r) => (
              <Fragment key={r.ragas_run_id}>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono">#{r.ragas_run_id}</td>
                  <td className="px-3 py-2">
                    <span className={r.status === 'FAILED' ? 'font-bold text-red-600' : ''}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2">{r.engine ?? '-'}</td>
                  {RAGAS_METRICS.map((m) => (
                    <td key={m} className="px-2 py-2 font-mono text-xs">{r[m] != null ? Number(r[m]).toFixed(2) : '-'}</td>
                  ))}
                  <td className="px-3 py-2 text-xs text-slate-400">{r.created_dt}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setOpenRagas(openRagas === r.ragas_run_id ? null : r.ragas_run_id)} className={detailBtn}>
                      {openRagas === r.ragas_run_id ? '접기' : '상세'}
                    </button>
                    <CsvLink url={`${API_BASE}/ragas-runs/${r.ragas_run_id}/export?fmt=csv`} download={() => exportRagasCsv(r.ragas_run_id)} className="mr-2 text-xs font-bold text-slate-600" />
                    <button onClick={() => delRagas(r.ragas_run_id)} className="text-xs font-bold text-red-600">삭제</button>
                  </td>
                </tr>
                {r.error_msg && (
                  <tr className="border-b border-slate-100">
                    <td colSpan={6 + RAGAS_METRICS.length} className="px-3 pb-2 text-xs font-semibold text-red-700">
                      ⚠ {r.error_msg}
                    </td>
                  </tr>
                )}
                {openRagas === r.ragas_run_id && (
                  <tr><td colSpan={6 + RAGAS_METRICS.length} className="bg-slate-50 px-3 py-3"><RagasRunDetailView ragasId={r.ragas_run_id} /></td></tr>
                )}
              </Fragment>
            ))}
            {ragas.length === 0 && (<tr><td colSpan={6 + RAGAS_METRICS.length} className="px-3 py-6 text-center text-sm text-slate-400">RAGAS 실행 기록이 없습니다.</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TestRunDetailView({ runId }: { runId: number }) {
  const [detail, setDetail] = useState<TestRunDetail | null>(null);
  useEffect(() => { api.get<TestRunDetail>(`/test-runs/${runId}`).then(setDetail).catch(() => setDetail(null)); }, [runId]);
  if (!detail) return <div className="text-xs text-slate-400">불러오는 중...</div>;
  if (detail.results.length === 0) return <div className="text-xs text-slate-400">결과 행이 없습니다.</div>;
  return <ResultsTable rows={detail.results} />;
}

function RagasRunDetailView({ ragasId }: { ragasId: number }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  useEffect(() => { api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`).then(setDetail).catch(() => setDetail(null)); }, [ragasId]);
  if (!detail) return <div className="text-xs text-slate-400">불러오는 중...</div>;
  return (
    <div className="overflow-auto">
      {detail.error_msg && <div className="mb-2 rounded bg-red-50 p-2 text-xs font-semibold text-red-700">{detail.error_msg}</div>}
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr className="border-b-2 border-slate-200">
            <th className="px-3 py-2 font-bold">질문(입력)</th>
            <th className="px-3 py-2 font-bold">답변(출력)</th>
            {RAGAS_METRICS.map((m) => (<th key={m} className="px-2 py-2 font-bold">{m.slice(0, 4)}</th>))}
            <th className="px-3 py-2 font-bold">오류</th>
          </tr>
        </thead>
        <tbody>
          {detail.results.map((r) => (
            <tr key={r.ragas_result_id} className="border-b border-slate-100 align-top">
              <td className="px-3 py-2"><pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs">{r.question ?? '-'}</pre></td>
              <td className="px-3 py-2"><pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs">{r.answer ?? '-'}</pre></td>
              {RAGAS_METRICS.map((m) => (<td key={m} className="px-2 py-2 font-mono text-xs">{r[m] != null ? Number(r[m]).toFixed(2) : '-'}</td>))}
              <td className="px-3 py-2 text-xs text-red-600">{r.error_msg ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- shared controls -------------------------------------------------------

function Controls({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-slate-200 bg-white p-4">{children}</div>;
}
function DatasetSelect({ datasets, value, onChange }: { datasets: Dataset[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="rounded-md border-2 border-slate-300 px-3 py-2 text-sm">
      <option value="" disabled>플로우 데이터셋</option>
      {datasets.map((d) => (<option key={d.dataset_id} value={d.dataset_id}>{d.dataset_nm}</option>))}
    </select>
  );
}
function FlowVersionSelect({ versions, value, onChange, placeholder }: { versions: FlowVersionSummary[]; value: number | null; onChange: (id: number) => void; placeholder: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="rounded-md border-2 border-slate-300 px-3 py-2 text-sm">
      <option value="" disabled>{placeholder}</option>
      {versions.map((v) => (<option key={v.flow_ver_id} value={v.flow_ver_id}>v{v.flow_version_no}{v.is_active === 'Y' ? ' (active)' : ''}</option>))}
    </select>
  );
}
function RunButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} disabled={disabled} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{label}</button>;
}
function StatusText({ status }: { status: string }) { return <span className="text-sm font-bold text-slate-500">상태: {status}</span>; }
function ErrBox({ msg }: { msg: string }) { return <div className="mt-2 rounded-md border-2 border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{msg}</div>; }
function ResultsTable({ rows }: { rows: TestRunDetail['results'] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr className="border-b-2 border-slate-200">
            <th className="px-3 py-2 font-bold">case</th>
            <th className="px-3 py-2 font-bold">입력</th>
            <th className="px-3 py-2 font-bold">출력 / 오류</th>
            <th className="px-3 py-2 font-bold">ms</th>
            <th className="px-3 py-2 font-bold">tok</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.result_id} className="border-b border-slate-100 align-top">
              <td className="px-3 py-2 font-mono">{r.case_id}</td>
              <td className="px-3 py-2"><pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{r.input_data ?? '-'}</pre></td>
              <td className="px-3 py-2"><pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs">{r.actual_output ?? r.error_msg ?? '-'}</pre></td>
              <td className="px-3 py-2">{r.latency_ms ?? '-'}</td>
              <td className="px-3 py-2">{(r.input_tokens ?? 0) + (r.output_tokens ?? 0) || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
