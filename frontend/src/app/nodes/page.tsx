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
    router.push(`/nodes/${encodeURIComponent(node.node_nm)}/prompts`);
  }

  const nodes = flow?.nodes ?? [];

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <main className="flex-1 overflow-auto px-6 py-5">
        <div>
          {error && (
            <div className="mb-4 rounded-lg border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</div>
          )}
          <div className="mb-5">
            <h1 className="text-lg font-semibold text-ink">
              프롬프트 노드 <span className="text-muted">({nodes.length})</span>
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              노드를 선택해 시스템·유저 프롬프트와 모델 버전을 관리하세요.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nodes.map((n) => (
              <li key={n.node_nm}>
                <button
                  onClick={() => openNode(n)}
                  className="group flex w-full flex-col rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent/5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{n.node_nm}</span>
                    <Badge tone="accent">v{n.active_version_no ?? '—'}</Badge>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-muted">{n.active_model_nm ?? '모델 미지정'}</p>
                  <span className="mt-3 text-xs font-medium text-muted transition-colors group-hover:text-accent">
                    프롬프트 관리 →
                  </span>
                </button>
              </li>
            ))}
            {flow && nodes.length === 0 && (
              <li className="text-sm text-muted">노드가 없습니다. 첫 프롬프트 버전을 만들어 노드를 추가하세요.</li>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
}
