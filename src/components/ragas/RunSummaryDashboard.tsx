'use client';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import {
  RAGAS_METRICS,
  METRIC_LABELS,
  METRIC_DESCRIPTIONS,
  type RagasMetric,
  type RagasRunDetail,
} from '@/lib/types';
import { fmt3, runMean } from './shared';

function scoreLevel(score: number | null) {
  if (score == null) return { label: '—', tone: 'neutral', color: 'bg-muted' };
  if (score >= 0.8) return { label: 'High', tone: 'ok', color: 'bg-[#16a34a]' };
  if (score >= 0.6) return { label: 'Mid', tone: 'warn', color: 'bg-[#d97706]' };
  return { label: 'Low', tone: 'bad', color: 'bg-[#dc2626]' };
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted">—</span>;
  const lvl = scoreLevel(score);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
        score >= 0.8
          ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
          : score >= 0.6
          ? 'border-[#fef08a] bg-[#fefce8] text-[#a16207]'
          : 'border-[#fecdd3] bg-[#fff1f2] text-[#be123c]'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', lvl.color)} />
      {fmt3(score)}
    </span>
  );
}

// Single Run Dashboard: 1-row grid with Overall Mean Card + 5 Metric Cards (total 6 cards)
export function SingleRunSummaryDashboard({ detail }: { detail: RagasRunDetail }) {
  const mean = runMean(detail);

  return (
    <div className="mb-4">
      {/* 6 Cards in a clean 1-row grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Overall Mean Card */}
        <div className="flex flex-col justify-between rounded-lg border border-line bg-gradient-to-br from-surface to-surface-2 p-3.5 shadow-card">
          <div>
            <span className="block truncate text-xs font-semibold uppercase tracking-wider text-muted">
              Overall Mean
            </span>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="font-mono text-xl font-bold tabular-nums text-ink">
                {fmt3(mean)}
              </span>
              <ScoreBadge score={mean} />
            </div>
          </div>
          <div className="mt-3 relative h-1.5 w-full overflow-hidden rounded-full bg-bg">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                mean == null ? 'bg-muted' : mean >= 0.8 ? 'bg-[#16a34a]' : mean >= 0.6 ? 'bg-[#d97706]' : 'bg-[#dc2626]'
              )}
              style={{ width: `${mean != null ? mean * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* 5 Metric Breakdown Cards */}
        {RAGAS_METRICS.map((m) => {
          const val = detail[m] != null ? Number(detail[m]) : null;
          const pct = val != null ? Math.max(0, Math.min(1, val)) * 100 : 0;
          return (
            <div
              key={m}
              className="flex flex-col justify-between rounded-lg border border-line bg-surface p-3.5 shadow-card transition-shadow hover:shadow-md"
            >
              <div>
                <span
                  className="block truncate text-xs font-medium text-muted cursor-help"
                  title={METRIC_DESCRIPTIONS[m]}
                >
                  {METRIC_LABELS[m]}
                </span>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="font-mono text-xl font-bold tabular-nums text-ink">
                    {fmt3(val)}
                  </span>
                  <ScoreBadge score={val} />
                </div>
              </div>
              <div className="mt-3 relative h-1.5 w-full overflow-hidden rounded-full bg-bg">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    val == null ? 'bg-muted' : val >= 0.8 ? 'bg-[#16a34a]' : val >= 0.6 ? 'bg-[#d97706]' : 'bg-[#dc2626]'
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compare Run Dashboard: Two Side-by-Side Hero Cards (Version A & Version B) + 5 Paired Metric Cards
export function CompareSummaryDashboard({
  detailA,
  detailB,
  labelA,
  labelB,
}: {
  detailA: RagasRunDetail;
  detailB: RagasRunDetail;
  labelA: string;
  labelB: string;
}) {
  const meanA = runMean(detailA);
  const meanB = runMean(detailB);
  const delta = meanA != null && meanB != null ? meanB - meanA : null;
  const winner = meanA != null && meanB != null ? (meanB > meanA ? 'B' : meanA > meanB ? 'A' : 'TIE') : null;

  return (
    <div className="mb-6 space-y-4">
      {/* 2 Hero Summary Cards Side by Side (Version A vs Version B) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Version A Hero Card */}
        <div
          className={cn(
            'flex flex-col justify-between rounded-lg border bg-surface p-4 shadow-card',
            winner === 'A' ? 'border-accent/40 ring-1 ring-accent/20' : 'border-line'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="neutral">Version A (v{labelA})</Badge>
              {winner === 'A' && <Badge tone="accent">🏆 Winner</Badge>}
            </div>
            <ScoreBadge score={meanA} />
          </div>
          <div className="my-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums text-ink">
              {fmt3(meanA)}
            </span>
            <span className="text-xs text-muted">Mean Score</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-muted/60 transition-all duration-300"
              style={{ width: `${meanA != null ? meanA * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Version B Hero Card */}
        <div
          className={cn(
            'flex flex-col justify-between rounded-lg border bg-surface p-4 shadow-card',
            winner === 'B' ? 'border-accent/40 ring-1 ring-accent/20' : 'border-line'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="accent">Version B (v{labelB})</Badge>
              {winner === 'B' && <Badge tone="accent">🏆 Winner</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {delta != null && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
                    delta > 0
                      ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
                      : delta < 0
                      ? 'border-[#fecdd3] bg-[#fff1f2] text-[#be123c]'
                      : 'border-[#e2e8f0] bg-[#f8fafc] text-muted'
                  )}
                >
                  Δ {(delta > 0 ? '+' : '') + delta.toFixed(3)}
                </span>
              )}
              <ScoreBadge score={meanB} />
            </div>
          </div>
          <div className="my-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums text-ink">
              {fmt3(meanB)}
            </span>
            <span className="text-xs text-muted">Mean Score</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${meanB != null ? meanB * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* 5 Metric Comparison Grid (Consistent Size & Alignment) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {RAGAS_METRICS.map((m) => {
          const av = detailA[m] != null ? Number(detailA[m]) : null;
          const bv = detailB[m] != null ? Number(detailB[m]) : null;
          const d = av != null && bv != null ? bv - av : null;
          const pctA = av != null ? Math.max(0, Math.min(1, av)) * 100 : 0;
          const pctB = bv != null ? Math.max(0, Math.min(1, bv)) * 100 : 0;

          return (
            <div key={m} className="flex flex-col justify-between rounded-lg border border-line bg-surface p-3.5 shadow-card">
              <div>
                <span className="block truncate text-xs font-semibold text-ink" title={METRIC_DESCRIPTIONS[m]}>
                  {METRIC_LABELS[m]}
                </span>
                <div className="mt-2 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className={cn('font-medium', d != null && d < 0 ? 'font-bold text-ink' : 'text-muted')}>
                    A {fmt3(av)}
                  </span>
                  <span className={cn('font-medium', d != null && d > 0 ? 'font-bold text-ink' : 'text-muted')}>
                    B {fmt3(bv)}
                  </span>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {/* Dual Bars A & B */}
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-muted/60" style={{ width: `${pctA}%` }} />
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pctB}%` }} />
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2 text-[11px]">
                <span className="text-muted">Delta</span>
                <span
                  className={cn(
                    'font-mono font-semibold tabular-nums',
                    d == null ? 'text-muted' : d > 0 ? 'text-[#16a34a]' : d < 0 ? 'text-[#dc2626]' : 'text-muted'
                  )}
                >
                  {d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(3)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
