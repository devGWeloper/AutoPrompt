'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { LlmModel, ModelRole, ModelSelection } from '@/lib/types';
import { SettingsLink, useLlmModels } from './shared';

/**
 * Per-run model selection, shared by the Single and Compare tabs.
 *
 * What is in the boxes is what the run pins — there is no hidden layer
 * underneath. The boxes start out empty: a role nobody picked is As-is and runs
 * the agent's own config, which is exactly what the empty box reads as. Compare gets one column per
 * side, and that is the only reason a model-vs-model comparison is possible at
 * all: a single global setting would hand both sides the same value.
 *
 * One row per role, one column (model + temperature) per side. A row where the
 * sides differ is tinted: that row is what a comparison tests.
 */

/** Editable fields as text. '' means "not pinned", which is a different thing
 * from 0 — and only a string can hold a half-typed number without snapping.
 *
 * `server` rides along with the model rather than being picked separately: the
 * same model name can be registered on more than one server, and which one it
 * is decides the address the run is sent to. It is set by choosing a model, so
 * there is no way to pin a model to a server it is not registered on. */
export interface ModelDraft {
  model: string;
  server: string;
  temperature: string;
}

export type ModelDrafts = Record<string, ModelDraft>;

export interface ModelColumn {
  key: string;
  /** 'A' / 'B'. Omitted when there is only one column — there is nothing to
   * tell apart, and a header that says "A" implies a B that isn't there. */
  label?: string;
  drafts: ModelDrafts;
  onChange: (next: ModelDrafts) => void;
}

// One role list for the whole app. Single and Compare both stay mounted (see
// app/page.tsx — unmounting would kill a live run's stream), so a per-hook copy
// meant editing a default in one tab left the other tab holding the old list
// until a reload, and running from there quietly pinned the stale value.
let roleCache: ModelRole[] | null = null;
const roleSubs = new Set<(next: ModelRole[]) => void>();

function publishRoles(next: ModelRole[]): void {
  roleCache = next;
  for (const fn of roleSubs) fn(next);
}

/** The registered roles and their defaults, shared across tabs. Empty on any
 * failure — the control then just says so, and the manage dialog is still
 * reachable from it. */
export function useModelRoles(): { roles: ModelRole[]; setRoles: (next: ModelRole[]) => void } {
  const [roles, setRoles] = useState<ModelRole[]>(roleCache ?? []);
  useEffect(() => {
    roleSubs.add(setRoles);
    if (roleCache === null) {
      api.get<ModelRole[]>('/models').then(publishRoles).catch(() => publishRoles([]));
    } else {
      setRoles(roleCache);
    }
    return () => {
      roleSubs.delete(setRoles);
    };
  }, []);
  return { roles, setRoles: publishRoles };
}

const EMPTY_DRAFT: ModelDraft = { model: '', server: '', temperature: '' };

const pinned = (d: ModelDraft) => d.model.trim() !== '' || d.temperature.trim() !== '';

/** Draft rows → what the API takes. Blank rows are dropped rather than sent as
 * empty pins, so the server stores "nothing pinned" as null and the agent falls
 * through to its own config. */
export function toSelection(drafts: ModelDrafts): ModelSelection {
  const out: ModelSelection = {};
  for (const [role, d] of Object.entries(drafts)) {
    if (!pinned(d)) continue;
    const t = d.temperature.trim();
    out[role] = {
      model: d.model.trim() || null,
      server: d.server.trim() || null,
      temperature: t === '' ? null : Number(t),
    };
  }
  return out;
}

/** How one side of a model run is named — in the 띠 chip, the result header and
 * the table columns. Only the roles where this side differs from `other` are
 * named: in a comparison that difference is what the run tests, and repeating
 * what both share would bury it. With no `other` (Single), every picked role is
 * named. Server and temperature appear only when they differ. A role nobody
 * picked runs the agent's own config, read as 'As-is'. */
export function modelLabel(mine: ModelDrafts, other: ModelDrafts = {}): string {
  const a = toSelection(mine);
  const b = toSelection(other);
  const roles = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  const same = (r: string) => JSON.stringify(a[r] ?? null) === JSON.stringify(b[r] ?? null);
  const shown = roles.filter((r) => !same(r));
  const list = shown.length ? shown : Object.keys(a);
  if (!list.length) return 'As-is';
  const text = (r: string) => {
    const m = a[r];
    const o = b[r];
    if (!m) return 'As-is';
    const svr = m.server && m.server !== o?.server ? `@${m.server}` : '';
    const t = m.temperature != null && m.temperature !== o?.temperature ? ` t${m.temperature}` : '';
    return `${m.model ?? 'As-is'}${svr}${t}`;
  };
  return list.length === 1 ? text(list[0]) : list.map((r) => `${r} ${text(r)}`).join(' · ');
}

/** Blocks the run rather than letting a typo through: an out-of-range
 * temperature would otherwise be dropped server-side and the run would quietly
 * use a different one than the screen shows. */
export function modelDraftError(...drafts: ModelDrafts[]): string | null {
  for (const d of drafts) {
    for (const [role, v] of Object.entries(d)) {
      const t = v.temperature.trim();
      if (t === '') continue;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0 || n > 2) {
        return `${role} 의 temperature 는 0 과 2 사이 숫자여야 합니다`;
      }
    }
  }
  return null;
}

const sameDrafts = (a: ModelDrafts, b: ModelDrafts) =>
  JSON.stringify(toSelection(a)) === JSON.stringify(toSelection(b));

export function ModelPicker({
  roles,
  columns,
}: {
  roles: ModelRole[];
  columns: ModelColumn[];
}) {
  // 고를 수 있는 모델 목록. 저장돼 있던 값이 목록에서 빠졌다면 조용히 사라지지
  // 않도록 그 값만 따로 남겨 둔다.
  const catalogAll = useLlmModels();
  const catalog = useMemo(() => catalogAll.filter((m) => m.is_active === 'Y'), [catalogAll]);
  // 서버별로 묶어 보여 준다 — 같은 모델명이 서버마다 떠 있을 수 있어서, 이름만
  // 나열하면 똑같은 줄이 두 개 뜬다.
  const groups = useMemo(() => {
    const m = new Map<string, LlmModel[]>();
    for (const o of catalog) {
      const k = o.server_nm ?? '';
      const cur = m.get(k);
      if (cur) cur.push(o);
      else m.set(k, [o]);
    }
    // 서버 미지정 묶음은 맨 뒤 — 주소가 정해진 것부터 보이는 게 맞다.
    return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [catalog]);
  const grouped = groups.length > 1 || (groups.length === 1 && groups[0][0] !== '');

  /** 초안이 가리키는 목록 줄. 저장돼 있던 값이 목록에서 빠졌으면 MISSING. */
  const optionOf = (d: ModelDraft): LlmModel | null => {
    if (!d.model) return null;
    const exact = catalog.find((o) => o.llm_nm === d.model && (o.server_nm ?? '') === d.server);
    if (exact) return exact;
    // 서버를 안 들고 있는 초안(저장된 role 기본값)은 이름이 하나로 좁혀질 때만
    // 그 줄로 본다. 서버 쪽 스냅샷이 같은 규칙으로 주소를 고른다 (models.ts).
    if (!d.server) {
      const byName = catalog.filter((o) => o.llm_nm === d.model);
      if (byName.length === 1) return byName[0];
    }
    return null;
  };
  const MISSING = '__missing__';
  const valueOf = (d: ModelDraft) => (!d.model ? '' : (optionOf(d)?.llm_id ?? MISSING).toString());
  // 되돌리기는 빈 칸으로 — 아무것도 고르지 않은 As-is 가 출발점이다.
  const dirty = columns.some((c) => !sameDrafts(c.drafts, {}));

  const set = (col: ModelColumn, role: string, patch: Partial<ModelDraft>) =>
    // 폼이 빈 채로 시작하므로 처음 손대는 role 은 줄이 없다 — 빈 줄 위에 얹어야
    // 고르지 않은 칸(temperature 등)이 undefined 로 남지 않는다.
    col.onChange({ ...col.drafts, [role]: { ...EMPTY_DRAFT, ...col.drafts[role], ...patch } });

  const template = `minmax(84px,128px) ${columns.map(() => 'minmax(150px,1fr) 64px').join(' ')}`;
  const compare = columns.length > 1;
  const differsAt = (role: string) => {
    const cells = columns.map((c) => c.drafts[role] ?? EMPTY_DRAFT);
    // 같은 모델이라도 서버가 다르면 다른 실행이다.
    return cells.some(
      (d) =>
        d.model.trim() !== cells[0].model.trim() ||
        d.server.trim() !== cells[0].server.trim() ||
        d.temperature.trim() !== cells[0].temperature.trim(),
    );
  };
  const diffCount = compare ? roles.filter((r) => differsAt(r.role_cd)).length : 0;
  const pickedCount = compare ? 0 : Object.keys(toSelection(columns[0].drafts)).length;

  // No roles registered yet. This only renders under 대상 = 모델, where the
  // whole point is to change a model — so the empty state is the link to where
  // roles are registered, not a sentence about not having any.
  if (roles.length === 0) {
    return <SettingsLink label="설정에서 role 등록" />;
  }

  return (
    <div className={cn('w-full', compare ? 'max-w-[880px]' : 'max-w-[560px]')}>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div
          className="items-center gap-x-3 border-b border-line bg-surface-2 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.6px] text-muted"
          style={{ display: 'grid', gridTemplateColumns: template }}
        >
          <span>Role</span>
          {columns.map((c) => (
            <Fragment key={c.key}>
              {/* 사이드 글자는 결과 머리줄의 A · B 이름표와 같은 모양 — 여기서 고른 것이
                  거기에 그 글자로 적힌다. */}
              <span className="flex items-center gap-1.5">
                {c.label && (
                  <span
                    className={cn(
                      'inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] font-mono text-[10.5px] font-bold normal-case tracking-normal',
                      c.label === 'B' ? 'bg-accent text-white' : 'bg-surface-3 text-body',
                    )}
                  >
                    {c.label}
                  </span>
                )}
                모델
              </span>
              <span className="text-center">Temp</span>
            </Fragment>
          ))}
        </div>
        {roles.map((r) => {
          const cells = columns.map((c) => c.drafts[r.role_cd] ?? EMPTY_DRAFT);
          // The one thing worth marking in a comparison: this role is not the
          // same on both sides, so it is part of what is being tested.
          const differs = compare && differsAt(r.role_cd);
          return (
            <div
              key={r.role_cd}
              className={cn(
                'items-center gap-x-3 border-b border-line px-3 py-1.5 last:border-b-0',
                differs && 'bg-accent-soft/50 shadow-[inset_2px_0_0_#2563eb]',
              )}
              style={{ display: 'grid', gridTemplateColumns: template }}
            >
              <span className={cn('truncate font-mono text-xs', differs ? 'font-semibold text-ink' : 'text-body')}>
                {r.role_cd}
              </span>
              {columns.map((c, i) => {
                const v = valueOf(cells[i]);
                return (
                  <Fragment key={c.key}>
                    {/* 설정에 등록된 모델만 고를 수 있다 — 오타로 존재하지 않는
                        모델을 고정해 버리는 일이 여기서 사라진다. 고른 줄이
                        곧 서버이기도 해서, 주소는 따로 고를 것이 없다.
                        비어 있으면 As-is — 그 role 은 Agent 자기 설정으로 돈다. */}
                    <select
                      value={v}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === MISSING) return;
                        const o = catalog.find((x) => String(x.llm_id) === next);
                        set(c, r.role_cd, o
                          ? { model: o.llm_nm, server: o.server_nm ?? '' }
                          : { model: '', server: '' });
                      }}
                      className={cn(
                        'h-8 w-full rounded-[6px] border bg-surface px-2 font-mono text-xs transition',
                        'hover:border-muted-soft focus:border-accent focus:shadow-ring focus:outline-none',
                        v === MISSING ? 'border-warn' : 'border-line-strong',
                        v === '' ? 'text-muted-soft' : 'font-semibold text-ink',
                      )}
                      title={optionOf(cells[i])?.base_url ?? cells[i].model ?? undefined}
                    >
                      <option value="">As-is</option>
                      {v === MISSING && <option value={MISSING}>{cells[i].model}</option>}
                      {grouped
                        ? groups.map(([svr, items]) => (
                            <optgroup key={svr || '—'} label={svr || '서버 미지정'}>
                              {items.map((o) => (
                                <option key={o.llm_id} value={o.llm_id}>{o.llm_nm}</option>
                              ))}
                            </optgroup>
                          ))
                        : catalog.map((o) => (
                            <option key={o.llm_id} value={o.llm_id}>{o.llm_nm}</option>
                          ))}
                    </select>
                    <Input
                      value={cells[i].temperature}
                      onChange={(e) => set(c, r.role_cd, { temperature: e.target.value })}
                      inputMode="decimal"
                      placeholder="—"
                      className="!h-8 w-full text-center font-mono text-xs"
                    />
                  </Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-caption text-muted">
        {/* 무엇이 갈리는지를 센다 — 비교에서 0 이면 두 사이드가 같은 실행이다. */}
        <span className={cn(compare && diffCount === 0 && 'text-bad')}>
          {compare
            ? diffCount ? `다른 role ${diffCount}` : 'A · B 같음'
            : pickedCount ? `고른 role ${pickedCount}` : '모두 As-is'}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {dirty && (
            <button
              type="button"
              onClick={() => columns.forEach((c) => c.onChange({}))}
              className="shrink-0 transition-colors hover:text-ink"
            >
              ↺ 모두 As-is
            </button>
          )}
          <SettingsLink label="설정" />
        </span>
      </div>
    </div>
  );
}

/** Publish a role list the settings page just saved, so run screens that are
 * already mounted see it without a reload. */
export function setRoleCatalog(next: ModelRole[]): void {
  publishRoles(next);
}
