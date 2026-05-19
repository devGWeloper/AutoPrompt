'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TopBar from '@/components/ui/TopBar';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import { connectTestRunWs } from '@/lib/ws';
import type {
  ABRunOut,
  CaseCreate,
  Dataset,
  PromptVersionDetail,
  PromptVersionSummary,
  TestCase,
  TestRunDetail,
  TestRunOut,
  TestRunResult,
} from '@/types';

const EXPORT_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

type Tab = 'playground' | 'batch' | 'ab' | 'dataset';

export default function TestPage() {
  const params = useParams<{ projectId: string; nodeId: string }>();
  const router = useRouter();
  const projectId = Number(params.projectId);
  const nodeId = Number(params.nodeId);
  const [tab, setTab] = useState<Tab>('playground');

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        title={`Node #${nodeId} — Test`}
        right={
          <div className="flex gap-2">
            <NavBtn label="Graph" onClick={() => router.push(`/projects/${projectId}/graph`)} />
            <NavBtn
              label="Prompts"
              onClick={() => router.push(`/projects/${projectId}/nodes/${nodeId}/prompts`)}
            />
            <NavBtn
              label="RAGAS"
              onClick={() => router.push(`/projects/${projectId}/nodes/${nodeId}/ragas`)}
            />
          </div>
        }
      />
      <div className="border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex gap-2 text-sm">
          {(['playground', 'batch', 'ab', 'dataset'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 ${
                tab === t ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'playground' && <Playground nodeId={nodeId} />}
        {tab === 'batch' && <BatchPanel nodeId={nodeId} />}
        {tab === 'ab' && <ABPanel nodeId={nodeId} />}
        {tab === 'dataset' && <DatasetPanel nodeId={nodeId} />}
      </div>
    </div>
  );
}

function NavBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
    >
      {label}
    </button>
  );
}

// ---- Playground tab (F-30) ----

type RunStatus = 'idle' | 'pending' | 'running' | 'done' | 'failed';

function Playground({ nodeId }: { nodeId: number }) {
  const [prompts, setPrompts] = useState<PromptVersionSummary[]>([]);
  const [promptId, setPromptId] = useState<number | null>(null);
  const [promptDetail, setPromptDetail] = useState<PromptVersionDetail | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<RunStatus>('idle');
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    api
      .get<PromptVersionSummary[]>(`/nodes/${nodeId}/prompts`)
      .then((rows) => {
        setPrompts(rows);
        const active = rows.find((r) => r.is_active === 'Y') || rows[0];
        if (active) setPromptId(active.prompt_id);
      })
      .catch((e) => setError(e instanceof ApiError ? String(e.detail) : String(e)));
  }, [nodeId]);

  useEffect(() => {
    if (promptId === null) return;
    api
      .get<PromptVersionDetail>(`/prompts/${promptId}`)
      .then((d) => {
        setPromptDetail(d);
        const init: Record<string, string> = {};
        for (const v of d.variables) init[v.var_name] = v.default_value ?? '';
        setVars(init);
      })
      .catch((e) => setError(e instanceof ApiError ? String(e.detail) : String(e)));
  }, [promptId]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const run = useCallback(async () => {
    if (promptId === null) return;
    setStatus('pending');
    setResult(null);
    setError(null);
    wsRef.current?.close();
    try {
      const out = await api.post<TestRunOut>(`/nodes/${nodeId}/test/run`, {
        prompt_id: promptId,
        variables: vars,
      });
      const ws = connectTestRunWs(out.run_id, {
        onMessage: (msg) => {
          if (msg.event === 'RUNNING') {
            setStatus('running');
          } else if (msg.event === 'DONE') {
            if (msg.result) setResult(msg.result);
            setStatus('done');
            ws.close();
          } else if (msg.event === 'FAILED') {
            setError(msg.error);
            setStatus('failed');
            ws.close();
          }
        },
        onClose: (ev) => {
          setStatus((s) => {
            if (s === 'pending' || s === 'running') {
              setError(`WebSocket closed (code ${ev.code}).`);
              return 'failed';
            }
            return s;
          });
        },
      });
      wsRef.current = ws;
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
      setStatus('failed');
    }
  }, [nodeId, promptId, vars]);

  return (
    <div className="grid max-w-3xl gap-4">
      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>
          <div className="text-xs text-slate-500">Prompt version</div>
          <select
            value={promptId ?? ''}
            onChange={(e) => setPromptId(Number(e.target.value))}
            className="w-full rounded border border-slate-300 px-2 py-1"
          >
            {prompts.map((p) => (
              <option key={p.prompt_id} value={p.prompt_id}>
                v{p.version_no} {p.is_active === 'Y' ? '(active)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="text-xs text-slate-500">Model (from prompt version)</div>
          <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs">
            {promptDetail
              ? `${promptDetail.model_provider} / ${promptDetail.model_nm}`
              : '-'}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold text-slate-500">Variables</div>
        {promptDetail && promptDetail.variables.length > 0 ? (
          <div className="grid gap-2">
            {promptDetail.variables.map((v) => (
              <label key={v.var_name} className="text-sm">
                <div className="text-xs text-slate-500">
                  {v.var_name}
                  {v.is_required === 'Y' && <span className="text-red-500"> *</span>}
                </div>
                <input
                  value={vars[v.var_name] ?? ''}
                  onChange={(e) =>
                    setVars((prev) => ({ ...prev, [v.var_name]: e.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1"
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500">No variables for this prompt.</div>
        )}
      </div>

      <div>
        <button
          onClick={run}
          disabled={promptId === null || status === 'pending' || status === 'running'}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {status === 'pending' || status === 'running' ? 'Running…' : 'Run'}
        </button>
        <span className="ml-3 text-xs text-slate-500">status: {status}</span>
      </div>

      {result && (
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">
          <div className="mb-2 flex gap-4 text-xs text-slate-500">
            <span>latency: {result.latency_ms} ms</span>
            <span>in: {result.input_tokens} tok</span>
            <span>out: {result.output_tokens} tok</span>
            <span>model: {result.model}</span>
          </div>
          <pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-sm">
            {result.actual_output}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---- Dataset tab (F-34) ----

function DatasetPanel({ nodeId }: { nodeId: number }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [newName, setNewName] = useState('');
  const [showCase, setShowCase] = useState(false);
  const [editCase, setEditCase] = useState<TestCase | null>(null);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadDatasets = useCallback(async () => {
    const rows = await api.get<Dataset[]>(`/nodes/${nodeId}/datasets`);
    setDatasets(rows);
  }, [nodeId]);

  const reloadCases = useCallback(async () => {
    if (selectedId === null) {
      setCases([]);
      return;
    }
    setCases(await api.get<TestCase[]>(`/datasets/${selectedId}/cases`));
  }, [selectedId]);

  useEffect(() => {
    reloadDatasets().catch((e) =>
      setError(e instanceof ApiError ? String(e.detail) : String(e)),
    );
  }, [reloadDatasets]);

  useEffect(() => {
    reloadCases().catch((e) =>
      setError(e instanceof ApiError ? String(e.detail) : String(e)),
    );
  }, [reloadCases]);

  async function createDataset() {
    if (!newName.trim()) return;
    try {
      await api.post<Dataset>(`/nodes/${nodeId}/datasets`, { dataset_nm: newName });
      setNewName('');
      await reloadDatasets();
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    }
  }

  async function deleteDataset(id: number) {
    try {
      await api.del(`/datasets/${id}`);
      if (selectedId === id) setSelectedId(null);
      await reloadDatasets();
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    }
  }

  async function deleteCase(caseId: number) {
    if (selectedId === null) return;
    try {
      await api.del(`/datasets/${selectedId}/cases/${caseId}`);
      await reloadCases();
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    }
  }

  async function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || selectedId === null) return;
    setCsvResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<{ created: number; skipped: number; errors: string[] }>(
        `/datasets/${selectedId}/upload`,
        fd,
      );
      setCsvResult(
        `created ${res.created}, skipped ${res.skipped}` +
          (res.errors.length ? ` — ${res.errors.join('; ')}` : ''),
      );
      await reloadCases();
    } catch (err) {
      setError(err instanceof ApiError ? String(err.detail) : String(err));
    }
  }

  return (
    <div className="flex gap-4">
      <aside className="w-64 shrink-0">
        <div className="mb-2 flex gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New dataset name"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            onClick={createDataset}
            className="rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
          >
            Add
          </button>
        </div>
        <ul className="space-y-1">
          {datasets.map((d) => (
            <li
              key={d.dataset_id}
              className={`flex items-center justify-between rounded border px-2 py-1.5 text-sm ${
                d.dataset_id === selectedId
                  ? 'border-slate-900 bg-white'
                  : 'border-slate-200 bg-white hover:bg-slate-100'
              }`}
            >
              <button
                onClick={() => setSelectedId(d.dataset_id)}
                className="flex-1 text-left"
              >
                {d.dataset_nm}
              </button>
              <button
                onClick={() => deleteDataset(d.dataset_id)}
                className="ml-2 text-xs text-red-500 hover:underline"
              >
                del
              </button>
            </li>
          ))}
          {datasets.length === 0 && (
            <li className="text-xs text-slate-500">No datasets yet.</li>
          )}
        </ul>
      </aside>

      <section className="flex-1">
        {error && (
          <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {selectedId === null ? (
          <div className="text-sm text-slate-500">Select a dataset.</div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => {
                  setEditCase(null);
                  setShowCase(true);
                }}
                className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-800"
              >
                + Add case
              </button>
              <label className="cursor-pointer rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
                Upload CSV
                <input type="file" accept=".csv" onChange={onCsv} className="hidden" />
              </label>
              {csvResult && (
                <span className="text-xs text-slate-600">{csvResult}</span>
              )}
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Input</th>
                  <th className="py-1 pr-2">Expected</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.case_id} className="border-b border-slate-100 align-top">
                    <td className="py-1 pr-2">{c.case_nm || '-'}</td>
                    <td className="py-1 pr-2 font-mono whitespace-pre-wrap break-words">
                      {c.input_data}
                    </td>
                    <td className="py-1 pr-2 whitespace-pre-wrap break-words">
                      {c.expected_output || '-'}
                    </td>
                    <td className="py-1 pr-2">{c.case_type}</td>
                    <td className="py-1 text-right">
                      <button
                        onClick={() => {
                          setEditCase(c);
                          setShowCase(true);
                        }}
                        className="text-xs text-slate-600 hover:underline"
                      >
                        edit
                      </button>
                      <button
                        onClick={() => deleteCase(c.case_id)}
                        className="ml-2 text-xs text-red-500 hover:underline"
                      >
                        del
                      </button>
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-2 text-xs text-slate-500">
                      No cases.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </section>

      {showCase && selectedId !== null && (
        <CaseModal
          datasetId={selectedId}
          existing={editCase}
          onClose={() => setShowCase(false)}
          onSaved={async () => {
            setShowCase(false);
            await reloadCases();
          }}
        />
      )}
    </div>
  );
}

function CaseModal({
  datasetId,
  existing,
  onClose,
  onSaved,
}: {
  datasetId: number;
  existing: TestCase | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [caseNm, setCaseNm] = useState(existing?.case_nm ?? '');
  const [inputData, setInputData] = useState(existing?.input_data ?? '');
  const [expected, setExpected] = useState(existing?.expected_output ?? '');
  const [evalCriteria, setEvalCriteria] = useState(existing?.eval_criteria ?? '');
  const [caseType, setCaseType] = useState(existing?.case_type ?? 'NORMAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!inputData.trim()) {
      setError('Input data is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CaseCreate = {
        case_nm: caseNm || null,
        input_data: inputData,
        expected_output: expected || null,
        eval_criteria: evalCriteria || null,
        case_type: caseType,
      };
      if (existing) {
        await api.put(`/datasets/${datasetId}/cases/${existing.case_id}`, body);
      } else {
        await api.post(`/datasets/${datasetId}/cases`, body);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={existing ? 'Edit case' : 'New case'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <label>
            <div className="text-xs text-slate-500">Case name</div>
            <input
              value={caseNm}
              onChange={(e) => setCaseNm(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label>
            <div className="text-xs text-slate-500">Case type</div>
            <input
              value={caseType}
              onChange={(e) => setCaseType(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1"
            />
          </label>
        </div>
        <label className="block">
          <div className="text-xs text-slate-500">Input data (JSON) *</div>
          <textarea
            value={inputData}
            onChange={(e) => setInputData(e.target.value)}
            rows={3}
            className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
          />
        </label>
        <label className="block">
          <div className="text-xs text-slate-500">Expected output</div>
          <textarea
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            rows={2}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="block">
          <div className="text-xs text-slate-500">Eval criteria</div>
          <textarea
            value={evalCriteria}
            onChange={(e) => setEvalCriteria(e.target.value)}
            rows={2}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    </Modal>
  );
}

// ---- shared loader ----

function usePromptsAndDatasets(nodeId: number) {
  const [prompts, setPrompts] = useState<PromptVersionSummary[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<PromptVersionSummary[]>(`/nodes/${nodeId}/prompts`)
      .then(setPrompts)
      .catch((e) => setError(e instanceof ApiError ? String(e.detail) : String(e)));
    api
      .get<Dataset[]>(`/nodes/${nodeId}/datasets`)
      .then(setDatasets)
      .catch((e) => setError(e instanceof ApiError ? String(e.detail) : String(e)));
  }, [nodeId]);
  return { prompts, datasets, error, setError };
}

const SELECT_CLS = 'w-full rounded border border-slate-300 px-2 py-1';

// ---- Batch tab (F-31) ----

function BatchPanel({ nodeId }: { nodeId: number }) {
  const { prompts, datasets, error, setError } = usePromptsAndDatasets(nodeId);
  const [promptId, setPromptId] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [detail, setDetail] = useState<TestRunDetail | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (promptId === null && prompts.length) {
      setPromptId((prompts.find((p) => p.is_active === 'Y') || prompts[0]).prompt_id);
    }
    if (datasetId === null && datasets.length) setDatasetId(datasets[0].dataset_id);
  }, [prompts, datasets, promptId, datasetId]);
  useEffect(() => () => wsRef.current?.close(), []);

  async function run() {
    if (promptId === null || datasetId === null) return;
    setStatus('running');
    setProgress(null);
    setDetail(null);
    setError(null);
    wsRef.current?.close();
    try {
      const out = await api.post<TestRunOut>(`/nodes/${nodeId}/test/batch`, {
        prompt_id: promptId,
        dataset_id: datasetId,
      });
      const finish = async () => {
        try {
          setDetail(await api.get<TestRunDetail>(`/test-runs/${out.run_id}`));
        } catch {
          /* ignore */
        }
      };
      const ws = connectTestRunWs(out.run_id, {
        onMessage: (msg) => {
          if (msg.event === 'PROGRESS') {
            setProgress({ done: msg.done, total: msg.total });
          } else if (msg.event === 'DONE') {
            setStatus('done');
            ws.close();
            void finish();
          } else if (msg.event === 'FAILED') {
            setError(msg.error);
            setStatus('failed');
            ws.close();
            void finish();
          }
        },
        onClose: () => setStatus((s) => (s === 'running' ? 'failed' : s)),
      });
      wsRef.current = ws;
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
      setStatus('failed');
    }
  }

  const pct =
    progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="grid max-w-4xl gap-4">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>
          <div className="text-xs text-slate-500">Prompt version</div>
          <select
            value={promptId ?? ''}
            onChange={(e) => setPromptId(Number(e.target.value))}
            className={SELECT_CLS}
          >
            {prompts.map((p) => (
              <option key={p.prompt_id} value={p.prompt_id}>
                v{p.version_no} {p.is_active === 'Y' ? '(active)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="text-xs text-slate-500">Dataset</div>
          <select
            value={datasetId ?? ''}
            onChange={(e) => setDatasetId(Number(e.target.value))}
            className={SELECT_CLS}
          >
            {datasets.map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {d.dataset_nm}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={status === 'running' || promptId === null || datasetId === null}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {status === 'running' ? 'Running…' : 'Run batch'}
        </button>
        <span className="text-xs text-slate-500">status: {status}</span>
      </div>
      {progress && (
        <div>
          <div className="mb-1 text-xs text-slate-500">
            {progress.done}/{progress.total}
          </div>
          <div className="h-2 w-full rounded bg-slate-100">
            <div className="h-2 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {detail && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>total {detail.total_cases}</span>
            <span className="text-emerald-700">passed {detail.passed_cases}</span>
            <span className="text-red-700">failed {detail.failed_cases}</span>
            <span>avg {detail.avg_latency_ms ?? '-'} ms</span>
            <span>{detail.total_tokens ?? 0} tok</span>
            <a
              href={`${EXPORT_BASE}/test-runs/${detail.run_id}/export?fmt=csv`}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
            >
              CSV
            </a>
            <a
              href={`${EXPORT_BASE}/test-runs/${detail.run_id}/export?fmt=xlsx`}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
            >
              Excel
            </a>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-2">Case</th>
                <th className="py-1 pr-2">Pass</th>
                <th className="py-1 pr-2">Latency</th>
                <th className="py-1 pr-2">Output</th>
              </tr>
            </thead>
            <tbody>
              {detail.results.map((r) => (
                <tr key={r.result_id} className="border-b border-slate-100 align-top">
                  <td className="py-1 pr-2">#{r.case_id}</td>
                  <td className="py-1 pr-2">
                    {r.is_passed === 'Y' ? '✅' : r.is_passed === 'N' ? '❌' : '–'}
                  </td>
                  <td className="py-1 pr-2">{r.latency_ms ?? '-'} ms</td>
                  <td className="max-w-[420px] truncate py-1 pr-2 font-mono">
                    {r.error_msg ? `ERR: ${r.error_msg}` : r.actual_output}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- A/B tab (F-32) ----

function ABPanel({ nodeId }: { nodeId: number }) {
  const { prompts, datasets, error, setError } = usePromptsAndDatasets(nodeId);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [runs, setRuns] = useState<{ a?: TestRunDetail; b?: TestRunDetail }>({});
  const wsRefs = useRef<WebSocket[]>([]);

  useEffect(() => {
    if (prompts.length) {
      if (a === null) setA(prompts[0].prompt_id);
      if (b === null) setB(prompts[Math.min(1, prompts.length - 1)].prompt_id);
    }
    if (datasetId === null && datasets.length) setDatasetId(datasets[0].dataset_id);
  }, [prompts, datasets, a, b, datasetId]);
  useEffect(() => () => wsRefs.current.forEach((w) => w.close()), []);

  async function run() {
    if (a === null || b === null || datasetId === null) return;
    setStatus('running');
    setRuns({});
    setError(null);
    wsRefs.current.forEach((w) => w.close());
    try {
      const out = await api.post<ABRunOut>(`/nodes/${nodeId}/test/ab`, {
        prompt_id_a: a,
        prompt_id_b: b,
        dataset_id: datasetId,
      });
      const done = { a: false, b: false };
      const settle = (key: 'a' | 'b', runId: number) =>
        api
          .get<TestRunDetail>(`/test-runs/${runId}`)
          .then((d) => setRuns((prev) => ({ ...prev, [key]: d })))
          .catch(() => undefined)
          .finally(() => {
            done[key] = true;
            if (done.a && done.b) setStatus('done');
          });
      const open = (key: 'a' | 'b', runId: number) =>
        connectTestRunWs(runId, {
          onMessage: (msg) => {
            if (msg.event === 'DONE' || msg.event === 'FAILED') {
              void settle(key, runId);
            }
          },
        });
      wsRefs.current = [open('a', out.run_a_id), open('b', out.run_b_id)];
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
      setStatus('failed');
    }
  }

  const card = (title: string, d?: TestRunDetail) => (
    <div className="rounded border border-slate-200 bg-white p-3 text-sm">
      <div className="mb-1 font-semibold">{title}</div>
      {d ? (
        <ul className="space-y-0.5 text-xs">
          <li>status: {d.status}</li>
          <li>total: {d.total_cases}</li>
          <li className="text-emerald-700">passed: {d.passed_cases}</li>
          <li className="text-red-700">failed: {d.failed_cases}</li>
          <li>avg latency: {d.avg_latency_ms ?? '-'} ms</li>
          <li>tokens: {d.total_tokens ?? 0}</li>
        </ul>
      ) : (
        <div className="text-xs text-slate-500">running…</div>
      )}
    </div>
  );

  return (
    <div className="grid max-w-3xl gap-4">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <label>
          <div className="text-xs text-slate-500">Prompt A</div>
          <select value={a ?? ''} onChange={(e) => setA(Number(e.target.value))} className={SELECT_CLS}>
            {prompts.map((p) => (
              <option key={p.prompt_id} value={p.prompt_id}>
                v{p.version_no}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="text-xs text-slate-500">Prompt B</div>
          <select value={b ?? ''} onChange={(e) => setB(Number(e.target.value))} className={SELECT_CLS}>
            {prompts.map((p) => (
              <option key={p.prompt_id} value={p.prompt_id}>
                v{p.version_no}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="text-xs text-slate-500">Dataset</div>
          <select
            value={datasetId ?? ''}
            onChange={(e) => setDatasetId(Number(e.target.value))}
            className={SELECT_CLS}
          >
            {datasets.map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {d.dataset_nm}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={status === 'running' || a === null || b === null || datasetId === null}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {status === 'running' ? 'Running…' : 'Run A/B'}
        </button>
        <span className="text-xs text-slate-500">status: {status}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {card('A', runs.a)}
        {card('B', runs.b)}
      </div>
    </div>
  );
}
