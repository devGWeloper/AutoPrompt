'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AuditLog } from '@/types';

export default function HistoryList({ nodeId }: { nodeId: number }) {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);

  useEffect(() => {
    api.get<AuditLog[]>(`/nodes/${nodeId}/audit-logs?limit=100`).then(setLogs);
  }, [nodeId]);

  if (logs === null) return <div className="text-sm text-slate-500">Loading...</div>;
  if (logs.length === 0) return <div className="text-sm text-slate-500">No history yet.</div>;

  return (
    <ol className="space-y-2">
      {logs.map((l) => (
        <li key={l.log_id} className="rounded border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
              {l.action}
            </span>
            <span className="font-mono text-xs text-slate-500">
              {l.target_table} #{l.target_id}
            </span>
            <span className="ml-auto text-xs text-slate-400">
              {new Date(l.created_dt).toLocaleString()} · {l.created_by}
            </span>
          </div>
          {l.before_value && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-slate-500">before</summary>
              <pre className="overflow-auto rounded bg-slate-50 p-2 text-[11px]">{l.before_value}</pre>
            </details>
          )}
          {l.after_value && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-slate-500">after</summary>
              <pre className="overflow-auto rounded bg-slate-50 p-2 text-[11px]">{l.after_value}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
