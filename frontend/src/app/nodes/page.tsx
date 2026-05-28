'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/ui/TopBar';
import { Badge } from '@/components/ui/Badge';
import { api, ApiError } from '@/lib/api';
import type { FlowCurrent, FlowNode } from '@/types';

export default function NodesPage() {
  const router = useRouter();
  const [flow, setFlow] = useState<FlowCurrent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<FlowCurrent>('/flow/current')
      .then(setFlow)
      .catch((e) => setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e)));
  }, []);

  function openNode(node: FlowNode) {
    if (!node.has_prompt) return;
    router.push(`/nodes/${node.node_mas_id}/prompts`);
  }

  // Prompt management only concerns LLM/prompt nodes — hide the rest (they have
  // nothing to manage here and just add noise).
  const promptNodes = (flow?.nodes ?? []).filter((n) => n.has_prompt);

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <main className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-7xl">
          {error && (
            <div className="mb-4 rounded-lg border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</div>
          )}
          <div className="mb-5">
            <h1 className="text-lg font-semibold text-ink">
              프롬프트 노드 <span className="text-muted">({promptNodes.length})</span>
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              LLM 프롬프트를 가진 노드만 표시됩니다. 노드를 선택해 시스템·유저 프롬프트 버전을 관리하세요.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {promptNodes.map((n) => (
              <li key={n.node_mas_id}>
                <button
                  onClick={() => openNode(n)}
                  className="group flex w-full flex-col rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent/5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{n.node_nm}</span>
                    <Badge tone="accent">v{n.active_version_no ?? '—'}</Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted">{n.node_desc ?? '설명 없음'}</p>
                  <span className="mt-3 text-xs font-medium text-muted transition-colors group-hover:text-accent">
                    프롬프트 관리 →
                  </span>
                </button>
              </li>
            ))}
            {flow && promptNodes.length === 0 && (
              <li className="text-sm text-muted">프롬프트를 관리할 LLM 노드가 없습니다.</li>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
}
