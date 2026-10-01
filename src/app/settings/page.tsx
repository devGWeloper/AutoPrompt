'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import AppShell from '@/components/ui/AppShell';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Table, TBody, THead, TD, TH, TR } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import { type Endpoint, type EndpointHeader, type LlmModel, type LlmServer, type ModelRole } from '@/lib/types';
import { errText, PencilIcon, refreshEndpoints, setLlmCatalog, TrashIcon, useArmed } from '@/components/ragas/shared';
import { setRoleCatalog } from '@/components/ragas/ModelPicker';

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
        tone === 'bad' ? 'text-muted hover:bg-bad-soft hover:text-bad' : 'text-muted hover:bg-surface-3 hover:text-ink',
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
        armed ? 'bg-bad-soft text-bad' : 'text-muted hover:bg-bad-soft hover:text-bad',
      )}
    >
      <TrashIcon />
    </button>
  );
}

/** On/off as a switch — the state is the control, with no line explaining it. */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
        on ? 'border-primary bg-primary' : 'border-line-strong bg-surface-3',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(17,24,39,0.35)] transition-transform',
          on && 'translate-x-3',
        )}
      />
    </button>
  );
}

function ErrLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="border-b border-line bg-bad-soft px-5 py-2.5 text-body-sm text-bad">{msg}</div>;
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
      {err && <div className="mb-4 rounded-sm border border-bad-line bg-bad-soft px-3 py-2 text-body-sm text-bad">{err}</div>}
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
      title="Agent"
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
              <TH className="w-14">사용</TH>
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
                    label={e.is_active === 'Y' ? '실행에서 선택 가능' : '실행에서 숨김'}
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

// ---- llm servers -----------------------------------------------------------

function LlmServerModal({
  initial,
  onClose,
  onSaved,
}: {
  /** null = 새로 추가. */
  initial: LlmServer | null;
  onClose: () => void;
  onSaved: (next: LlmServer[]) => void;
}) {
  const [nm, setNm] = useState(initial?.server_nm ?? '');
  const [url, setUrl] = useState(initial?.base_url ?? '');
  const [keyRef, setKeyRef] = useState(initial?.key_ref ?? '');
  const [keyNames, setKeyNames] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<string[]>('/llm-servers/key-names').then(setKeyNames).catch(() => setKeyNames([]));
  }, []);

  // 저장돼 있던 이름이 config 에서 빠졌으면 조용히 '—' 로 바꾸지 않고 그 이름을
  // 남긴 채 표시만 한다 — 저장 시 서버가 거절하므로 고르거나 비워야 넘어간다.
  const refMissing = keyRef !== '' && keyNames !== null && !keyNames.includes(keyRef);
  const valid = nm.trim() !== '' && /^https?:\/\//i.test(url.trim()) && !refMissing;

  async function save() {
    setBusy(true);
    setErr(null);
    const body = {
      server_nm: nm.trim(),
      base_url: url.trim(),
      key_ref: keyRef.trim() || null,
      is_active: initial?.is_active ?? ('Y' as const),
    };
    try {
      const next = initial
        ? await api.put<LlmServer[]>(`/llm-servers/${initial.server_id}`, body)
        : await api.post<LlmServer[]>('/llm-servers', body);
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
      title={initial ? initial.server_nm : 'LLM 서버 추가'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={!valid || busy}>저장</Button>
        </>
      }
    >
      {err && <div className="mb-4 rounded-sm border border-bad-line bg-bad-soft px-3 py-2 text-body-sm text-bad">{err}</div>}
      <label className="mb-4 block">
        <span className="eyebrow">이름</span>
        <Input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="vllm-a" className="mt-1.5 w-full" />
      </label>
      <label className="mb-4 block">
        <span className="eyebrow">Base URL</span>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://host:port/v1"
          className="mt-1.5 w-full font-mono text-xs"
        />
      </label>
      {/* 키 '값' 은 여기 들어오지 않는다 — config.yml llmKeys 의 이름 중에서만
          고르고, 값은 호출할 때 PTX 가 config 에서 꺼내 헤더로 넘긴다. */}
      <label className="block">
        <span className="eyebrow">API 키</span>
        <Select
          value={keyRef}
          onChange={(e) => setKeyRef(e.target.value)}
          disabled={keyNames === null || (keyNames.length === 0 && !refMissing)}
          title="config.yml · llmKeys"
          className={cn('mt-1.5 w-full font-mono text-xs', refMissing && 'border-warn')}
        >
          <option value="">{keyNames?.length === 0 ? 'config.yml llmKeys 비어 있음' : '—'}</option>
          {refMissing && <option value={keyRef}>{keyRef}</option>}
          {(keyNames ?? []).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </Select>
      </label>
    </Modal>
  );
}

/**
 * 모델이 떠 있는 서버. 모델마다 주소가 다른데 모델 목록이 이름만 들고 있으면
 * 실행은 에이전트 config 의 주소 한 곳으로만 나간다 — 주소를 여기서 관리하고
 * 모델이 그중 하나를 가리킨다.
 */
function LlmServersSection({ list, setList }: { list: LlmServer[]; setList: (next: LlmServer[]) => void }) {
  const [editing, setEditing] = useState<LlmServer | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<LlmServer[]>) => {
    setErr(null);
    try {
      setList(await fn());
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <Section
      title="LLM 서버"
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
              <TH className="w-14">사용</TH>
              <TH>이름</TH>
              <TH>Base URL</TH>
              <TH className="w-44">API 키</TH>
              <TH className="w-24" />
            </TR>
          </THead>
          <TBody>
            {list.map((s) => (
              <TR key={s.server_id}>
                <TD className="align-middle">
                  <Toggle
                    on={s.is_active === 'Y'}
                    label={s.is_active === 'Y' ? '모델에 지정 가능' : '모델에 지정 불가'}
                    onChange={(v) =>
                      run(() =>
                        api.put<LlmServer[]>(`/llm-servers/${s.server_id}`, {
                          server_nm: s.server_nm,
                          base_url: s.base_url,
                          key_ref: s.key_ref,
                          description: s.description,
                          is_active: v ? 'Y' : 'N',
                        }),
                      )
                    }
                  />
                </TD>
                <TD className="align-middle font-medium text-ink">{s.server_nm}</TD>
                <TD className="max-w-[26rem] align-middle">
                  <span className="block truncate font-mono text-caption-mono text-muted" title={s.base_url}>
                    {s.base_url}
                  </span>
                </TD>
                <TD className="align-middle">
                  <span className="font-mono text-caption-mono text-muted">{s.key_ref ?? '—'}</span>
                </TD>
                <TD className="align-middle">
                  <div className="flex items-center justify-end gap-0.5">
                    <IconBtn title="수정" onClick={() => setEditing(s)}>
                      <PencilIcon />
                    </IconBtn>
                    <DeleteBtn
                      title="삭제"
                      onConfirm={() => run(() => api.del<LlmServer[]>(`/llm-servers/${s.server_id}`))}
                    />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {editing !== undefined && (
        <LlmServerModal initial={editing} onClose={() => setEditing(undefined)} onSaved={setList} />
      )}
    </Section>
  );
}

// ---- model catalog ---------------------------------------------------------

function ModelsSection({
  list,
  setList,
  servers,
}: {
  list: LlmModel[];
  setList: (next: LlmModel[]) => void;
  servers: LlmServer[];
}) {
  const [draft, setDraft] = useState('');
  const [server, setServer] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const name = draft.trim();
  const sid = server === '' ? null : Number(server);
  // 같은 이름이라도 서버가 다르면 다른 모델이다 — 중복은 한 쌍으로 본다.
  const duplicate = list.some((m) => m.llm_nm === name && m.server_id === sid);
  const active = servers.filter((s) => s.is_active === 'Y');

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
    await run(() => api.post<LlmModel[]>('/llms', { llm_nm: name, server_id: sid }));
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
        {/* 서버를 고르지 않으면 주소 지정 없음 = 에이전트 config 의 주소로 나간다. */}
        <Select
          value={server}
          onChange={(e) => setServer(e.target.value)}
          disabled={active.length === 0}
          title={active.find((s) => String(s.server_id) === server)?.base_url}
          className="h-9 w-44 text-xs"
        >
          <option value="">서버 —</option>
          {active.map((s) => (
            <option key={s.server_id} value={s.server_id}>{s.server_nm}</option>
          ))}
        </Select>
        <Button size="sm" onClick={add} disabled={!name || duplicate}>+ 추가</Button>
      </div>
      {list.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((m) => (
            <li key={m.llm_id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink">{m.llm_nm}</span>
              {/* 주소는 서버 섹션의 것이라 이름만 — 전체 주소는 툴팁으로 남는다. */}
              <span
                className={cn('shrink-0 font-mono text-caption-mono', m.server_nm ? 'text-muted' : 'text-muted-soft')}
                title={m.base_url ?? '서버 미지정 — 에이전트 config 주소'}
              >
                {m.server_nm ?? '—'}
              </span>
              <DeleteBtn title="삭제" onConfirm={() => run(() => api.del<LlmModel[]>(`/llms/${m.llm_id}`))} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- roles ----------------------------------------------------------------

const ROLE_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Which roles exist — nothing more. What model a role runs is a property of one
 * test, not a setting: it is chosen in the run form, where it is visible next to
 * the run it applies to.
 */
function RolesSection({ roles, setRoles }: { roles: ModelRole[]; setRoles: (next: ModelRole[]) => void }) {
  const [newRole, setNewRole] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const name = newRole.trim();
  const canAdd = name !== "" && ROLE_RE.test(name) && !roles.some((m) => m.role_cd === name) && !busy;

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

  const add = () => {
    if (!canAdd) return;
    run(() => api.post<ModelRole[]>("/models", { role_cd: name }));
    setNewRole("");
  };

  return (
    <Section title="Role" count={roles.length}>
      <ErrLine msg={err} />
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Input
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="llm"
          className="h-9 w-48 font-mono text-xs"
        />
        <Button size="sm" onClick={add} disabled={!canAdd}>+ 추가</Button>
      </div>
      {roles.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {roles.map((m) => (
            <li key={m.role_cd} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink">
                {m.role_cd}
              </span>
              <DeleteBtn
                title="role 삭제"
                onConfirm={() => run(() => api.del<ModelRole[]>(`/models/${encodeURIComponent(m.role_cd)}`))}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- page ------------------------------------------------------------------

export default function SettingsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [servers, setServers] = useState<LlmServer[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [roles, setRoles] = useState<ModelRole[]>([]);

  const saveModels = useCallback((next: LlmModel[]) => {
    setModels(next);
    setLlmCatalog(next);
  }, []);

  const loadModels = useCallback(() => {
    api.get<LlmModel[]>('/llms').then(saveModels).catch(() => saveModels([]));
  }, [saveModels]);

  const load = useCallback(() => {
    api.get<Endpoint[]>('/endpoints').then(setEndpoints).catch(() => setEndpoints([]));
    api.get<LlmServer[]>('/llm-servers').then(setServers).catch(() => setServers([]));
    loadModels();
    api.get<ModelRole[]>('/models').then(setRoles).catch(() => setRoles([]));
  }, [loadModels]);

  useEffect(load, [load]);

  // Every save also republishes the list the run screens read from. They cache
  // it for the life of the tab, so without this a model added here would not be
  // selectable until a full reload.
  const saveEndpoints = useCallback((next: Endpoint[]) => {
    setEndpoints(next);
    // Refetched rather than published: the run screens get the active-only,
    // credential-masked view, which is not what this page is holding.
    refreshEndpoints();
  }, []);
  // 서버를 고치면 모델 행에 붙어 다니는 이름·주소가 같이 달라진다. 모델 목록은
  // 서버를 조인해 오므로 여기서 다시 읽어야 화면 두 곳이 어긋나지 않는다.
  const saveServers = useCallback(
    (next: LlmServer[]) => {
      setServers(next);
      loadModels();
    },
    [loadModels],
  );
  const saveRoles = useCallback((next: ModelRole[]) => {
    setRoles(next);
    setRoleCatalog(next);
  }, []);

  return (
    <AppShell section="settings">
      <div className={cn(SHELL, 'px-8 py-7')}>
        <PageHeader title="설정" />
        <div className="flex flex-col gap-5">
          <EndpointsSection list={endpoints} setList={saveEndpoints} />
          <LlmServersSection list={servers} setList={saveServers} />
          <ModelsSection list={models} setList={saveModels} servers={servers} />
          <RolesSection roles={roles} setRoles={saveRoles} />
        </div>
      </div>
    </AppShell>
  );
}
