'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import TopBar from '@/components/ui/TopBar';
import { api, ApiError } from '@/lib/api';
import { connectRagasRunWs } from '@/lib/ws';
import {
  RAGAS_METRICS,
  type Dataset,
  type PromptVersionSummary,
  type RagasMetric,
  type RagasRunDetail,
  type RagasRunOut,
  type RagasRunSummary,
} from '@/types';

const EXPORT_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

type Tab = 'setup' | 'result' | 'history';
type RunStatus = 'idle' | 'running' | 'done' | 'failed';

const SELECT_CLS = 'w-full rounded border border-slate-300 px-2 py-1';
const METRIC_LABEL: Record<RagasMetric, string> = {
  faithfulness: 'Faithfulness',
  answer_relevancy: 'Answer Relevancy',
  context_precision: 'Context Precision',
  context_recall: 'Context Recall',
  answer_correctness: 'Answer Correctness',
};

export default function RagasPage() {
  const params = useParams<{ projectId: string; nodeId: string }>();
  const router = useRouter();
  const projectId = Number(params.projectId);
  const nodeId = Number(params.nodeId);
  const [tab, setTab] = useState<Tab>('setup');
  const [lastRunId, setLastRunId] = useState<number | null>(null);

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        title={`Node #${nodeId} — RAGAS`}
        right={
          <div className="flex gap-2">
            <NavBtn label="Graph" onClick={() => router.push(`/projects/${projectId}/graph`)} />
            <NavBtn
              label="Test"
              onClick={() => router.push(`/projects/${projectId}/nodes/${nodeId}/test`)}
            />
          </div>
        }
      />
      <div className="border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex gap-2 text-sm">
          {(['setup', 'result', 'history'] as const).map((t) => (
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
        {tab === 'setup' && (
          <SetupPanel
            nodeId={nodeId}
            onDone={(rid) => {
              setLastRunId(rid);
              setTab('result');
            }}
          />
        )}
        {tab === 'result' && <ResultPanel runId={lastRunId} />}
        {tab === 'history' && (
          <HistoryPanel
            nodeId={nodeId}
            onOpen={(rid) => {
              setLastRunId(rid);
              setTab('result');
            }}
          />
        )}
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

// ---- Setup / run (F-50 / F-51) ----

function SetupPanel({
  nodeId,
  onDone,
}: {
  nodeId: number;
  onDone: (runId: number) => void;
}) {
  const [prompts, setPrompts] = useState<PromptVersionSummary[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [promptId, setPromptId] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [judgeProvider, setJudgeProvider] = useState('');
  const [judgeModel, setJudgeModel] = useState('');
  const [metrics, setMetrics] = useState<RagasMetric[]>([...RAGAS_METRICS]);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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
    api
      .get<Dataset[]>(`/nodes/${nodeId}/datasets`)
      .then((rows) => {
        setDatasets(rows);
        if (rows.length) setDatasetId(rows[0].dataset_id);
      })
      .catch((e) => setError(e instanceof ApiError ? String(e.detail) : String(e)));
  }, [nodeId]);

  useEffect(() => () => wsRef.current?.close(), []);

  const toggleMetric = (m: RagasMetric) =>
    setMetrics((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );

  const run = useCallback(async () => {
    if (promptId === null || datasetId === null || metrics.length === 0) return;
    setStatus('running');
    setProgress(null);
    setError(null);
    wsRef.current?.close();
    try {
      const out = await api.post<RagasRunOut>(`/nodes/${nodeId}/ragas/run`, {
        prompt_id: promptId,
        dataset_id: datasetId,
        metrics,
        judge_provider: judgeProvider || null,
        judge_model: judgeModel || null,
      });
      const ws = connectRagasRunWs(out.ragas_run_id, {
        onMessage: (msg) => {
          if (msg.event === 'PROGRESS') {
            setProgress({ done: msg.done, total: msg.total });
          } else if (msg.event === 'DONE') {
            setStatus('done');
            ws.close();
            onDone(out.ragas_run_id);
          } else if (msg.event === 'FAILED') {
            setError(msg.error);
            setStatus('failed');
            ws.close();
          }
        },
        onClose: () => setStatus((s) => (s === 'running' ? 'failed' : s)),
      });
      wsRef.current = ws;
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
      setStatus('failed');
    }
  }, [nodeId, promptId, datasetId, metrics, judgeProvider, judgeModel, onDone]);

  const pct =
    progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

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
        <label>
          <div className="text-xs text-slate-500">Judge provider (optional)</div>
          <input
            value={judgeProvider}
            onChange={(e) => setJudgeProvider(e.target.value)}
            placeholder="openai / anthropic / google"
            className={SELECT_CLS}
          />
        </label>
        <label>
          <div className="text-xs text-slate-500">Judge model (optional)</div>
          <input
            value={judgeModel}
            onChange={(e) => setJudgeModel(e.target.value)}
            className={SELECT_CLS}
          />
        </label>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold text-slate-500">Metrics</div>
        <div className="flex flex-wrap gap-3 text-sm">
          {RAGAS_METRICS.map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={metrics.includes(m)}
                onChange={() => toggleMetric(m)}
              />
              {METRIC_LABEL[m]}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={
            status === 'running' ||
            promptId === null ||
            datasetId === null ||
            metrics.length === 0
          }
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {status === 'running' ? 'Evaluating…' : 'Start evaluation'}
        </button>
        <span className="text-xs text-slate-500">status: {status}</span>
      </div>
      {progress && (
        <div>
          <div className="mb-1 text-xs text-slate-500">
            {progress.done}/{progress.total}
          </div>
          <div className="h-2 w-full rounded bg-slate-100">
            <div className="h-2 rounded bg-indigo-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Tip: cases use JSON input with keys{' '}
        <code>{'{ question, contexts: [], ground_truth }'}</code>. ground_truth falls back
        to the case&apos;s expected output.
      </p>
    </div>
  );
}

// ---- Result (F-52) ----

function num(v: number | null | undefined): number | null {
  return v == null ? null : Number(v);
}

function ResultPanel({ runId }: { runId: number | null }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);

  useEffect(() => {
    if (runId === null) return;
    api
      .get<RagasRunDetail>(`/ragas-runs/${runId}`)
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? String(e.detail) : String(e)));
  }, [runId]);

  if (runId === null)
    return <div className="text-sm text-slate-500">Run an evaluation first.</div>;
  if (error)
    return <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!detail) return <div className="text-sm text-slate-500">Loading…</div>;

  const chartData = RAGAS_METRICS.filter((m) => num(detail[m]) !== null).map((m) => ({
    metric: METRIC_LABEL[m],
    score: num(detail[m]) ?? 0,
  }));

  const rows = detail.results.filter((r) =>
    lowOnly ? (num(r.faithfulness) ?? 1) < 0.5 : true,
  );

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>
          status: <b>{detail.status}</b>
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">
          engine: {detail.engine ?? '-'}
        </span>
        <a
          href={`${EXPORT_BASE}/ragas-runs/${runId}/export?fmt=csv`}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        >
          CSV
        </a>
        <a
          href={`${EXPORT_BASE}/ragas-runs/${runId}/export?fmt=xlsx`}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        >
          Excel
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-64 rounded border border-slate-200 bg-white p-3">
          <div className="mb-1 text-xs font-semibold text-slate-500">Average (radar)</div>
          <ResponsiveContainer width="100%" height="90%">
            <RadarChart data={chartData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
              <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="h-64 rounded border border-slate-200 bg-white p-3">
          <div className="mb-1 text-xs font-semibold text-slate-500">Average (bar)</div>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="metric" tick={{ fontSize: 9 }} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="score" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={lowOnly}
          onChange={(e) => setLowOnly(e.target.checked)}
        />
        Show only low-faithfulness cases (&lt; 0.5)
      </label>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2">Case</th>
            {RAGAS_METRICS.map((m) => (
              <th key={m} className="py-1 pr-2">
                {METRIC_LABEL[m]}
              </th>
            ))}
            <th className="py-1 pr-2">Answer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ragas_result_id} className="border-b border-slate-100 align-top">
              <td className="py-1 pr-2">#{r.case_id}</td>
              {RAGAS_METRICS.map((m) => {
                const v = num(r[m]);
                return (
                  <td key={m} className="py-1 pr-2">
                    {v == null ? '–' : v.toFixed(3)}
                  </td>
                );
              })}
              <td className="max-w-[320px] truncate py-1 pr-2 font-mono text-xs">
                {r.error_msg ? `ERR: ${r.error_msg}` : r.answer}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={RAGAS_METRICS.length + 2} className="py-2 text-xs text-slate-500">
                No cases.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- History + trend (F-52 / F-53) ----

function HistoryPanel({
  nodeId,
  onOpen,
}: {
  nodeId: number;
  onOpen: (runId: number) => void;
}) {
  const [runs, setRuns] = useState<RagasRunSummary[] | null>(null);

  useEffect(() => {
    api.get<RagasRunSummary[]>(`/nodes/${nodeId}/ragas-runs`).then(setRuns);
  }, [nodeId]);

  if (runs === null) return <div className="text-sm text-slate-500">Loading…</div>;
  if (runs.length === 0)
    return <div className="text-sm text-slate-500">No RAGAS runs yet.</div>;

  const trend = runs.map((r) => ({
    run: `#${r.ragas_run_id}`,
    ...Object.fromEntries(RAGAS_METRICS.map((m) => [m, num(r[m]) ?? null])),
  }));
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="h-72 rounded border border-slate-200 bg-white p-3">
        <div className="mb-1 text-xs font-semibold text-slate-500">
          Metric trend across runs
        </div>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="run" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {RAGAS_METRICS.map((m, i) => (
              <Line
                key={m}
                type="monotone"
                dataKey={m}
                stroke={colors[i]}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2">Run</th>
            <th className="py-1 pr-2">Prompt</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1 pr-2">Engine</th>
            {RAGAS_METRICS.map((m) => (
              <th key={m} className="py-1 pr-2">
                {METRIC_LABEL[m]}
              </th>
            ))}
            <th className="py-1 pr-2">When</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.ragas_run_id}
              onClick={() => onOpen(r.ragas_run_id)}
              className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
            >
              <td className="py-1 pr-2">#{r.ragas_run_id}</td>
              <td className="py-1 pr-2">#{r.prompt_id}</td>
              <td className="py-1 pr-2">{r.status}</td>
              <td className="py-1 pr-2">{r.engine ?? '-'}</td>
              {RAGAS_METRICS.map((m) => {
                const v = num(r[m]);
                return (
                  <td key={m} className="py-1 pr-2">
                    {v == null ? '–' : v.toFixed(3)}
                  </td>
                );
              })}
              <td className="py-1 pr-2 text-xs text-slate-400">
                {new Date(r.created_dt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
