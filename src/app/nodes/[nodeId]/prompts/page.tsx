'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEventHandler } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/ui/AppShell';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, fmtDt, TrashIcon } from '@/components/ragas/shared';
import { Input, Textarea } from '@/components/ui/Field';
import { ModelSelect } from '@/components/ui/ModelSelect';
import { Tabs } from '@/components/ui/Tabs';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
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
    <AppShell section="prompts">
    {/* 다른 화면과 같은 틀: SHELL 폭 · 같은 여백 · PageHeader, 그 아래 목록 카드와
        상세 카드 두 칸 — 데이터셋 화면과 같은 모양이라 따로 익힐 것이 없다. */}
    <div className={cn(SHELL, 'px-8 py-7')}>
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => router.push('/nodes')}
              className="shrink-0 rounded-sm text-muted transition-colors hover:text-ink"
            >
              프롬프트
            </button>
            <span className="shrink-0 font-normal text-line-strong">/</span>
            <span className="truncate font-mono">{nodeNm}</span>
          </span>
        }
        right={<Button onClick={() => setShowNew(true)}>+ 새 버전</Button>}
      />

      {error && (
        <div className="mb-4 rounded-sm border border-bad-line bg-bad-soft px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader
            title={<>버전 <span className="ml-1 font-mono text-caption-mono font-normal text-muted-soft">{versions.length}</span></>}
          />
          <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto p-1.5">
            {versions.map((v) => {
              const on = detail?.prompt_id === v.prompt_id;
              return (
                <li key={v.prompt_id} className="group relative">
                  <button
                    onClick={() => selectVersion(v.prompt_id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-sm py-2 pl-2 pr-2.5 text-left transition-colors',
                      on ? 'bg-surface-3' : 'hover:bg-surface-2',
                    )}
                  >
                    <span aria-hidden className={cn('mt-0.5 h-4 w-0.5 shrink-0', on ? 'bg-primary' : 'bg-transparent')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-sm font-medium text-ink">v{v.version_no}</span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-soft group-hover:invisible">
                          {fmtDt(v.created_dt)}
                        </span>
                      </span>
                      {v.model_nm && <span className="mt-0.5 block truncate text-[11px] text-muted">{v.model_nm}</span>}
                      {v.change_summary && <span className="mt-0.5 block truncate text-xs text-muted">{v.change_summary}</span>}
                    </span>
                  </button>
                  {/* 삭제는 가져다 댈 때 날짜 자리에 선다 — 늘 떠 있으면 내용을 가린다. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(v);
                    }}
                    title="버전 삭제"
                    aria-label="버전 삭제"
                    className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-bad-soft hover:text-bad group-hover:inline-flex group-focus-within:inline-flex"
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
            {versions.length === 0 && (
              <li className="px-1 py-8 text-center text-sm text-muted-soft">—</li>
            )}
          </ul>
        </Card>

        <Card className="min-w-0">
          {detail ? (
            <>
              <CardHeader
                title={<span className="font-mono">v{detail.version_no}</span>}
                right={
                  <Tabs
                    items={[
                      { id: 'editor', label: '내용' },
                      { id: 'history', label: '이력' },
                    ]}
                    value={tab}
                    onChange={setTab}
                  />
                }
              >
                {detail.model_nm && <Badge tone="neutral">{detail.model_nm}</Badge>}
                {detail.change_summary && <span className="min-w-0 truncate">{detail.change_summary}</span>}
              </CardHeader>
              <div className="p-4">
                {tab === 'editor' && (
                  <EditorTab detail={detail} onSaved={() => reload(detail.prompt_id)} />
                )}
                {tab === 'history' && <HistoryTab nodeNm={nodeNm} />}
              </div>
            </>
          ) : (
            <EmptyState label="—" />
          )}
        </Card>
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
        title="버전 삭제"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>취소</Button>
            <Button variant="danger" onClick={doDelete} disabled={busy}>삭제</Button>
          </>
        }
      >
        <p className="text-body-md text-ink">
          <span className="font-mono">v{confirmDelete?.version_no}</span> 삭제
        </p>
      </Modal>
    </div>
    </AppShell>
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
      {err && <div className="rounded-sm border border-bad-line bg-bad-soft px-3 py-2 text-sm text-bad">{err}</div>}
      <div>
        <div className="mb-1.5">
          <span className="text-sm font-medium text-ink">Model</span>
        </div>
        <ModelSelect value={model} onChange={setModel} className="w-full" />
      </div>
      <PromptField
        label="System prompt"
        value={system}
        onChange={(e) => setSystem(e.target.value)}
        rows={10}
      />
      <PromptField
        label="User prompt"
        value={user}
        onChange={(e) => setUser(e.target.value)}
        rows={8}
        placeholder={'{{name}}'}
      />
      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || busy}>{busy ? '저장 중…' : '저장'}</Button>
      </div>
    </div>
  );
}

function PromptField({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  rows: number;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="mb-1.5">
        <span className="text-sm font-medium text-ink">{label}</span>
      </div>
      <Textarea
        value={value}
        onChange={onChange}
        rows={rows}
        placeholder={placeholder}
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
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-2 p-2 text-xs text-muted">
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
              <dt className="eyebrow">{label}</dt>
              <dd className="mt-0.5 grid gap-1">
                {changed && b && (
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-sm border border-bad-line bg-bad-soft p-2 text-xs text-bad">
                    − {b}
                  </pre>
                )}
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-sm border border-ok-line bg-ok-soft p-2 text-xs text-ok">
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
  if (logs === null) return <div className="text-sm text-muted-soft">…</div>;
  if (!logs.length) return <div className="text-sm text-muted-soft">—</div>;
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
      title="새 프롬프트 버전"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={!valid || busy}>저장</Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-sm border border-bad-line bg-bad-soft px-3 py-2 text-xs text-bad">{err}</div>}
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
