'use client';

import type { PromptVersionSummary } from '@/types';

export default function VersionList({
  versions,
  selectedId,
  onSelect,
}: {
  versions: PromptVersionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const active = versions.find((v) => v.is_active === 'Y');
  const others = versions.filter((v) => v.is_active !== 'Y');
  return (
    <div className="space-y-2">
      {active && (
        <VersionRow version={active} selected={active.prompt_id === selectedId} onSelect={onSelect} />
      )}
      {others.map((v) => (
        <VersionRow
          key={v.prompt_id}
          version={v}
          selected={v.prompt_id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function VersionRow({
  version,
  selected,
  onSelect,
}: {
  version: PromptVersionSummary;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      onClick={() => onSelect(version.prompt_id)}
      className={`w-full rounded border p-3 text-left transition ${
        selected
          ? 'border-slate-900 bg-slate-50'
          : 'border-slate-200 bg-white hover:border-slate-400'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">v{version.version_no}</span>
        {version.is_active === 'Y' && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            ACTIVE
          </span>
        )}
      </div>
      {version.change_summary && (
        <div className="mt-1 truncate text-xs text-slate-600">{version.change_summary}</div>
      )}
      <div className="mt-1 text-[11px] text-slate-400">
        {version.model_nm} · {new Date(version.created_dt).toLocaleString()}
      </div>
    </button>
  );
}
