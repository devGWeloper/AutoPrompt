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
import type { AuditLog, PromptVersionDetail, PromptVersionSummary } from '@/types';

type Tab = 'editor' | 'history';

export default function NodePromptsPage() {
  const params = useParams<{ nodeId: string }>();
  const nodeId = Number(params.nodeId);
  const router = useRouter();

  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [detail, setDetail] = useState<PromptVersionDetail | null>(null);
  const [tab, setTab] = useState<Tab>('editor');
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState<PromptVersionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (selectId?: number) => {
      try {
        const rows = await api.get<PromptVersionSummary[]>(`/nodes/${nodeId}/prompts`);
        setVersions(rows);
        const pick = selectId ?? rows.find((r) => r.is_active === 'Y')?.prompt_id ?? rows[0]?.prompt_id;
        if (pick) setDetail(await api.get<PromptVersionDetail>(`/prompts/${pick}`));
        else setDetail(null);
      } catch (e) {
        setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
      }
    },
    [nodeId],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const nodeNm = versions[0]?.node_nm ?? detail?.node_nm ?? `#${nodeId}`;

  async function selectVersion(id: number) {
    setDetail(await api.get<PromptVersionDetail>(`/prompts/${id}`));
    setTab('editor');
  }

  async function doActivate() {
    if (!confirmActivate) return;
    setBusy(true);
    try {
      await api.put(`/prompts/${confirmActivate.prompt_id}/activate`);
      setConfirmActivate(null);
      await reload(confirmActivate.prompt_id);
    } catch (e) {
      setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        right={
          <Button variant="secondary" size="sm" onClick={() => router.push('/nodes')}>
            ← 노드 목록
          </Button>
        }
      />

      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* version list */}
        <aside className="w-72 overflow-auto border-r border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted">버전</h2>
            <Button size="sm" onClick={() => setShowNew(true)}>+ 새 버전</Button>
          </div>
          <ul className="space-y-1.5">
            {versions.map((v) => (
              <li key={v.prompt_id}>
                <button
                  onClick={() => selectVersion(v.prompt_id)}
                  className={
                    'w-full rounded-md border px-3 py-2.5 text-left transition-colors ' +
                    (detail?.prompt_id === v.prompt_id
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-line hover:bg-bg')
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium text-ink">v{v.version_no}</span>
                    {v.is_active === 'Y' && <Badge tone="ok">ACTIVE</Badge>}
                  </div>
                  {v.change_summary && (
                    <div className="mt-1 truncate text-xs text-muted">{v.change_summary}</div>
                  )}
                  <div className="mt-1 text-[11px] text-muted">{v.created_dt}</div>
                </button>
              </li>
            ))}
            {versions.length === 0 && (
              <li className="px-1 py-2 text-sm text-muted">버전이 없습니다. 새 버전을 만드세요.</li>
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
                    {detail.is_active === 'Y' ? <Badge tone="ok">활성</Badge> : <Badge tone="neutral">비활성</Badge>}
                  </div>
                  {detail.change_summary && (
                    <p className="mt-0.5 truncate text-xs text-muted">{detail.change_summary}</p>
                  )}
                </div>
                {detail.is_active !== 'Y' && (
                  <Button onClick={() => setConfirmActivate(detail)}>이 버전 활성화</Button>
                )}
              </div>

              <div className="px-6 pt-2">
                <Tabs
                  items={[
                    { id: 'editor', label: '내용' },
                    { id: 'history', label: '변경 이력' },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              </div>

              <div className="flex-1 overflow-auto p-6">
                {tab === 'editor' && (
                  <EditorTab detail={detail} onSaved={() => reload(detail.prompt_id)} onEditAsNew={() => setShowNew(true)} />
                )}
                {tab === 'history' && <HistoryTab nodeId={nodeId} />}
              </div>
            </>
          ) : (
            <div className="p-8 text-sm text-muted">버전을 선택하거나 새로 만드세요.</div>
          )}
        </main>
      </div>

      {showNew && (
        <NewVersionModal
          nodeId={nodeId}
          base={detail}
          onClose={() => setShowNew(false)}
          onCreated={async (id) => {
            setShowNew(false);
            await reload(id);
          }}
        />
      )}

      <Modal
        open={!!confirmActivate}
        title="버전 활성화"
        onClose={() => setConfirmActivate(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmActivate(null)}>취소</Button>
            <Button onClick={doActivate} disabled={busy}>활성화</Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          <span className="font-semibold">v{confirmActivate?.version_no}</span> 을(를) 활성화합니다.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>운영 테이블 <span className="font-mono text-ink">NODE_MAS.PROMPT</span> 에 즉시 반영됩니다.</li>
        </ul>
      </Modal>
    </div>
  );
}

function EditorTab({
  detail,
  onSaved,
  onEditAsNew,
}: {
  detail: PromptVersionDetail;
  onSaved: () => void;
  onEditAsNew: () => void;
}) {
  const locked = detail.is_active === 'Y';
  const [system, setSystem] = useState(detail.system_prompt ?? '');
  const [user, setUser] = useState(detail.user_prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSystem(detail.system_prompt ?? '');
    setUser(detail.user_prompt ?? '');
    setErr(null);
  }, [detail.prompt_id, detail.system_prompt, detail.user_prompt]);

  const dirty = system !== (detail.system_prompt ?? '') || user !== (detail.user_prompt ?? '');

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/prompts/${detail.prompt_id}`, { system_prompt: system, user_prompt: user });
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
      {locked && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/60 px-4 py-3">
          <p className="text-sm text-muted">활성 버전은 잠겨 있어 직접 편집할 수 없습니다. 편집하려면 새 버전을 만드세요.</p>
          <Button variant="secondary" size="sm" onClick={onEditAsNew}>새 버전으로 편집</Button>
        </div>
      )}
      <PromptField
        label="시스템 프롬프트"
        caption="활성화 시 NODE_MAS.PROMPT 로 반영"
        value={system}
        onChange={(e) => setSystem(e.target.value)}
        readOnly={locked}
        rows={10}
      />
      <PromptField
        label="유저 프롬프트"
        caption={'테스트 메시지 템플릿 · 변수 {{name}}'}
        value={user}
        onChange={(e) => setUser(e.target.value)}
        readOnly={locked}
        rows={8}
      />
      {!locked && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || busy}>{busy ? '저장 중…' : '프롬프트 저장'}</Button>
        </div>
      )}
    </div>
  );
}

function PromptField({
  label,
  caption,
  value,
  onChange,
  readOnly,
  rows,
}: {
  label: string;
  caption: string;
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  readOnly: boolean;
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
        readOnly={readOnly}
        rows={rows}
        className={'font-mono text-sm leading-relaxed ' + (readOnly ? 'bg-bg text-muted' : '')}
      />
    </div>
  );
}

const ACTION_META: Record<string, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'bad' }> = {
  CREATE: { label: '생성', tone: 'accent' },
  UPDATE: { label: '수정', tone: 'neutral' },
  ACTIVATE: { label: '활성화', tone: 'ok' },
  FLOW_VERSION: { label: '전체 버전', tone: 'neutral' },
  DELETE: { label: '삭제', tone: 'bad' },
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
  system_prompt: '시스템 프롬프트',
  user_prompt: '유저 프롬프트',
  version_no: '버전',
  change_summary: '변경 요약',
  change_reason: '변경 사유',
  active_version_no: '활성 버전',
  flow_version_no: '전체 버전',
  summary: '요약',
};

function AuditDetail({ log }: { log: AuditLog }) {
  const before = parseJson(log.before_value);
  const after = parseJson(log.after_value);
  const keys = Array.from(
    new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]),
  ).filter((k) => !['prompt_id', 'node_mas_id', 'node_nm', 'active_prompt_id'].includes(k));

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
              <dt className="text-xs font-medium text-muted">{label}</dt>
              <dd className="mt-0.5 grid gap-1">
                {changed && b && (
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-bad/20 bg-bad/5 p-2 text-xs text-bad">
                    − {b}
                  </pre>
                )}
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-ok/20 bg-ok/5 p-2 text-xs text-ok">
                  {changed && b ? '+ ' : ''}{a || '(빈 값)'}
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

function HistoryTab({ nodeId }: { nodeId: number }) {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  useEffect(() => {
    api.get<AuditLog[]>(`/nodes/${nodeId}/audit-logs?limit=100`).then(setLogs).catch(() => setLogs([]));
  }, [nodeId]);
  if (logs === null) return <div className="text-sm text-muted">불러오는 중…</div>;
  if (!logs.length) return <div className="text-sm text-muted">변경 이력이 없습니다.</div>;
  return (
    <ul className="space-y-2.5">
      {logs.map((l) => {
        const meta = ACTION_META[l.action] ?? { label: l.action, tone: 'neutral' as const };
        return (
          <li key={l.log_id} className="rounded-lg border border-line bg-surface p-3 text-sm">
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
  nodeId,
  base,
  onClose,
  onCreated,
}: {
  nodeId: number;
  base: PromptVersionDetail | null;
  onClose: () => void;
  onCreated: (promptId: number) => void;
}) {
  const [system, setSystem] = useState(base?.system_prompt ?? '');
  const [user, setUser] = useState(base?.user_prompt ?? '');
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState('');
  const [activate, setActivate] = useState(false);
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
      const created = await api.post<PromptVersionDetail>(`/nodes/${nodeId}/prompts`, {
        system_prompt: system,
        user_prompt: user,
        change_summary: summary,
        change_reason: reason,
        activate_after_save: activate,
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
      {err && <div className="mb-3 rounded-md border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">{err}</div>}
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">
          시스템 프롬프트 <span className="font-normal text-muted">(활성화 시 NODE_MAS.PROMPT 로 반영)</span>
        </span>
        <Textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={7} className="mt-1 font-mono" />
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">
          유저 프롬프트 <span className="font-normal text-muted">(테스트 메시지 템플릿, 변수: {'{{name}}'})</span>
        </span>
        <Textarea value={user} onChange={(e) => setUser(e.target.value)} rows={6} className="mt-1 font-mono" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-ink">변경 요약 *</span>
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">변경 사유 *</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" className="accent-accent" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        저장 후 즉시 활성화 (NODE_MAS.PROMPT 반영)
      </label>
    </Modal>
  );
}
