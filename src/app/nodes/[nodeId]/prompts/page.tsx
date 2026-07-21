'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEventHandler } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TopBar from '@/components/ui/TopBar';
import Modal from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/field';
import { Tabs } from '@/components/ui/Tabs';
import { api, ApiError } from '@/lib/api';
import type { AuditLog, PromptVersionDetail, PromptVersionSummary } from '@/lib/types';

type Tab = 'editor' | 'history';

export default function NodePromptsPage() {
  // The dynamic segment is the NODE_NM string (folder name is a Next.js artifact;
  // see `[nodeId]` — kept until a clean dev-server-down rename).
  const params = useParams<{ nodeId: string }>();
  const nodeNm = decodeURIComponent(params.nodeId);
  const router = useRouter();

  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [detail, setDetail] = useState<PromptVersionDetail | null>(null);
  const [tab, setTab] = useState<Tab>('editor');
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PromptVersionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (selectId?: number) => {
      try {
        const rows = await api.get<PromptVersionSummary[]>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`);
        setVersions(rows);
        const pick = selectId ?? rows[0]?.prompt_id;
        if (pick) setDetail(await api.get<PromptVersionDetail>(`/prompts/${pick}`));
        else setDetail(null);
      } catch (e) {
        setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
      }
    },
    [nodeNm],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function selectVersion(id: number) {
    setDetail(await api.get<PromptVersionDetail>(`/prompts/${id}`));
    setTab('editor');
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.del(`/prompts/${confirmDelete.prompt_id}`);
      const deletedId = confirmDelete.prompt_id;
      setConfirmDelete(null);
      // If the open detail was the deleted one, let reload() pick a fallback.
      await reload(detail?.prompt_id === deletedId ? undefined : detail?.prompt_id);
    } catch (e) {
      setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        right={
          <Button variant="secondary" size="sm" onClick={() => router.push('/nodes')}>
            ← Nodes
          </Button>
        }
      />

      {error && (
        <div className="mx-6 mt-4 rounded-sm border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* version list */}
        <aside className="w-72 overflow-auto border-r border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Versions</h2>
            <Button size="sm" onClick={() => setShowNew(true)}>+ New version</Button>
          </div>
          <ul className="space-y-1.5">
            {versions.map((v) => (
              <li key={v.prompt_id} className="group/ver relative">
                <button
                  onClick={() => selectVersion(v.prompt_id)}
                  className={
                    'w-full rounded-md border px-3 py-2.5 text-left transition-colors ' +
                    (detail?.prompt_id === v.prompt_id
                      ? 'border-accent/40 bg-accent-soft/60'
                      : 'border-line hover:bg-surface-2')
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium text-ink">v{v.version_no}</span>
                  </div>
                  {v.model_nm && (
                    <div className="mt-1 truncate text-[11px] text-muted">{v.model_nm}</div>
                  )}
                  {v.change_summary && (
                    <div className="mt-1 truncate text-xs text-muted">{v.change_summary}</div>
                  )}
                  <div className="mt-1 text-[11px] text-muted">{v.created_dt}</div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(v);
                  }}
                  title="Delete this version"
                  className="absolute right-2 top-2 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-bad/40 hover:bg-bad/5 hover:text-bad"
                >
                  Delete
                </button>
              </li>
            ))}
            {versions.length === 0 && (
              <li className="px-1 py-2 text-sm text-muted">No versions yet. Create one.</li>
            )}
          </ul>
        </aside>

        {/* detail */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {detail ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-6 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-base font-semibold text-ink">{nodeNm}</h1>
                    <span className="font-mono text-sm text-muted">v{detail.version_no}</span>
                    {detail.model_nm && <Badge tone="neutral">{detail.model_nm}</Badge>}
                  </div>
                  {detail.change_summary && (
                    <p className="mt-0.5 truncate text-xs text-muted">{detail.change_summary}</p>
                  )}
                </div>
              </div>

              <div className="px-6 pt-5">
                <Tabs
                  items={[
                    { id: 'editor', label: 'Content' },
                    { id: 'history', label: 'History' },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              </div>

              <div className="flex-1 overflow-auto p-6">
                {tab === 'editor' && (
                  <EditorTab detail={detail} onSaved={() => reload(detail.prompt_id)} />
                )}
                {tab === 'history' && <HistoryTab nodeNm={nodeNm} />}
              </div>
            </>
          ) : (
            <div className="p-8 text-sm text-muted">버전을 선택하거나 새로 만드세요.</div>
          )}
        </main>
      </div>

      {showNew && (
        <NewVersionModal
          nodeNm={nodeNm}
          base={detail}
          onClose={() => setShowNew(false)}
          onCreated={async (id) => {
            setShowNew(false);
            await reload(id);
          }}
        />
      )}

      <Modal
        open={!!confirmDelete}
        title="Delete version"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} disabled={busy}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          <span className="font-semibold">v{confirmDelete?.version_no}</span> will be deleted. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function EditorTab({
  detail,
  onSaved,
}: {
  detail: PromptVersionDetail;
  onSaved: () => void;
}) {
  const [system, setSystem] = useState(detail.system_prompt ?? '');
  const [user, setUser] = useState(detail.user_prompt ?? '');
  const [model, setModel] = useState(detail.model_nm ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSystem(detail.system_prompt ?? '');
    setUser(detail.user_prompt ?? '');
    setModel(detail.model_nm ?? '');
    setErr(null);
  }, [detail.prompt_id, detail.system_prompt, detail.user_prompt, detail.model_nm]);

  const dirty =
    system !== (detail.system_prompt ?? '') ||
    user !== (detail.user_prompt ?? '') ||
    model !== (detail.model_nm ?? '');

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/prompts/${detail.prompt_id}`, {
        system_prompt: system,
        user_prompt: user,
        model_nm: model.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {err && <div className="rounded-md border border-bad/20 bg-bad/5 px-3 py-2 text-sm text-bad">{err}</div>}
      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-sm font-medium text-ink">Model</span>
          <span className="text-xs text-muted">Saved with the version</span>
        </div>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. claude-sonnet-4-6"
          className="w-full font-mono"
        />
      </div>
      <PromptField
        label="System prompt"
        caption="Read as-is by the external model from the active PM_NODE_PROMPT_VER row"
        value={system}
        onChange={(e) => setSystem(e.target.value)}
        rows={10}
      />
      <PromptField
        label="User prompt"
        caption={'Test message template · variable {{name}}'}
        value={user}
        onChange={(e) => setUser(e.target.value)}
        rows={8}
      />
      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save prompt'}</Button>
      </div>
    </div>
  );
}

function PromptField({
  label,
  caption,
  value,
  onChange,
  rows,
}: {
  label: string;
  caption: string;
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  rows: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-muted">{caption}</span>
      </div>
      <Textarea
        value={value}
        onChange={onChange}
        rows={rows}
        className="w-full font-mono text-sm leading-relaxed"
      />
    </div>
  );
}

const ACTION_META: Record<string, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'bad' }> = {
  CREATE: { label: 'Create', tone: 'accent' },
  UPDATE: { label: 'Update', tone: 'neutral' },
  ACTIVATE: { label: 'Activate', tone: 'ok' },
  DELETE: { label: 'Delete', tone: 'bad' },
};

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (v == null ? '' : String(v));

const TEXT_FIELDS = ['system_prompt', 'user_prompt'];
const FIELD_LABEL: Record<string, string> = {
  system_prompt: 'System prompt',
  user_prompt: 'User prompt',
  model_nm: 'Model',
  version_no: 'Version',
  change_summary: 'Change summary',
  change_reason: 'Change reason',
  active_version_no: 'Active version',
  summary: 'Summary',
};

function AuditDetail({ log }: { log: AuditLog }) {
  const before = parseJson(log.before_value);
  const after = parseJson(log.after_value);
  const keys = Array.from(
    new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]),
  ).filter((k) => !['prompt_id', 'node_nm', 'active_prompt_id'].includes(k));

  if (!keys.length) {
    if (!log.before_value && !log.after_value) return null;
    return (
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 text-xs text-muted">
        {log.after_value ?? log.before_value}
      </pre>
    );
  }

  return (
    <dl className="mt-2 space-y-2">
      {keys.map((k) => {
        const b = str(before?.[k]);
        const a = str(after?.[k]);
        if (!b && !a) return null;
        const label = FIELD_LABEL[k] ?? k;
        if (TEXT_FIELDS.includes(k)) {
          const changed = b !== a;
          return (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">{label}</dt>
              <dd className="mt-0.5 grid gap-1">
                {changed && b && (
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-bad/20 bg-bad/5 p-2 text-xs text-bad">
                    − {b}
                  </pre>
                )}
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-ok/20 bg-ok/5 p-2 text-xs text-ok">
                  {changed && b ? '+ ' : ''}{a || '(empty)'}
                </pre>
              </dd>
            </div>
          );
        }
        return (
          <div key={k} className="flex gap-2 text-xs">
            <dt className="font-medium text-muted">{label}:</dt>
            <dd className="text-ink">{b && a && b !== a ? `${b} → ${a}` : a || b}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function HistoryTab({ nodeNm }: { nodeNm: string }) {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  useEffect(() => {
    api
      .get<AuditLog[]>(`/nodes/${encodeURIComponent(nodeNm)}/audit-logs?limit=100`)
      .then(setLogs)
      .catch(() => setLogs([]));
  }, [nodeNm]);
  if (logs === null) return <div className="text-sm text-muted">Loading…</div>;
  if (!logs.length) return <div className="text-sm text-muted">No history yet.</div>;
  return (
    <ul className="space-y-2.5">
      {logs.map((l) => {
        const meta = ACTION_META[l.action] ?? { label: l.action, tone: 'neutral' as const };
        return (
          <li key={l.log_id} className="rounded-sm border border-line bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="text-xs font-medium text-ink">{l.created_by}</span>
              <span className="font-mono text-xs text-muted">{l.target_table}#{l.target_id}</span>
              <span className="ml-auto text-xs text-muted">{l.created_dt}</span>
            </div>
            <AuditDetail log={l} />
          </li>
        );
      })}
    </ul>
  );
}

function NewVersionModal({
  nodeNm,
  base,
  onClose,
  onCreated,
}: {
  nodeNm: string;
  base: PromptVersionDetail | null;
  onClose: () => void;
  onCreated: (promptId: number) => void;
}) {
  const [system, setSystem] = useState(base?.system_prompt ?? '');
  const [user, setUser] = useState(base?.user_prompt ?? '');
  const [model, setModel] = useState(base?.model_nm ?? '');
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = useMemo(
    () => (system.trim() || user.trim()) && summary.trim() && reason.trim(),
    [system, user, summary, reason],
  );

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.post<PromptVersionDetail>(`/nodes/${encodeURIComponent(nodeNm)}/prompts`, {
        system_prompt: system,
        user_prompt: user,
        model_nm: model.trim() || null,
        change_summary: summary,
        change_reason: reason,
      });
      onCreated(created.prompt_id);
    } catch (e) {
      setErr(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="New prompt version"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>Save</Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-md border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">{err}</div>}
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
