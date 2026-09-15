'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/ui/AppShell';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { ModelSelect } from '@/components/ui/ModelSelect';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import type { FlowCurrent, FlowNode, PromptVersionDetail } from '@/lib/types';
import { TrashIcon } from '@/components/ragas/shared';

export default function NodesPage() {
  const router = useRouter();
  const [flow, setFlow] = useState<FlowCurrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FlowNode | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFlow = useCallback(async () => {
    try {
      setFlow(await api.get<FlowCurrent>('/flow/current'));
    } catch (e) {
      setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    }
  }, []);

  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  function openNode(node: FlowNode) {
    router.push(`/nodes/${encodeURIComponent(node.node_nm)}/prompts`);
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.del(`/nodes/${encodeURIComponent(confirmDelete.node_nm)}`);
      setConfirmDelete(null);
      await loadFlow();
    } catch (e) {
      setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  const nodes = flow?.nodes ?? [];

  return (
    <AppShell section="prompts">
      <div className="flex h-full flex-col">
        <div className={cn(SHELL, 'px-8 py-7')}>
          {error && (
            <div className="mb-4 rounded-sm border border-bad-line bg-bad-soft px-4 py-3 text-sm text-bad">{error}</div>
          )}
          <PageHeader
            title={<>프롬프트 <span className="text-muted-soft">{nodes.length}</span></>}
            right={<Button onClick={() => setShowNew(true)}>+ 노드</Button>}
          />
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {nodes.map((n) => (
              <li key={n.node_nm} className="group relative">
                <button
                  onClick={() => openNode(n)}
                  className="flex w-full flex-col rounded-md border border-line bg-surface px-4 py-3.5 text-left shadow-card transition-all hover:border-accent hover:shadow-lift"
                >
                  <div className="flex items-center gap-2 pr-16">
                    <span className="truncate text-display-xs text-ink">{n.node_nm}</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-caption-mono text-muted">{n.latest_model_nm ?? '—'}</p>
                </button>
                {/* 버전은 늘 보이고, 삭제는 가져다 댈 때만 그 자리에 선다 — 늘 서 있는
                    삭제 버튼은 카드마다 가장 먼저 눈에 걸리는 것이 된다. */}
                <div className="absolute right-3 top-3 flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(n);
                    }}
                    title="노드 삭제"
                    aria-label="노드 삭제"
                    className="hidden rounded-sm p-1 text-muted transition-colors hover:bg-bad-soft hover:text-bad group-hover:inline-flex group-focus-within:inline-flex"
                  >
                    <TrashIcon />
                  </button>
                  <Badge tone="accent">v{n.latest_version_no ?? '—'}</Badge>
                </div>
              </li>
            ))}
            {flow && nodes.length === 0 && <li className="text-body-sm text-muted-soft">—</li>}
          </ul>
        </div>
      </div>

      {showNew && (
        <NewNodeModal
          existing={nodes.map((n) => n.node_nm)}
          onClose={() => setShowNew(false)}
          onCreated={(nodeNm) => router.push(`/nodes/${encodeURIComponent(nodeNm)}/prompts`)}
        />
      )}

      <Modal
        open={!!confirmDelete}
        title="노드 삭제"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>취소</Button>
            <Button variant="danger" onClick={doDelete} disabled={busy}>삭제</Button>
          </>
        }
      >
        <p className="text-body-md text-ink">
          <span className="font-mono">{confirmDelete?.node_nm}</span> · 전체 버전 삭제
        </p>
      </Modal>
    </AppShell>
  );
}

function NewNodeModal({
  existing,
  onClose,
  onCreated,
}: {
  existing: string[];
  onClose: () => void;
  onCreated: (nodeNm: string) => void;
}) {
  const [nodeNm, setNodeNm] = useState('');
  const [system, setSystem] = useState('');
  const [user, setUser] = useState('');
  const [model, setModel] = useState('');
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const duplicate = useMemo(
    () => existing.includes(nodeNm.trim()),
    [existing, nodeNm],
  );
  const valid = useMemo(
    () => nodeNm.trim() && !duplicate && (system.trim() || user.trim()) && summary.trim() && reason.trim(),
    [nodeNm, duplicate, system, user, summary, reason],
  );

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.post<PromptVersionDetail>('/nodes', {
        node_nm: nodeNm.trim(),
        system_prompt: system,
        user_prompt: user,
        model_nm: model.trim() || null,
        change_summary: summary,
        change_reason: reason,
      });
      onCreated(nodeNm.trim());
    } catch (e) {
      setErr(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="새 노드"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={!valid || busy}>만들기</Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-sm border border-bad-line bg-bad-soft px-3 py-2 text-xs text-bad">{err}</div>}
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">노드 이름 (NODE_NM) *</span>
        <Input value={nodeNm} onChange={(e) => setNodeNm(e.target.value)} placeholder="router" className="mt-1 w-full font-mono" />
        {duplicate && <span className="mt-1 block text-xs text-bad">이미 있는 노드 이름입니다</span>}
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">Model</span>
        <ModelSelect value={model} onChange={setModel} className="mt-1 w-full" />
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">System prompt</span>
        <Textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={7} className="mt-1 w-full font-mono" />
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">
          User prompt
        </span>
        <Textarea value={user} onChange={(e) => setUser(e.target.value)} rows={6} placeholder={'{{name}}'} className="mt-1 w-full font-mono" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-ink">변경 요약 *</span>
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-1 w-full" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">변경 사유 *</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full" />
        </label>
      </div>
    </Modal>
  );
}
