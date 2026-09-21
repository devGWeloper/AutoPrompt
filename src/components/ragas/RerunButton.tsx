'use client';

import { useState, type MouseEvent } from 'react';
import { readActiveRun } from '@/lib/activeRun';
import { cn } from '@/lib/cn';
import {
  COMPARE_ATTACH_EVENT, mismatchCount, SINGLE_ATTACH_EVENT, startAbMismatchRerun, startMismatchRerun,
} from '@/lib/rerun';
import type { RagasRunDetail } from '@/lib/types';
import { errText, useEndpoints, type Picking } from './shared';

/**
 * 이 실행을 그 자리에서 다시 돌린다 — 불일치 케이스만, 또는 고른 케이스만.
 *
 * 새 실행이 아니라 재실행이다: 기록은 한 줄 그대로고 다시 돌린 케이스의 결과만
 * 덮인다. 어디서 누르든(실행 직후 결과, 메인 화면의 지난 실행, 실행 기록) 진행은
 * 그 종류의 탭에서 실시간으로 보인다 — 버튼은 실행을 되돌려 놓고 알리기만 하고,
 * 스트림은 탭이 붙는다.
 *
 * `detailB` 가 있으면 Compare: 두 사이드 중 한쪽이라도 불일치였던 케이스로 A·B 를
 * 함께 다시 돌린다. 불일치가 없으면 아무것도 그리지 않는다.
 */
export default function RerunButton({
  detail, detailB, className, picking,
}: {
  detail: RagasRunDetail;
  detailB?: RagasRunDetail | null;
  className?: string;
  /** 케이스 목록에서 고른 것 — 있으면 '선택 재테스트' 가 함께 선다. */
  picking?: Picking;
}) {
  const endpoints = useEndpoints();
  const [busy, setBusy] = useState<'picked' | 'mismatch' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const compare = detailB != null;
  const n = mismatchCount(detail, detailB);
  const picked = picking ? Array.from(picking.picked) : [];
  // 고를 수 있는 목록이 있으면 '선택 재테스트' 는 늘 서 있다 — 아무것도 고르지 않았을
  // 때 숨겨 두면, 케이스를 골라야 그런 기능이 있다는 걸 알게 되는 순서가 거꾸로다.
  if (n === 0 && !picking) return null;

  async function start(e: MouseEvent, caseIds?: number[]) {
    e.stopPropagation();
    setErr(null);
    if (readActiveRun(compare ? 'compare' : 'single')) {
      setErr(`${compare ? 'Compare' : 'Single'} 탭에서 진행 중인 테스트가 끝난 뒤 다시 시도해 주세요`);
      return;
    }
    setBusy(caseIds ? 'picked' : 'mismatch');
    try {
      if (compare) {
        const active = await startAbMismatchRerun(detail, detailB!, endpoints, caseIds);
        window.dispatchEvent(new CustomEvent(COMPARE_ATTACH_EVENT, { detail: active }));
      } else {
        const active = await startMismatchRerun(detail, endpoints, caseIds);
        window.dispatchEvent(new CustomEvent(SINGLE_ATTACH_EVENT, { detail: active }));
      }
      if (caseIds) picking?.clear();
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {err && (
        <span className="max-w-[18rem] truncate text-[11px] text-bad" title={err}>
          {err}
        </span>
      )}
      {picking && (
        <RerunChip
          busy={busy === 'picked'}
          disabled={busy !== null || picked.length === 0}
          onClick={(e) => start(e, picked)}
          title={
            picked.length === 0
              ? '아래 케이스 목록에서 체크한 케이스만 이 기록 안에서 다시 실행합니다'
              : compare
                ? '고른 케이스로 A·B 를 이 기록 안에서 다시 실행 — 해당 케이스 결과가 덮입니다'
                : '고른 케이스만 이 기록 안에서 다시 실행 — 해당 케이스 결과가 덮입니다'
          }
          label="선택 재실행"
          count={picked.length}
          tone="accent"
        />
      )}
      {n > 0 && (
        <RerunChip
          busy={busy === 'mismatch'}
          disabled={busy !== null}
          onClick={(e) => start(e)}
          title={
            compare
              ? 'A·B 중 한쪽이라도 불일치였던 케이스만 이 기록 안에서 다시 실행 — 새 기록이 생기지 않고 해당 케이스 결과가 덮입니다'
              : '불일치 케이스만 이 기록 안에서 다시 실행 — 새 기록이 생기지 않고 해당 케이스 결과가 덮입니다'
          }
          label="불일치 재실행"
          count={n}
          tone="bad"
        />
      )}
    </span>
  );
}

/** 재실행 버튼 한 벌 — 선택 · 불일치 둘이 같은 모양으로 선다. 수 배지의 색만
 * 다르다(선택은 파랑, 불일치는 빨강). */
function RerunChip({
  busy, disabled, onClick, title, label, count, tone,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: (e: MouseEvent) => void;
  title: string;
  label: string;
  count: number;
  tone: 'accent' | 'bad';
}) {
  // 툴팁은 감싸개에 단다 — 비활성 버튼에는 브라우저가 툴팁을 띄우지 않아, 아직 고른
  // 케이스가 없을 때 '무엇을 하는 버튼인지' 를 말할 길이 없어진다.
  return (
    <span title={title} className="inline-flex shrink-0">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-surface pl-2 pr-1 text-xs font-medium text-ink',
        'shadow-[0_1px_0_rgba(17,24,39,0.04)] transition-colors hover:border-muted-soft hover:bg-surface-2',
        'focus:outline-none focus-visible:border-accent focus-visible:shadow-ring disabled:opacity-60',
      )}
    >
      <svg
        width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden
        className={cn('shrink-0 text-accent', busy && 'animate-spin')}
      >
        <path
          d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.75v2.5h-2.5"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
      {busy ? '시작하는 중…' : label}
      <span
        className={cn(
          'rounded-[4px] px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums',
          count === 0 ? 'bg-surface-3 text-muted' : tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-bad-soft text-bad',
        )}
      >
        {count}
      </span>
    </button>
    </span>
  );
}
