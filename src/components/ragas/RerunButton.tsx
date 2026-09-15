'use client';

import { useState, type MouseEvent } from 'react';
import { readActiveRun } from '@/lib/activeRun';
import { cn } from '@/lib/cn';
import {
  COMPARE_ATTACH_EVENT, mismatchCount, SINGLE_ATTACH_EVENT, startAbMismatchRerun, startMismatchRerun,
} from '@/lib/rerun';
import type { RagasRunDetail } from '@/lib/types';
import { errText, useEndpoints } from './shared';

/**
 * 불일치 케이스만 같은 조건으로 다시 돌린다. 어디서 누르든(실행 직후 결과, 메인
 * 화면의 지난 실행, 실행 기록) 새 실행은 그 종류의 탭에서 실시간으로 진행된다 —
 * 버튼은 실행을 만들어 알리기만 하고, 스트림은 탭이 붙는다.
 *
 * `detailB` 가 있으면 Compare: 두 사이드 중 한쪽이라도 불일치였던 케이스로 A·B 를
 * 함께 다시 돌린다. 불일치가 없으면 아무것도 그리지 않는다.
 */
export default function RerunButton({
  detail, detailB, className,
}: {
  detail: RagasRunDetail;
  detailB?: RagasRunDetail | null;
  className?: string;
}) {
  const endpoints = useEndpoints();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const compare = detailB != null;
  const n = mismatchCount(detail, detailB);
  if (n === 0) return null;

  async function start(e: MouseEvent) {
    e.stopPropagation();
    setErr(null);
    if (readActiveRun(compare ? 'compare' : 'single')) {
      setErr(`${compare ? 'Compare' : 'Single'} 탭에서 진행 중인 테스트가 끝난 뒤 다시 시도해 주세요`);
      return;
    }
    setBusy(true);
    try {
      if (compare) {
        const active = await startAbMismatchRerun(detail, detailB!, endpoints);
        window.dispatchEvent(new CustomEvent(COMPARE_ATTACH_EVENT, { detail: active }));
      } else {
        const active = await startMismatchRerun(detail, endpoints);
        window.dispatchEvent(new CustomEvent(SINGLE_ATTACH_EVENT, { detail: active }));
      }
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {err && (
        <span className="max-w-[18rem] truncate text-[11px] text-bad" title={err}>
          {err}
        </span>
      )}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        title={compare ? 'A·B 중 한쪽이라도 불일치였던 케이스만 같은 조건으로 다시 실행' : '불일치 케이스만 같은 조건으로 다시 실행'}
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
        {busy ? '시작하는 중…' : '불일치 재테스트'}
        <span className="rounded-[4px] bg-bad-soft px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-bad">
          {n}
        </span>
      </button>
    </span>
  );
}
