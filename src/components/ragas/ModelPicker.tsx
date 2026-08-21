'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ModelRole, ModelSelection } from '@/lib/types';
import { SettingsLink, useLlmModels } from './shared';

/**
 * Per-run model selection, shared by the Single and Compare tabs.
 *
 * What is in the boxes is what the run pins — there is no hidden layer
 * underneath. The boxes start out holding the saved defaults, so leaving them
 * alone runs those; clearing one hands that role back to the agent's own config,
 * which is exactly what the empty box reads as. Compare gets one column per
 * side, and that is the only reason a model-vs-model comparison is possible at
 * all: a single global setting would hand both sides the same value.
 *
 * Collapsed by default. Most runs never touch it, and a run form that opens with
 * a grid of eight boxes reads as eight decisions to make.
 */

/** Editable fields as text. '' means "not pinned", which is a different thing
 * from 0 — and only a string can hold a half-typed number without snapping. */
export interface ModelDraft {
  model: string;
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

/** Every registered role, with nothing pinned. Which model a role runs is
 * decided per test, so a run form opens empty and an untouched box means the
 * agent's own config — the same thing the empty box says. */
export function draftsFromRoles(roles: ModelRole[]): ModelDrafts {
  return Object.fromEntries(roles.map((r) => [r.role_cd, { model: '', temperature: '' }]));
}

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
      temperature: t === '' ? null : Number(t),
    };
  }
  return out;
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

/** One column's pins as a single line. */
function pinText(drafts: ModelDrafts): string {
  const parts = Object.entries(drafts)
    .filter(([, d]) => pinned(d))
    .map(([role, d]) => {
      const t = d.temperature.trim();
      return `${role}=${d.model.trim() || '기본값'}${t ? ` (t${t})` : ''}`;
    });
  return parts.length ? parts.join(' · ') : '에이전트 config 기본값';
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
  // Open from the start. This only renders when 대상 is 모델 — i.e. the models
  // *are* what the run is testing — so hiding them behind a '변경' click would
  // hide the one thing on screen that matters.
  const [open, setOpen] = useState(true);
  // 고를 수 있는 모델 목록. 저장돼 있던 값이 목록에서 빠졌다면 조용히 사라지지
  // 않도록 그 값만 따로 남겨 둔다.
  const catalogAll = useLlmModels();
  const catalog = useMemo(() => catalogAll.filter((m) => m.is_active === 'Y'), [catalogAll]);
  const catalogMissing = (v: string) => v !== '' && !catalog.some((o) => o.llm_nm === v);
  const blank = useMemo(() => draftsFromRoles(roles), [roles]);
  const dirty = columns.some((c) => !sameDrafts(c.drafts, blank));
  // Two columns holding the same thing is the ordinary case (both pre-filled
  // from the same defaults), and saying it once is shorter and clearer than saying it
  // twice — the point of the line is whether the sides differ.
  const identical = columns.length > 1 && columns.every((c) => sameDrafts(c.drafts, columns[0].drafts));

  const set = (col: ModelColumn, role: string, patch: Partial<ModelDraft>) =>
    col.onChange({ ...col.drafts, [role]: { ...col.drafts[role], ...patch } });

  const template = `minmax(84px,116px) ${columns.map(() => 'minmax(130px,1fr) 62px').join(' ')}`;

  // No roles registered yet. This only renders under 대상 = 모델, where the
  // whole point is to change a model — so the empty state is the link to where
  // roles are registered, not a sentence about not having any.
  if (roles.length === 0) {
    return <SettingsLink label="설정에서 role 등록" />;
  }

  return (
    <>
      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        {identical || columns.length === 1 ? (
          <>
            {identical && <span className="mr-1.5 text-muted/70">A · B 동일</span>}
            {pinText(columns[0].drafts)}
          </>
        ) : (
          columns.map((c, i) => (
            <Fragment key={c.key}>
              {i > 0 && <span className="mx-1.5 text-muted/50">·</span>}
              <span className="font-semibold text-ink/70">{c.label} </span>
              {pinText(c.drafts)}
            </Fragment>
          ))
        )}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 text-xs font-medium text-muted transition-colors hover:text-ink"
      >
        {open ? '접기' : '변경'}
      </button>

      {open && (
        <div className="w-full pb-1 pt-1">
          <div className="overflow-hidden rounded-sm border border-line bg-surface">
            <div
              className="gap-x-3 border-b border-line bg-surface-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.6px] text-muted"
              style={{ display: 'grid', gridTemplateColumns: template }}
            >
              <span>Role</span>
              {columns.map((c) => (
                <Fragment key={c.key}>
                  <span>{c.label ? `${c.label} 모델명` : '모델명'}</span>
                  <span className="text-center">Temp</span>
                </Fragment>
              ))}
            </div>
            {roles.map((r) => {
              const cells = columns.map((c) => c.drafts[r.role_cd] ?? { model: '', temperature: '' });
              // The one thing worth marking in a comparison: this role is not
              // the same on both sides, so it is part of what is being tested.
              const differs = cells.some((d) => d.model.trim() !== cells[0].model.trim() || d.temperature.trim() !== cells[0].temperature.trim());
              return (
                <div
                  key={r.role_cd}
                  className="items-center gap-x-3 border-b border-line px-3 py-2 last:border-b-0"
                  style={{ display: 'grid', gridTemplateColumns: template }}
                >
                  <span
                    className={cn('truncate font-mono text-xs', differs ? 'font-semibold text-ink' : 'text-muted')}
                    title={r.description ?? undefined}
                  >
                    {r.role_cd}
                  </span>
                  {columns.map((c, i) => (
                    <Fragment key={c.key}>
                      {/* 설정에 등록된 모델만 고를 수 있다 — 오타로 존재하지 않는
                          모델을 고정해 버리는 일이 여기서 사라진다. */}
                      <select
                        value={cells[i].model}
                        onChange={(e) => set(c, r.role_cd, { model: e.target.value })}
                        className={cn(
                          'h-9 w-full rounded-sm border bg-surface px-2 font-mono text-xs text-ink transition',
                          'hover:border-line-strong focus:border-ink focus:shadow-ring focus:outline-none',
                          catalogMissing(cells[i].model) ? 'border-warn' : 'border-line',
                        )}
                        title={cells[i].model || 'config 기본값'}
                      >
                        <option value="">—</option>
                        {catalogMissing(cells[i].model) && <option value={cells[i].model}>{cells[i].model}</option>}
                        {catalog.map((o) => (
                          <option key={o.llm_id} value={o.llm_nm}>{o.llm_nm}</option>
                        ))}
                      </select>
                      <Input
                        value={cells[i].temperature}
                        onChange={(e) => set(c, r.role_cd, { temperature: e.target.value })}
                        inputMode="decimal"
                        placeholder="—"
                        className="w-full text-center font-mono text-xs"
                      />
                    </Fragment>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-3">
            {dirty && (
              <button
                type="button"
                title="모두 비우기"
                onClick={() => columns.forEach((c) => c.onChange(draftsFromRoles(roles)))}
                className="shrink-0 text-caption text-muted transition-colors hover:text-ink"
              >
                ↺ 비우기
              </button>
            )}
            <SettingsLink label="설정" />
          </div>
        </div>
      )}

    </>
  );
}
