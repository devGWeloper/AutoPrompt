'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { MODEL_ROLES, MODEL_ROLE_NOTES, type ModelRole, type ModelRoleUpdate } from '@/lib/types';
import { useArmed } from './shared';

/**
 * The rarely-touched half of model configuration: which roles exist at all, and
 * what each one's box starts out holding. Reached from inside the run tabs so
 * there is still only one place on screen that talks about models — a separate
 * top-level page for this read as a second, competing setting.
 *
 * The role list mirrors the agent's LLMModel enum, so it changes when that does
 * and not otherwise. Everything about an individual run lives in the form
 * behind this dialog.
 */

const ROLE_RE = /^[A-Za-z0-9_.-]+$/;

interface Draft {
  model_nm: string;
  temperature: string;
  description: string;
}

const toDraft = (m: ModelRole): Draft => ({
  model_nm: m.model_nm ?? '',
  temperature: m.temperature === null ? '' : String(m.temperature),
  description: m.description ?? '',
});

const same = (a: Draft, b: Draft) =>
  a.model_nm === b.model_nm && a.temperature === b.temperature && a.description === b.description;

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { detail?: unknown } | string;
    if (typeof d === 'string') return d;
    if (d && typeof d.detail === 'string') return d.detail;
    return JSON.stringify(e.detail);
  }
  return String(e);
}

/** Arm-then-confirm rather than a second modal on top of this one. */
function DeleteRole({ onDelete, disabled }: { onDelete: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useArmed();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (armed ? onDelete() : setArmed(true))}
      className={cn(
        'ml-auto shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-medium transition-colors',
        armed ? 'bg-bad/10 text-bad' : 'text-muted hover:text-bad',
      )}
    >
      {armed ? '한 번 더 눌러 삭제' : '삭제'}
    </button>
  );
}

export function ModelRolesModal({
  roles,
  onClose,
  onSaved,
}: {
  roles: ModelRole[];
  onClose: () => void;
  /** The new list, after any add / delete / save. */
  onSaved: (next: ModelRole[]) => void;
}) {
  const [list, setList] = useState<ModelRole[]>(roles);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(roles.map((m) => [m.role_cd, toDraft(m)])),
  );
  const [newRole, setNewRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (next: ModelRole[]) => {
    setList(next);
    setDrafts(Object.fromEntries(next.map((m) => [m.role_cd, toDraft(m)])));
    onSaved(next);
  };

  const dirty = list.filter((m) => drafts[m.role_cd] && !same(drafts[m.role_cd], toDraft(m)));

  const name = newRole.trim();
  const duplicate = useMemo(() => list.some((m) => m.role_cd === name), [list, name]);
  const badChars = name !== '' && !ROLE_RE.test(name);
  const canAdd = name !== '' && !duplicate && !badChars && name.length <= 30 && !busy;

  const edit = (role: string, patch: Partial<Draft>) =>
    setDrafts((cur) => ({ ...cur, [role]: { ...cur[role], ...patch } }));

  async function run(fn: () => Promise<ModelRole[]>) {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const items: ModelRoleUpdate[] = [];
    for (const m of dirty) {
      const d = drafts[m.role_cd];
      const t = d.temperature.trim();
      let temp: number | null = null;
      if (t !== '') {
        const n = Number(t);
        // Caught here as well as in the service so a typo never reaches a run.
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
    await run(() => api.put<ModelRole[]>('/models', { items }));
  }

  return (
    <Modal
      open
      title="Role 과 기본값"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-muted">
            {dirty.length > 0 ? `${dirty.length}개 변경됨` : '변경사항 없음'}
          </span>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={save} disabled={busy || dirty.length === 0}>
            저장
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 rounded-md border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">{error}</div>}

      <p className="mb-3 text-xs leading-relaxed text-muted">
        에이전트 <span className="font-mono">LLMModel</span> enum 에 있는 role 목록입니다. 여기 기본값은{' '}
        <span className="text-ink/70">실행 탭의 모델 칸이 처음에 무엇을 들고 열릴지</span>만 정합니다 — 저장한다고
        무언가 실행되지는 않습니다. endpoint 와 API key 는 role 공통이라 에이전트 config 에 그대로 둡니다.
      </p>

      {list.length === 0 ? (
        <div className="rounded-md border border-line bg-surface-2/50 px-4 py-6 text-center">
          <p className="text-sm text-ink">등록된 role 이 없습니다.</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            <span className="font-mono">sql/migrate_model_mas.sql</span> 을 실행하면 기본 role(
            {MODEL_ROLES.join(' / ')})이 들어갑니다. DB 가 연결돼 있지 않아도 비어 보입니다.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {list.map((m) => {
            const d = drafts[m.role_cd] ?? toDraft(m);
            const note = MODEL_ROLE_NOTES[m.role_cd];
            return (
              <div key={m.role_cd} className="py-3 first:pt-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">{m.role_cd}</span>
                  {note && <span className="min-w-0 truncate text-[11px] text-muted">{note}</span>}
                  <DeleteRole
                    disabled={busy}
                    onDelete={() =>
                      run(() => api.del<ModelRole[]>(`/models/${encodeURIComponent(m.role_cd)}`))
                    }
                  />
                </div>
                <div className="mt-1.5 grid grid-cols-[1fr_60px] gap-2">
                  <Input
                    value={d.model_nm}
                    onChange={(e) => edit(m.role_cd, { model_nm: e.target.value })}
                    placeholder="기본 모델명 — 비우면 실행 탭도 빈 칸으로 시작"
                    className="w-full font-mono text-xs"
                  />
                  <Input
                    value={d.temperature}
                    onChange={(e) => edit(m.role_cd, { temperature: e.target.value })}
                    inputMode="decimal"
                    placeholder="Temp"
                    className="w-full text-center font-mono text-xs"
                  />
                </div>
                <Input
                  value={d.description}
                  onChange={(e) => edit(m.role_cd, { description: e.target.value })}
                  placeholder="메모 — 어디에 쓰는 role 인지 (선택)"
                  className="mt-1.5 w-full text-xs"
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="flex gap-2">
          <Input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="추가할 role 이름"
            className="min-w-0 flex-1 font-mono text-xs"
          />
          <Button
            onClick={() =>
              run(async () => {
                const next = await api.post<ModelRole[]>('/models', { role_cd: name });
                setNewRole('');
                return next;
              })
            }
            disabled={!canAdd}
          >
            추가
          </Button>
        </div>
        {duplicate && <p className="mt-1 text-xs text-bad">이미 있는 role 이름입니다.</p>}
        {badChars && <p className="mt-1 text-xs text-bad">영문·숫자와 _ . - 만 쓸 수 있습니다 (공백 불가).</p>}
        {name.length > 30 && <p className="mt-1 text-xs text-bad">최대 30자입니다.</p>}
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          에이전트 <span className="font-mono">LLMModel</span> enum 의 <strong>멤버 이름</strong>과 글자까지 같아야
          합니다 (<span className="font-mono">LLM</span>, <span className="font-mono">VLM</span> 처럼 대문자일 수
          있습니다). 한 글자라도 다르면 에이전트가 읽지 않아, 화면에는 설정된 것처럼 보이지만 실제로는 아무 데도
          쓰이지 않습니다.
        </p>
      </div>
    </Modal>
  );
}
