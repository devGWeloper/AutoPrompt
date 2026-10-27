'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
  EXACT_MATCH,
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  RAGAS_METRICS,
  type Dataset,
  type DatasetCategory,
  type RagasMetric,
} from '@/lib/types';

/**
 * 실행 조건 머리띠 — TraceX Traces 화면의 필터 바(.filter · .seg)와 같은 말투.
 *
 * 옅은 회색 띠 위에 이름표 + 컨트롤이 서고, 몇 개 중 고르는 것은 흰 트랙 안의
 * 세그먼트로 펼쳐 둔다: 켜진 칸만 파랗고 나머지는 테두리 없이 글자로 남는다.
 * 지금 무엇이 골라져 있는지를 누르지 않고 읽을 수 있어야 한다.
 */
export function RunToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-2.5 rounded-md border border-line bg-surface-2 px-3.5 py-2.5', className)}>
      {children}
    </div>
  );
}

export function ToolbarRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2', className)}>{children}</div>;
}

/** 이름표(.flt-tag) + 그 컨트롤들. */
export function ToolbarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.7px] text-muted">{label}</span>
      {children}
    </div>
  );
}

export type SegItem = {
  id: string;
  label: ReactNode;
  on: boolean;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
};

/**
 * TraceX `.seg`. 하나만 고르는 줄이든 여럿을 켜는 줄이든 모양은 같다 — 켜진 칸이
 * 파랗다. `'sep'` 은 트랙 안의 묶음 경계.
 */
export function Seg({ items }: { items: (SegItem | 'sep')[] }) {
  return (
    <div role="group" className="inline-flex gap-0.5 rounded-[9px] border border-line-strong bg-surface p-[3px]">
      {items.map((it, i) =>
        it === 'sep' ? (
          <span key={`sep-${i}`} aria-hidden className="mx-0.5 my-1 w-px bg-line" />
        ) : (
          <button
            key={it.id}
            type="button"
            title={it.title}
            disabled={it.disabled}
            aria-pressed={it.on}
            onClick={it.onClick}
            className={cn(
              'whitespace-nowrap rounded-[6px] px-3 py-[5px] text-[12.5px] transition-colors',
              it.disabled
                ? 'cursor-not-allowed font-medium text-muted-soft'
                : it.on
                  ? 'bg-accent font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:brightness-105'
                  : 'font-medium text-body hover:bg-surface-3 hover:text-ink',
            )}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

/** 채점 줄: '없음' 과 지표들이 한 트랙에 선다. 마지막 지표를 끄면 '없음' 이 켜진다 —
 * 지표 0개로 채점하는 상태가 따로 있으면 실행 버튼이 이유 없이 잠긴다. */
export function ScoreSeg({
  scoreOn, setScoreOn, metrics, setMetrics,
}: {
  scoreOn: boolean;
  setScoreOn: (v: boolean) => void;
  metrics: string[];
  setMetrics: (fn: (cur: string[]) => string[]) => void;
}) {
  const toggle = (m: RagasMetric) => {
    if (!scoreOn) { setScoreOn(true); setMetrics(() => [m]); return; }
    const next = metrics.includes(m) ? metrics.filter((x) => x !== m) : [...metrics, m];
    if (next.length === 0) setScoreOn(false);
    else setMetrics(() => next);
  };
  const item = (m: RagasMetric): SegItem => ({
    id: m,
    label: METRIC_LABELS[m],
    title: METRIC_DESCRIPTIONS[m],
    on: scoreOn && metrics.includes(m),
    onClick: () => toggle(m),
  });
  return (
    <Seg
      items={[
        { id: 'none', label: '없음', title: '채점 없이 응답만', on: !scoreOn, onClick: () => setScoreOn(false) },
        'sep',
        item(EXACT_MATCH),
        'sep',
        ...RAGAS_METRICS.map(item),
      ]}
    />
  );
}

export type DataSource = 'dataset' | 'manual';

/** 실행 버튼에 적는 건수 — 고른 케이스가 있으면 그 수, 폴더를 좁혔으면 폴더의 수,
 * 아니면 데이터셋 전체. */
export function runCount(
  datasets: Dataset[],
  datasetId: number | null,
  folders: DatasetCategory[],
  caseType: string | null,
  pickedCount: number | null = null,
): number | null {
  if (pickedCount != null) return pickedCount;
  const folder = caseType != null ? folders.find((c) => c.type_cd === caseType) : null;
  if (folder) return folder.case_count;
  return datasets.find((d) => d.dataset_id === datasetId)?.case_count ?? null;
}

/** 실행 단추에 붙는 ▶. 버튼 하나뿐인 줄에서 '여기가 시작'을 글자보다 먼저 말한다. */
export function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.8v10.4L13 8z" />
    </svg>
  );
}
