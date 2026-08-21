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
            <div className="mb-4 rounded-sm border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</div>
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
                  className="flex w-full flex-col rounded-md border border-line bg-surface p-6 text-left transition-all hover:border-ink hover:shadow-lift"
                >
                  <div className="flex items-center gap-2 pr-28">
                    <span className="truncate text-display-xs text-ink">{n.node_nm}</span>
                  </div>
                  <p className="mt-1.5 truncate font-mono text-caption-mono text-muted">{n.latest_model_nm ?? '—'}</p>
                </button>
                <div className="absolute right-3 top-3 flex items-center gap-1.5">
                  <Badge tone="accent">v{n.latest_version_no ?? '—'}</Badge>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(n);
                    }}
                    title="Delete node"
                    className="rounded-sm border border-line bg-surface px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-bad/40 hover:bg-bad/5 hover:text-bad"
                  >
                    Delete
                  </button>
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
        title="Delete node"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} disabled={busy}>Delete</Button>
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
      title="New node"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>Create</Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-sm border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">{err}</div>}
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">Node name (NODE_NM) *</span>
        <Input value={nodeNm} onChange={(e) => setNodeNm(e.target.value)} placeholder="e.g. router" className="mt-1 w-full font-mono" />
        {duplicate && <span className="mt-1 block text-xs text-bad">This node name already exists.</span>}
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
