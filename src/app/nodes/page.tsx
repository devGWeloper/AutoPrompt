'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar, { PromptsNavChip } from '@/components/ui/TopBar';
import Modal from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import type { FlowCurrent, FlowNode, PromptVersionDetail } from '@/lib/types';

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
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex-1 overflow-auto px-6 py-5">
        <div>
          {error && (
            <div className="mb-4 rounded-sm border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</div>
          )}
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-ink">
                Prompt nodes <span className="text-muted">({nodes.length})</span>
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                노드를 선택해 시스템/유저 프롬프트와 모델 버전을 관리하세요.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PromptsNavChip />
              <Button onClick={() => setShowNew(true)}>+ Add node</Button>
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nodes.map((n) => (
              <li key={n.node_nm} className="group relative">
                <button
                  onClick={() => openNode(n)}
                  className="flex w-full flex-col rounded-md border border-line bg-surface p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
                >
                  <div className="flex items-center gap-2 pr-28">
                    <span className="truncate text-sm font-semibold text-ink">{n.node_nm}</span>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-muted">{n.latest_model_nm ?? 'No model set'}</p>
                  <span className="mt-3 text-xs font-medium text-muted transition-colors group-hover:text-accent">
                    Manage prompts →
                  </span>
                </button>
                <div className="absolute right-3 top-3 flex items-center gap-1.5">
                  <Badge tone="accent">v{n.latest_version_no ?? '—'}</Badge>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(n);
                    }}
                    title="Delete node"
                    className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-bad/40 hover:bg-bad/5 hover:text-bad"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {flow && nodes.length === 0 && (
              <li className="text-sm text-muted">No nodes yet. Use “+ Add node” to create your first one.</li>
            )}
          </ul>
        </div>
      </main>

      {showNew && (
        <NewNodeModal
          existing={nodes.map((n) => n.node_nm)}
          onClose={() => setShowNew(false)}
          onCreated={(nodeNm) => router.push(`/nodes/${encodeURIComponent(nodeNm)}/prompts`)}
        />
      )}

      <Modal
        open={!!confirmDelete}
        title="Delete node"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} disabled={busy}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          <span className="font-semibold">All prompt versions</span> of node <span className="font-semibold">{confirmDelete?.node_nm}</span> will be deleted. This cannot be undone.
        </p>
      </Modal>
    </div>
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
      title="New node"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>Create</Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-md border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">{err}</div>}
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">Node name (NODE_NM) *</span>
        <Input value={nodeNm} onChange={(e) => setNodeNm(e.target.value)} placeholder="e.g. router" className="mt-1 w-full font-mono" />
        {duplicate && <span className="mt-1 block text-xs text-bad">This node name already exists.</span>}
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">Model</span>
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. claude-sonnet-4-6" className="mt-1 w-full font-mono" />
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">System prompt</span>
        <Textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={7} className="mt-1 w-full font-mono" />
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">
          User prompt <span className="font-normal text-muted">(test message template, variable: {'{{name}}'})</span>
        </span>
        <Textarea value={user} onChange={(e) => setUser(e.target.value)} rows={6} className="mt-1 w-full font-mono" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-ink">Change summary *</span>
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-1 w-full" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Change reason *</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full" />
        </label>
      </div>
    </Modal>
  );
}
