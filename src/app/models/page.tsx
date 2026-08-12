'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/ui/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import { MODEL_ROLES, MODEL_ROLE_NOTES, type ModelRole, type ModelRoleUpdate } from '@/lib/types';

// One row per LLM role the external agent's config defines. Rows are seeded by
// the DDL and only edited here — no add/delete, because the set of roles is the
// agent's to decide, not ours.

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

  const list = rows ?? [];

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex-1 overflow-auto [scrollbar-gutter:stable]">
        <div className={cn(SHELL, 'px-6 py-5')}>
          {error && (
            <div className="mb-4 rounded-sm border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</div>
          )}

          <div className="mb-5">
            <h1 className="text-lg font-semibold text-ink">
              Model roles <span className="text-muted">({list.length})</span>
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              외부 에이전트 config 의 LLM role 별 모델을 지정합니다. endpoint 와 API key 는 role 4종이 공통으로
              쓰므로 에이전트 config 에 그대로 둡니다.
            </p>
          </div>

          {rows !== null && list.length === 0 ? (
            <div className="rounded-md border border-line bg-surface px-4 py-8 text-center">
              <p className="text-sm text-ink">등록된 role 이 없습니다.</p>
              <p className="mt-1.5 text-xs text-muted">
                <span className="font-mono">sql/migrate_model_mas.sql</span> 을 실행해 role
                ({MODEL_ROLES.join(' / ')})을 넣으세요. DB 가 연결돼 있지 않아도 이 화면은 비어 보입니다.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="grid grid-cols-[minmax(140px,180px)_minmax(200px,1.4fr)_92px_minmax(160px,1fr)] gap-x-4 border-b border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">
                <span>Role</span>
                <span>모델명</span>
                <span>Temp</span>
                <span>메모</span>
              </div>
              {list.map((m) => {
                const d = drafts[m.role_cd] ?? toDraft(m);
                const changed = !same(d, toDraft(m));
                const note = MODEL_ROLE_NOTES[m.role_cd];
                return (
                  <div
                    key={m.role_cd}
                    className={cn(
                      'grid grid-cols-[minmax(140px,180px)_minmax(200px,1.4fr)_92px_minmax(160px,1fr)] items-start gap-x-4 border-b border-line px-4 py-3 last:border-b-0',
                      changed && 'bg-accent-soft/30',
                    )}
                  >
                    <div className="pt-2.5">
                      <span className="font-mono text-sm font-semibold text-ink">{m.role_cd}</span>
                      {note && <p className="mt-1 text-[11px] leading-snug text-muted">{note}</p>}
                    </div>
                    <Input
                      value={d.model_nm}
                      onChange={(e) => edit(m.role_cd, { model_nm: e.target.value })}
                      placeholder="비우면 에이전트 config 기본값"
                      className="w-full font-mono"
                    />
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
            저장한 값은 에이전트가 <span className="font-mono">ROLE_CD</span> 로 읽어 자기 config 의 모델명을
            덮어씁니다. <span className="font-mono">ROLE_CD</span> 는 에이전트{' '}
            <span className="font-mono">LLMModel</span> enum 의 value 와 글자까지 같아야 하며, 반영 시점은
            에이전트 쪽 구현에 달려 있습니다 (<span className="font-mono">docs/model-roles-agent.md</span>).
          </p>
        </div>
      </main>
    </div>
  );
}
