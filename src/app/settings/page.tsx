'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import AppShell from '@/components/ui/AppShell';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Table, TBody, THead, TD, TH, TR } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import { MODEL_ROLE_NOTES, type Endpoint, type EndpointHeader, type LlmModel, type ModelRole, type ModelRoleUpdate } from '@/lib/types';
import { errText, PencilIcon, TrashIcon, useArmed } from '@/components/ragas/shared';

/**
 * The one place where what a run may *choose from* is defined: which APIs it can
 * call, which models a role can be set to, and what each role starts out
 * holding. The run screens then offer lists instead of empty text boxes, so a
 * URL or a model name is typed once here rather than re-typed (and mistyped) on
 * every run.
 */

// ---- small shared pieces ---------------------------------------------------

/** Section frame: name + count + the section's own action, then its rows. */
function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-body-md font-medium text-ink">{title}</span>
          <span className="font-mono text-caption-mono text-muted-soft">{count}</span>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Row action at table density: icon only, meaning carried by the tooltip. */
function IconBtn({ title, onClick, children, tone }: { title: string; onClick: () => void; children: ReactNode; tone?: 'bad' }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'rounded-sm p-1.5 transition-colors',
        tone === 'bad' ? 'text-muted hover:bg-bad/5 hover:text-bad' : 'text-muted hover:bg-surface-3 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Arm-then-confirm delete: the first click arms, the second removes. */
function DeleteBtn({ onConfirm, title }: { onConfirm: () => void; title: string }) {
  const [armed, setArmed] = useArmed();
  return (
    <button
      type="button"
      title={armed ? '한 번 더' : title}
      aria-label={title}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      className={cn(
        'rounded-sm p-1.5 transition-colors',
        armed ? 'bg-bad/10 text-bad' : 'text-muted hover:bg-bad/5 hover:text-bad',
      )}
    >
      <TrashIcon />
    </button>
  );
}

/** On/off as a switch — the state is the control, with no line explaining it. */
function Toggle({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
      className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-muted/30')}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
          on && 'translate-x-3',
        )}
      />
    </button>
  );
}

function ErrLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="border-b border-line bg-bad/5 px-5 py-2.5 text-body-sm text-bad">{msg}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-body-sm text-muted-soft">{children}</div>;
}

// ---- endpoints -------------------------------------------------------------

const BLANK_HEADER: EndpointHeader = { name: '', value: '' };

function EndpointModal({
  initial,
  onClose,
  onSaved,
}: {
  /** null = 새로 추가. */
  initial: Endpoint | null;
  onClose: () => void;
  onSaved: (next: Endpoint[]) => void;
}) {
  const [nm, setNm] = useState(initial?.endpoint_nm ?? '');
  const [url, setUrl] = useState(initial?.endpoint_url ?? '');
  const [headers, setHeaders] = useState<EndpointHeader[]>(
    initial?.headers.length ? initial.headers : [BLANK_HEADER],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = nm.trim() !== '' && /^https?:\/\//i.test(url.trim());

  const setHeader = (i: number, patch: Partial<EndpointHeader>) =>
    setHeaders((cur) => cur.map((h, j) => (i === j ? { ...h, ...patch } : h)));

  async function save() {
    setBusy(true);
    setErr(null);
    const body = {
      endpoint_nm: nm.trim(),
      endpoint_url: url.trim(),
      headers: headers.filter((h) => h.name.trim() !== ''),
      is_active: initial?.is_active ?? ('Y' as const),
    };
    try {
      const next = initial
        ? await api.put<Endpoint[]>(`/endpoints/${initial.endpoint_id}`, body)
        : await api.post<Endpoint[]>('/endpoints', body);
      onSaved(next);
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={initial ? initial.endpoint_nm : 'API 추가'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={!valid || busy}>저장</Button>
        </>
      }
    >
      {err && <div className="mb-4 rounded-sm border border-bad/20 bg-bad/5 px-3 py-2 text-body-sm text-bad">{err}</div>}
      <label className="mb-4 block">
        <span className="eyebrow">이름</span>
        <Input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="운영 챗 API" className="mt-1.5 w-full" />
      </label>
      <label className="mb-4 block">
        <span className="eyebrow">URL</span>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://host:port/path"
          className="mt-1.5 w-full font-mono text-xs"
        />
      </label>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">헤더</span>
        <button
          type="button"
          onClick={() => setHeaders((cur) => [...cur, { ...BLANK_HEADER }])}
          title="헤더 행 추가"
          className="rounded-sm border border-line px-2 py-0.5 text-caption text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          + 행
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {headers.map((h, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
            <Input
              value={h.name}
              onChange={(e) => setHeader(i, { name: e.target.value })}
              placeholder="auth-key"
              className="h-9 w-full font-mono text-xs"
            />
            <Input
              value={h.value}
              onChange={(e) => setHeader(i, { value: e.target.value })}
              placeholder="값"
              className="h-9 w-full font-mono text-xs"
            />
            <IconBtn title="행 삭제" tone="bad" onClick={() => setHeaders((cur) => cur.filter((_, j) => j !== i))}>
              <TrashIcon />
            </IconBtn>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function EndpointsSection({
  list,
  setList,
}: {
  list: Endpoint[];
  setList: (next: Endpoint[]) => void;
}) {
  const [editing, setEditing] = useState<Endpoint | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<Endpoint[]>) => {
    setErr(null);
    try {
      setList(await fn());
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <Section
      title="API 엔드포인트"
      count={list.length}
      action={<Button size="sm" onClick={() => setEditing(null)}>+ 추가</Button>}
    >
      <ErrLine msg={err} />
      {list.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-10" />
              <TH>이름</TH>
              <TH>URL</TH>
              <TH className="w-24">헤더</TH>
              <TH className="w-24" />
            </TR>
          </THead>
          <TBody>
            {list.map((e) => (
              <TR key={e.endpoint_id}>
                <TD className="align-middle">
                  <Toggle
                    on={e.is_active === 'Y'}
                    title={e.is_active === 'Y' ? '실행에서 선택 가능' : '실행에서 숨김'}
                    onChange={(v) =>
                      run(() =>
                        api.put<Endpoint[]>(`/endpoints/${e.endpoint_id}`, {
                          endpoint_nm: e.endpoint_nm,
                          endpoint_url: e.endpoint_url,
                          headers: e.headers,
                          description: e.description,
                          is_active: v ? 'Y' : 'N',
                        }),
                      )
                    }
                  />
                </TD>
                <TD className="align-middle font-medium text-ink">{e.endpoint_nm}</TD>
                <TD className="max-w-[26rem] align-middle">
                  <span className="block truncate font-mono text-caption-mono text-muted" title={e.endpoint_url}>
                    {e.endpoint_url}
                  </span>
                </TD>
                <TD className="align-middle">
                  <span
                    className="font-mono text-caption-mono text-muted"
                    title={e.headers.map((h) => h.name).join(', ') || undefined}
                  >
                    {e.headers.length || '—'}
                  </span>
                </TD>
                <TD className="align-middle">
                  <div className="flex items-center justify-end gap-0.5">
                    <IconBtn title="수정" onClick={() => setEditing(e)}>
                      <PencilIcon />
                    </IconBtn>
                    <DeleteBtn
                      title="삭제"
                      onConfirm={() => run(() => api.del<Endpoint[]>(`/endpoints/${e.endpoint_id}`))}
                    />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {editing !== undefined && (
        <EndpointModal initial={editing} onClose={() => setEditing(undefined)} onSaved={setList} />
      )}
    </Section>
  );
}

// ---- model catalog ---------------------------------------------------------

function ModelsSection({ list, setList }: { list: LlmModel[]; setList: (next: LlmModel[]) => void }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const name = draft.trim();
  const duplicate = list.some((m) => m.llm_nm === name);

  const run = async (fn: () => Promise<LlmModel[]>) => {
    setErr(null);
    try {
      setList(await fn());
    } catch (e) {
      setErr(errText(e));
    }
  };

  async function add() {
    if (!name || duplicate) return;
    await run(() => api.post<LlmModel[]>('/llms', { llm_nm: name }));
    setDraft('');
  }

  return (
    <Section title="모델" count={list.length}>
      <ErrLine msg={err} />
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="claude-sonnet-4-6"
          className={cn('h-9 w-72 font-mono text-xs', duplicate && 'border-bad')}
        />
        <Button size="sm" onClick={add} disabled={!name || duplicate}>+ 추가</Button>
      </div>
      {list.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((m) => (
            <li key={m.llm_id} className="flex items-center gap-3 px-5 py-2.5">
              <Toggle
                on={m.is_active === 'Y'}
                title={m.is_active === 'Y' ? '선택 가능' : '숨김'}
                onChange={(v) =>
                  run(() => api.put<LlmModel[]>(`/llms/${m.llm_id}`, { llm_nm: m.llm_nm, description: m.description, is_active: v ? 'Y' : 'N' }))
                }
              />
              <span className={cn('min-w-0 flex-1 truncate font-mono text-body-sm', m.is_active === 'Y' ? 'text-ink' : 'text-muted-soft')}>
                {m.llm_nm}
              </span>
              <DeleteBtn title="삭제" onConfirm={() => run(() => api.del<LlmModel[]>(`/llms/${m.llm_id}`))} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- role defaults ---------------------------------------------------------

const ROLE_RE = /^[A-Za-z0-9_.-]+$/;

interface RoleDraft {
  model_nm: string;
  temperature: string;
}

const toDraft = (m: ModelRole): RoleDraft => ({
  model_nm: m.model_nm ?? '',
  temperature: m.temperature === null ? '' : String(m.temperature),
});

const sameDraft = (a: RoleDraft, b: RoleDraft) =>
  a.model_nm === b.model_nm && a.temperature === b.temperature;

function RolesSection({
  roles,
  setRoles,
  models,
}: {
  roles: ModelRole[];
  setRoles: (next: ModelRole[]) => void;
  models: LlmModel[];
}) {
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const [newRole, setNewRole] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(roles.map((m) => [m.role_cd, toDraft(m)])));
  }, [roles]);

  const options = useMemo(() => models.filter((m) => m.is_active === 'Y'), [models]);
  const dirty = roles.filter((m) => drafts[m.role_cd] && !sameDraft(drafts[m.role_cd], toDraft(m)));

  const name = newRole.trim();
  const canAdd = name !== '' && ROLE_RE.test(name) && !roles.some((m) => m.role_cd === name) && !busy;

  const run = async (fn: () => Promise<ModelRole[]>) => {
    setBusy(true);
    setErr(null);
    try {
      setRoles(await fn());
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  async function save() {
    const items: ModelRoleUpdate[] = dirty.map((m) => {
      const d = drafts[m.role_cd];
      const t = d.temperature.trim();
      return {
        role_cd: m.role_cd,
        model_nm: d.model_nm || null,
        temperature: t === '' ? null : Number(t),
        description: m.description,
      };
    });
    if (items.length) await run(() => api.put<ModelRole[]>('/models', { items }));
  }

  return (
    <Section
      title="Role 기본값"
      count={roles.length}
      action={
        <Button size="sm" onClick={save} disabled={!dirty.length || busy}>
          저장{dirty.length ? ` (${dirty.length})` : ''}
        </Button>
      }
    >
      <ErrLine msg={err} />
      {roles.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {roles.map((m) => {
            const d = drafts[m.role_cd] ?? { model_nm: '', temperature: '' };
            // A model saved earlier and since removed from the catalog would
            // vanish from the list silently, so it stays as its own option.
            const missing = d.model_nm !== '' && !options.some((o) => o.llm_nm === d.model_nm);
            return (
              <li key={m.role_cd} className="grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)_72px_auto] items-center gap-3 px-5 py-2.5">
                <span className="truncate font-mono text-body-sm text-ink" title={MODEL_ROLE_NOTES[m.role_cd]}>
                  {m.role_cd}
                </span>
                <select
                  value={d.model_nm}
                  onChange={(e) => setDrafts((cur) => ({ ...cur, [m.role_cd]: { ...cur[m.role_cd], model_nm: e.target.value } }))}
                  className={cn(
                    'h-9 w-full rounded-sm border bg-surface px-2 font-mono text-xs text-ink transition',
                    'hover:border-line-strong focus:border-ink focus:shadow-ring focus:outline-none',
                    missing ? 'border-warn' : 'border-line',
                  )}
                >
                  <option value="">—</option>
                  {missing && <option value={d.model_nm}>{d.model_nm}</option>}
                  {options.map((o) => (
                    <option key={o.llm_id} value={o.llm_nm}>{o.llm_nm}</option>
                  ))}
                </select>
                <Input
                  value={d.temperature}
                  onChange={(e) => setDrafts((cur) => ({ ...cur, [m.role_cd]: { ...cur[m.role_cd], temperature: e.target.value } }))}
                  inputMode="decimal"
                  placeholder="t"
                  title="temperature (0 – 2)"
                  className="h-9 w-full text-center font-mono text-xs"
                />
                <DeleteBtn title="role 삭제" onConfirm={() => run(() => api.del<ModelRole[]>(`/models/${encodeURIComponent(m.role_cd)}`))} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <Input
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canAdd) {
              run(() => api.post<ModelRole[]>('/models', { role_cd: name }));
              setNewRole('');
            }
          }}
          placeholder="role"
          className="h-9 w-48 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!canAdd}
          onClick={() => {
            run(() => api.post<ModelRole[]>('/models', { role_cd: name }));
            setNewRole('');
          }}
        >
          + role
        </Button>
      </div>
    </Section>
  );
}

// ---- page ------------------------------------------------------------------

export default function SettingsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [roles, setRoles] = useState<ModelRole[]>([]);

  const load = useCallback(() => {
    api.get<Endpoint[]>('/endpoints').then(setEndpoints).catch(() => setEndpoints([]));
    api.get<LlmModel[]>('/llms').then(setModels).catch(() => setModels([]));
    api.get<ModelRole[]>('/models').then(setRoles).catch(() => setRoles([]));
  }, []);

  useEffect(load, [load]);

  return (
    <AppShell section="settings">
      <div className={cn(SHELL, 'px-8 py-7')}>
        <PageHeader title="설정" />
        <div className="flex flex-col gap-5">
          <EndpointsSection list={endpoints} setList={setEndpoints} />
          <ModelsSection list={models} setList={setModels} />
          <RolesSection roles={roles} setRoles={setRoles} models={models} />
        </div>
      </div>
    </AppShell>
  );
}
