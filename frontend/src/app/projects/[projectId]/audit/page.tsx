'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import TopBar from '@/components/ui/TopBar';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import type { AuditLog, AuditLogPage } from '@/types';

const ReactDiffViewer = dynamic(() => import('react-diff-viewer-continued'), {
  ssr: false,
});

const ACTIONS = ['', 'CREATE', 'UPDATE', 'DELETE', 'ACTIVATE'];
const PAGE_SIZE = 20;

function pretty(v: string | null): string {
  if (!v) return '';
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return v;
  }
}

export default function AuditDashboardPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = Number(params.projectId);

  const [targetTable, setTargetTable] = useState('');
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<AuditLogPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
    if (targetTable) qs.set('target_table', targetTable);
    if (user) qs.set('user', user);
    if (action) qs.set('action', action);
    if (dateFrom) qs.set('date_from', new Date(dateFrom).toISOString());
    if (dateTo) qs.set('date_to', new Date(dateTo).toISOString());
    try {
      setData(await api.get<AuditLogPage>(`/audit-logs?${qs.toString()}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    }
  }, [page, targetTable, user, action, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        title={`Project #${projectId} — 변경 이력`}
        right={
          <button
            onClick={() => router.push(`/projects/${projectId}/graph`)}
            className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
          >
            Graph
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
          <Field label="Target table">
            <input
              value={targetTable}
              onChange={(e) => setTargetTable(e.target.value)}
              placeholder="PM_PROMPT_VERSION"
              className="rounded border border-slate-300 px-2 py-1"
            />
          </Field>
          <Field label="User">
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </Field>
          <Field label="Action">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a || 'all'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </Field>
          <button
            onClick={() => {
              setPage(1);
              load();
            }}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800"
          >
            Filter
          </button>
        </div>

        {error && (
          <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Action</th>
              <th className="py-1 pr-2">Target</th>
              <th className="py-1 pr-2">User</th>
              <th className="py-1 pr-2">When</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((l) => (
              <tr
                key={l.log_id}
                onClick={() => setSelected(l)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="py-1 pr-2">{l.log_id}</td>
                <td className="py-1 pr-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {l.action}
                  </span>
                </td>
                <td className="py-1 pr-2 font-mono text-xs">
                  {l.target_table} #{l.target_id}
                </td>
                <td className="py-1 pr-2">{l.created_by}</td>
                <td className="py-1 pr-2 text-xs text-slate-400">
                  {new Date(l.created_dt).toLocaleString()}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-xs text-slate-500">
                  No audit entries match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            page {data?.page ?? page} / {totalPages} · {data?.total ?? 0} total
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {selected && (
        <Modal
          open
          title={`#${selected.log_id} · ${selected.action} · ${selected.target_table} #${selected.target_id}`}
          onClose={() => setSelected(null)}
        >
          <ReactDiffViewer
            oldValue={pretty(selected.before_value)}
            newValue={pretty(selected.after_value)}
            splitView
            hideLineNumbers={false}
          />
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase text-slate-400">{label}</span>
      {children}
    </label>
  );
}
