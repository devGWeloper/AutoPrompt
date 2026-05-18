'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import type { PromptDiff, PromptVersionSummary } from '@/types';

const ReactDiffViewer = dynamic(() => import('react-diff-viewer-continued'), { ssr: false });

export default function DiffViewer({
  versions,
  defaultV1,
  defaultV2,
}: {
  versions: PromptVersionSummary[];
  defaultV1: number | null;
  defaultV2: number | null;
}) {
  const [v1, setV1] = useState<number | null>(defaultV1);
  const [v2, setV2] = useState<number | null>(defaultV2);
  const [v1Text, setV1Text] = useState<{ system: string; user: string }>({ system: '', user: '' });
  const [v2Text, setV2Text] = useState<{ system: string; user: string }>({ system: '', user: '' });
  const [stats, setStats] = useState<PromptDiff | null>(null);

  useEffect(() => {
    if (!v1 || !v2 || v1 === v2) return;
    Promise.all([
      api.get<{ system_prompt: string | null; user_prompt: string | null }>(`/prompts/${v1}`),
      api.get<{ system_prompt: string | null; user_prompt: string | null }>(`/prompts/${v2}`),
      api.get<PromptDiff>(`/prompts/diff?v1=${v1}&v2=${v2}`),
    ]).then(([a, b, d]) => {
      setV1Text({ system: a.system_prompt ?? '', user: a.user_prompt ?? '' });
      setV2Text({ system: b.system_prompt ?? '', user: b.user_prompt ?? '' });
      setStats(d);
    });
  }, [v1, v2]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <label>
          v1:&nbsp;
          <select
            value={v1 ?? ''}
            onChange={(e) => setV1(Number(e.target.value))}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="">-</option>
            {versions.map((v) => (
              <option key={v.prompt_id} value={v.prompt_id}>
                v{v.version_no}
              </option>
            ))}
          </select>
        </label>
        <label>
          v2:&nbsp;
          <select
            value={v2 ?? ''}
            onChange={(e) => setV2(Number(e.target.value))}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="">-</option>
            {versions.map((v) => (
              <option key={v.prompt_id} value={v.prompt_id}>
                v{v.version_no}
              </option>
            ))}
          </select>
        </label>
        {stats && (
          <span className="text-xs text-slate-500">
            system: +{stats.system_prompt.added} / -{stats.system_prompt.removed} &nbsp;|&nbsp;
            user: +{stats.user_prompt.added} / -{stats.user_prompt.removed}
          </span>
        )}
      </div>
      {v1 && v2 && v1 !== v2 ? (
        <>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">System Prompt</div>
            <ReactDiffViewer
              oldValue={v1Text.system}
              newValue={v2Text.system}
              splitView
              hideLineNumbers={false}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">User Prompt</div>
            <ReactDiffViewer
              oldValue={v1Text.user}
              newValue={v2Text.user}
              splitView
              hideLineNumbers={false}
            />
          </div>
        </>
      ) : (
        <div className="text-sm text-slate-500">Select two different versions to compare.</div>
      )}
    </div>
  );
}
