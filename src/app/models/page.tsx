'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/ui/TopBar';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import { MODEL_ROLES, MODEL_ROLE_NOTES, type ModelRole } from '@/lib/types';
import type { ModelRoleUpdate } from '@/lib/types';

// One row per LLM role the external agent's config defines. The DDL seeds the
// roles that exist today; add/delete is for when the agent's LLMModel enum grows
// or shrinks. The role name is the whole contract with the agent, so it is the
// one thing the add dialog makes noise about.

const GRID =
  'grid grid-cols-[minmax(140px,180px)_minmax(200px,1.4fr)_92px_minmax(160px,1fr)_44px] gap-x-4';

/** Editable fields as text: '' means "unset", which the agent reads as "use the
 * model name in my own config". */
interface Draft {
  model_nm: string;
  temperature: string;
  description: string;
}

function toDraft(m: ModelRole): Draft {
  return {
    model_nm: m.model_nm ?? '',
    temperature: m.temperature === null ? '' : String(m.temperature),
    description: m.description ?? '',
  };
}

function same(a: Draft, b: Draft): boolean {
  return a.model_nm === b.model_nm && a.temperature === b.temperature && a.description === b.description;
}

/** ISO string → 'YYYY-MM-DD HH:MM'. The seconds are noise on a settings row. */
function fmtTime(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '';
}

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { detail?: unknown } | string;
    if (typeof d === 'string') return d;
    if (d && typeof d.detail === 'string') return d.detail;
    return JSON.stringify(e.detail);
  }
  return String(e);
}

export default function ModelsPage() {
  const [rows, setRows] = useState<ModelRole[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ModelRole | null>(null);

  const apply = useCallback((list: ModelRole[]) => {
    setRows(list);
    setDrafts(Object.fromEntries(list.map((m) => [m.role_cd, toDraft(m)])));
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.get<ModelRole[]>('/models'));
    } catch (e) {
      setRows([]);
      setError(errText(e));
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => (rows ?? []).filter((m) => drafts[m.role_cd] && !same(drafts[m.role_cd], toDraft(m))),
    [rows, drafts],
  );

  /** How many roles actually have a model pinned — the rest run the agent's own default. */
  const assigned = useMemo(() => (rows ?? []).filter((m) => m.model_nm).length, [rows]);

  function edit(role: string, patch: Partial<Draft>) {
    setSaved(false);
    setDrafts((cur) => ({ ...cur, [role]: { ...cur[role], ...patch } }));
  }

  function reset() {
    if (rows) apply(rows);
    setError(null);
    setSaved(false);
  }

  async function save() {
    const items: ModelRoleUpdate[] = [];
    for (const m of dirty) {
      const d = drafts[m.role_cd];
      const t = d.temperature.trim();
      let temp: number | null = null;
      if (t !== '') {
        const n = Number(t);
        // Rejected here as well as in the service so a typo never reaches a run:
        // an out-of-range temperature would otherwise be saved and silently
        // change every answer the agent produces.
        if (!Number.isFinite(n) || n < 0 || n > 2) {
          setError(`${m.role_cd} 의 temperature 는 0 과 2 사이 숫자여야 합니다.`);
          return;
        }
        temp = n;
      }
      items.push({
        role_cd: m.role_cd,
        model_nm: d.model_nm.trim() || null,
        temperature: temp,
        description: d.description.trim() || null,
      });
    }

    setBusy(true);
    setError(null);
    try {
      apply(await api.put<ModelRole[]>('/models', { items }));
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    setError(null);
    try {
      apply(await api.del<ModelRole[]>(`/models/${encodeURIComponent(confirmDelete.role_cd)}`));
      setConfirmDelete(null);
      setSaved(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const list = rows ?? [];

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex-1 overflow-auto [scrollbar-gutter:stable]">
        <div className={cn(SHELL, 'px-6 py-5')}>
          {error && (
            <div className="mb-4 rounded-sm border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</div>
          )}

          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-ink">
                Model roles{' '}
                <span className="text-muted">
                  ({list.length}
                  {list.length > 0 && ` · ${assigned}개 지정됨`})
                </span>
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                외부 에이전트 config 의 LLM role 별 모델을 지정합니다. 저장한 값은 계속 유지되며, 에이전트가
                테스트 호출마다 이 값을 읽어 씁니다. endpoint 와 API key 는 role 이 공통으로 쓰므로 에이전트
                config 에 그대로 둡니다.
              </p>
            </div>
            <Button onClick={() => setShowNew(true)}>+ role 추가</Button>
          </div>

          {rows !== null && list.length === 0 ? (
            <div className="rounded-md border border-line bg-surface px-4 py-8 text-center">
              <p className="text-sm text-ink">등록된 role 이 없습니다.</p>
              <p className="mt-1.5 text-xs text-muted">
                <span className="font-mono">sql/migrate_model_mas.sql</span> 을 실행하면 기본 role(
                {MODEL_ROLES.join(' / ')})이 들어갑니다. DB 가 연결돼 있지 않아도 이 화면은 비어 보입니다.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <div
                className={cn(
                  GRID,
                  'border-b border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted',
                )}
              >
                <span>Role</span>
                <span>모델명</span>
                <span>Temp</span>
                <span>메모</span>
                <span />
              </div>
              {list.map((m) => {
                const d = drafts[m.role_cd] ?? toDraft(m);
                const changed = !same(d, toDraft(m));
                const note = MODEL_ROLE_NOTES[m.role_cd];
                return (
                  <div
                    key={m.role_cd}
                    className={cn(
                      GRID,
                      'items-start border-b border-line px-4 py-3 last:border-b-0',
                      changed && 'bg-accent-soft/30',
                    )}
                  >
                    <div className="pt-2.5">
                      <span className="font-mono text-sm font-semibold text-ink">{m.role_cd}</span>
                      {note && <p className="mt-1 text-[11px] leading-snug text-muted">{note}</p>}
                    </div>
                    {/* The box holds the draft, so once you start typing it no longer
                        shows what is actually stored. The line under it always does —
                        that is also where "this persists" becomes visible. */}
                    <div>
                      <Input
                        value={d.model_nm}
                        onChange={(e) => edit(m.role_cd, { model_nm: e.target.value })}
                        placeholder="비우면 에이전트 config 기본값"
                        className="w-full font-mono"
                      />
                      <p className="mt-1 text-[11px] leading-snug text-muted">
                        {changed ? (
                          <>
                            현재 저장값{' '}
                            <span className="font-mono text-ink/70">{m.model_nm ?? '없음'}</span>
                            {' — 저장하면 교체됩니다'}
                          </>
                        ) : m.model_nm ? (
                          <>저장됨{fmtTime(m.updated_dt ?? m.created_dt) && ` · ${fmtTime(m.updated_dt ?? m.created_dt)}`}</>
                        ) : (
                          <>저장값 없음 — 에이전트 config 의 기본 모델로 실행됩니다</>
                        )}
                      </p>
                    </div>
                    <Input
                      value={d.temperature}
                      onChange={(e) => edit(m.role_cd, { temperature: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.1"
                      className="w-full text-center font-mono"
                    />
                    <Input
                      value={d.description}
                      onChange={(e) => edit(m.role_cd, { description: e.target.value })}
                      placeholder="어디에 쓰는 role 인지"
                      className="w-full"
                    />
                    <button
                      onClick={() => setConfirmDelete(m)}
                      title={`${m.role_cd} 삭제`}
                      className="mt-1 h-8 rounded-md border border-line bg-surface text-[11px] font-medium text-muted transition-colors hover:border-bad/40 hover:bg-bad/5 hover:text-bad"
                    >
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {list.length > 0 && (
            <div className="mt-4 flex items-center justify-end gap-3">
              <span className="text-xs text-muted">
                {dirty.length > 0
                  ? `${dirty.length}개 role 변경됨`
                  : saved
                    ? '저장되었습니다.'
                    : '변경사항 없음'}
              </span>
              <Button variant="secondary" onClick={reset} disabled={busy || dirty.length === 0}>
                되돌리기
              </Button>
              <Button onClick={save} disabled={busy || dirty.length === 0}>
                저장
              </Button>
            </div>
          )}

          <p className="mt-6 text-xs leading-relaxed text-muted">
            모델을 바꾸는 곳은 여기 하나입니다. 저장한 값은{' '}
            <strong className="font-medium text-ink/70">여기서 실행하는 호출에만</strong> 적용되고 운영
            트래픽은 영향받지 않습니다. Compare 에서는 <strong className="font-medium text-ink/70">A</strong> 가
            이 값으로, <strong className="font-medium text-ink/70">B</strong> 는 에이전트 config 그대로
            실행되므로 그대로 &ldquo;변경안 vs 현행&rdquo; 비교가 됩니다. role 이름은 에이전트{' '}
            <span className="font-mono">LLMModel</span> enum 의 멤버 이름과 글자까지 같아야 합니다
            (<span className="font-mono">docs/model-roles-agent.md</span>).
          </p>
        </div>
      </main>

      {showNew && (
        <NewRoleModal
          existing={list.map((m) => m.role_cd)}
          onClose={() => setShowNew(false)}
          onCreated={(next) => {
            apply(next);
            setShowNew(false);
            setSaved(false);
          }}
        />
      )}

      <Modal
        open={!!confirmDelete}
        title="role 삭제"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              취소
            </Button>
            <Button variant="danger" onClick={doDelete} disabled={busy}>
              삭제
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          <span className="font-mono font-semibold">{confirmDelete?.role_cd}</span> 를 삭제합니다.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          에이전트는 이 role 을 자기 config 의 기본 모델로 계속 실행합니다 — 노드가 멈추지는 않습니다.
          여기서 지정했던 모델명은 사라지며, 되돌리려면 같은 이름으로 다시 추가해야 합니다.
        </p>
      </Modal>
    </div>
  );
}

function NewRoleModal({
  existing,
  onClose,
  onCreated,
}: {
  existing: string[];
  onClose: () => void;
  onCreated: (next: ModelRole[]) => void;
}) {
  const [roleCd, setRoleCd] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const name = roleCd.trim();
  const duplicate = useMemo(() => existing.includes(name), [existing, name]);
  // Mirrors the service's rule; catching it here keeps the dialog from bouncing
  // off a 400 for something visible in the box.
  const badChars = name !== '' && !/^[A-Za-z0-9_.-]+$/.test(name);
  const valid = name !== '' && !duplicate && !badChars && name.length <= 30;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      onCreated(await api.post<ModelRole[]>('/models', { role_cd: name, model_nm: model.trim() || null }));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="role 추가"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={!valid || busy}>
            추가
          </Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-md border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">{err}</div>}
      <label className="mb-3 block">
        <span className="text-sm font-medium text-ink">Role 이름 (ROLE_CD) *</span>
        <Input
          value={roleCd}
          onChange={(e) => setRoleCd(e.target.value)}
          placeholder="e.g. light_llm"
          className="mt-1 w-full font-mono"
        />
        <span className="mt-1.5 block text-xs leading-relaxed text-muted">
          에이전트 <span className="font-mono">LLMModel</span> enum 의 <strong>멤버 이름</strong>과 글자까지
          같아야 합니다 (<span className="font-mono">LLM</span>, <span className="font-mono">VLM</span> 처럼
          대문자일 수 있습니다). 한 글자라도 다르면 에이전트가 이 행을 읽지 않아, 화면에는 설정된 것처럼
          보이지만 실제로는 아무 데도 쓰이지 않습니다.
        </span>
        {duplicate && <span className="mt-1 block text-xs text-bad">이미 있는 role 이름입니다.</span>}
        {badChars && (
          <span className="mt-1 block text-xs text-bad">영문·숫자와 _ . - 만 쓸 수 있습니다 (공백 불가).</span>
        )}
        {name.length > 30 && <span className="mt-1 block text-xs text-bad">최대 30자입니다.</span>}
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">모델명</span>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="비우면 에이전트 config 기본값"
          className="mt-1 w-full font-mono"
        />
      </label>
    </Modal>
  );
}
