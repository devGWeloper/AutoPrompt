'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { TestCase } from '@/lib/types';
import { parseCaseInput } from './caseFields';
import { ErrBox, errText, folderLabel, oneLine, UNFILED } from './shared';

function Box({
  checked, indeterminate, onChange, label,
}: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
    />
  );
}

/**
 * Pick which cases of the chosen dataset (and folder, when one is chosen) a
 * run covers. Applying with every case ticked hands back null — that run is the
 * folder run, and should be recorded as one.
 */
export default function CasePickerModal({
  datasetId, caseType, value, onClose, onApply,
}: {
  datasetId: number;
  /** The run form's folder. null = the whole dataset. */
  caseType: string | null;
  value: Set<number> | null;
  onClose: () => void;
  onApply: (ids: Set<number> | null) => void;
}) {
  const [cases, setCases] = useState<TestCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(value ?? []));

  useEffect(() => {
    let alive = true;
    api.get<TestCase[]>(`/datasets/${datasetId}/cases`)
      .then((cs) => { if (alive) setCases(cs); })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [datasetId]);

  const inScope = useMemo(
    () =>
      (cases ?? [])
        .filter((c) => caseType === null || (c.case_type || UNFILED) === caseType)
        .map((c, i) => {
          const p = parseCaseInput(c.input_data);
          return { c, n: i + 1, question: p.question, gt: (p.groundTruth ?? c.expected_output ?? '').trim() };
        }),
    [cases, caseType],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return inScope;
    return inScope.filter((r) => r.question.toLowerCase().includes(needle) || r.gt.toLowerCase().includes(needle));
  }, [inScope, q]);

  // 데이터셋 전체에서 고를 때는 폴더별로 묶는다 — 데이터셋 화면과 같은 차례로.
  const groups = useMemo(() => {
    if (caseType !== null) return [{ cat: null as string | null, items: shown }];
    const by = new Map<string, typeof shown>();
    for (const r of shown) {
      const k = r.c.case_type || UNFILED;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    const keys = [...by.keys()].sort((a, b) => (a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)));
    return keys.map((cat) => ({ cat: cat as string | null, items: by.get(cat)! }));
  }, [shown, caseType]);

  const count = inScope.filter((r) => picked.has(r.c.case_id)).length;
  const shownPicked = shown.filter((r) => picked.has(r.c.case_id)).length;
  const allShown = shown.length > 0 && shownPicked === shown.length;

  function toggle(ids: number[], on: boolean) {
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function apply() {
    const ids = inScope.map((r) => r.c.case_id).filter((id) => picked.has(id));
    onApply(ids.length === inScope.length ? null : new Set(ids));
    onClose();
  }

  return (
    <Modal
      open
      title="케이스 선택"
      onClose={onClose}
      width="w-[820px]"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">
            <span className="font-semibold tabular-nums text-ink">{count}</span> / {inScope.length}건
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>취소</Button>
          <Button size="sm" disabled={count === 0} onClick={apply}>
            {count === inScope.length ? '전체 실행' : `${count}건만 실행`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrBox msg={error} />}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-8 cursor-pointer items-center gap-2.5 pl-3 text-xs text-muted">
            <Box
              label="보이는 케이스 전체 선택"
              checked={allShown}
              indeterminate={shownPicked > 0 && !allShown}
              onChange={() => toggle(shown.map((r) => r.c.case_id), !allShown)}
            />
            {q.trim() ? `검색 결과 ${shown.length}건` : `${caseType === null ? '전체' : folderLabel(caseType)} ${shown.length}건`}
          </label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="질문 · 정답 검색"
            className="ml-auto h-8 w-56 text-xs"
          />
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-sm border border-line">
          {cases === null && !error ? (
            <div className="py-10 text-center text-xs text-muted">불러오는 중…</div>
          ) : shown.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">{inScope.length === 0 ? '케이스가 없습니다' : '검색 결과 없음'}</div>
          ) : (
            <ul className="divide-y divide-line">
              {groups.map(({ cat, items }) => {
                const ids = items.map((r) => r.c.case_id);
                const n = ids.filter((id) => picked.has(id)).length;
                return (
                  <li key={cat ?? '_'}>
                    {cat !== null && (
                      <label className="sticky top-0 z-[1] flex cursor-pointer items-center gap-2.5 border-b border-line bg-surface-2 px-3 py-1.5">
                        <Box
                          label={`${folderLabel(cat)} 전체 선택`}
                          checked={n === ids.length}
                          indeterminate={n > 0 && n < ids.length}
                          onChange={() => toggle(ids, n < ids.length)}
                        />
                        <span className="text-[11px] font-semibold text-ink">{folderLabel(cat)}</span>
                        <span className="font-mono text-[10px] tabular-nums text-muted-soft">{n}/{ids.length}</span>
                      </label>
                    )}
                    <ul className="divide-y divide-line">
                      {items.map((r) => {
                        const on = picked.has(r.c.case_id);
                        return (
                          <li key={r.c.case_id}>
                            <label
                              className={cn(
                                'grid cursor-pointer grid-cols-[14px_26px_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-x-2.5 px-3 py-2 transition-colors hover:bg-surface-2/60',
                                on && 'bg-surface-2/70',
                              )}
                            >
                              <Box label="선택" checked={on} onChange={() => toggle([r.c.case_id], !on)} />
                              <span className="font-mono text-[11px] tabular-nums text-muted">{r.n}</span>
                              <span className="truncate text-sm text-ink">
                                {r.question || <span className="text-muted">(질문 없음)</span>}
                              </span>
                              <span className="truncate text-xs text-muted">
                                {r.gt ? oneLine(r.gt) : <span className="text-muted-soft">정답 없음</span>}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
