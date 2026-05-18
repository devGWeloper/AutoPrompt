'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { PromptVariable } from '@/types';

export default function VariablePanel({
  promptId,
  detected,
  initial,
  editable,
}: {
  promptId: number;
  detected: string[];
  initial: PromptVariable[];
  editable: boolean;
}) {
  const [rows, setRows] = useState<PromptVariable[]>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Merge detected names with existing rows, preserving metadata when possible.
    const byName = new Map(rows.map((r) => [r.var_name, r]));
    const merged: PromptVariable[] = detected.map(
      (name) =>
        byName.get(name) ?? {
          var_name: name,
          var_type: 'STRING',
          description: null,
          default_value: null,
          is_required: 'Y' as const,
        },
    );
    setRows(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected.join('|')]);

  function update(idx: number, patch: Partial<PromptVariable>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/prompts/${promptId}/variables`, { variables: rows });
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return <div className="text-sm text-slate-500">No variables detected.</div>;
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1">Name</th>
            <th className="py-1">Type</th>
            <th className="py-1">Description</th>
            <th className="py-1">Default</th>
            <th className="py-1">Required</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.var_name} className="border-t border-slate-100">
              <td className="py-1 font-mono">{r.var_name}</td>
              <td className="py-1">
                <select
                  className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={r.var_type}
                  disabled={!editable}
                  onChange={(e) => update(i, { var_type: e.target.value })}
                >
                  <option>STRING</option>
                  <option>NUMBER</option>
                  <option>JSON</option>
                </select>
              </td>
              <td className="py-1">
                <input
                  className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={r.description ?? ''}
                  disabled={!editable}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
              </td>
              <td className="py-1">
                <input
                  className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={r.default_value ?? ''}
                  disabled={!editable}
                  onChange={(e) => update(i, { default_value: e.target.value })}
                />
              </td>
              <td className="py-1 text-center">
                <input
                  type="checkbox"
                  checked={r.is_required === 'Y'}
                  disabled={!editable}
                  onChange={(e) => update(i, { is_required: e.target.checked ? 'Y' : 'N' })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button
          onClick={save}
          disabled={saving}
          className="mt-3 rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save variables'}
        </button>
      )}
    </div>
  );
}
