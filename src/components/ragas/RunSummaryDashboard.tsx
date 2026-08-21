'use client';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import {
  EXACT_MATCH,
  METRIC_LABELS,
  METRIC_DESCRIPTIONS,
  type RagasRunDetail,
} from '@/lib/types';
import { fmt3, OxBadge, runMean, scoredMetrics, sideLabel } from './shared';

// Card grid width follows the card count so a 정답 일치 only run doesn't leave
// four empty columns.
function gridCols(n: number): string {
  if (n <= 2) return 'grid-cols-1 sm:grid-cols-2';
  if (n <= 3) return 'grid-cols-2 sm:grid-cols-3';
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6';
}

function scoreLevel(score: number | null) {
  if (score == null) return { label: '—', tone: 'neutral', color: 'bg-muted' };
  if (score >= 0.8) return { label: 'High', tone: 'ok', color: 'bg-ok-vivid' };
  if (score >= 0.6) return { label: 'Mid', tone: 'warn', color: 'bg-warn-vivid' };
  return { label: 'Low', tone: 'bad', color: 'bg-bad-vivid' };
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted">—</span>;
  const lvl = scoreLevel(score);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
        score >= 0.8
          ? 'border-ok/25 bg-ok/[0.07] text-ok'
          : score >= 0.6
          ? 'border-warn/25 bg-warn/[0.07] text-warn'
          : 'border-bad/25 bg-bad/[0.07] text-bad'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', lvl.color)} />
      {lvl.label}
    </span>
  );
}

// Single Run Dashboard: Overall Mean Card + one card per scored metric. The
// Overall card is dropped when a single metric was scored (it would repeat it).
export function SingleRunSummaryDashboard({ detail }: { detail: RagasRunDetail }) {
  const mean = runMean(detail);
  const shown = scoredMetrics(detail);
  const emTotal = detail.results.filter((r) => r.exact_match != null).length;
  const emHit = detail.results.filter((r) => r.exact_match != null && Number(r.exact_match) >= 0.5).length;
  // The summary card averages the RAGAS metrics only (정답 일치 has its own card,
  // and a 0/1 verdict does not belong in a mean), so it earns its place only when
  // there are at least two of them to average.
  const withOverall = shown.filter((m) => m !== EXACT_MATCH).length > 1;

  return (
    <div className="mb-4">
      <div className={cn('grid gap-3', gridCols(shown.length + (withOverall ? 1 : 0)))}>
        {/* Overall Mean Card */}
        {withOverall && (
          <div className="flex flex-col justify-between rounded-md border border-line bg-surface-2 p-4">
            <div>
              <span className="block truncate text-xs font-semibold uppercase tracking-[0.6px] text-muted">
                RAGAS Mean
              </span>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="font-mono text-xl font-bold tabular-nums text-ink">
                  {fmt3(mean)}
                </span>
                <ScoreBadge score={mean} />
              </div>
            </div>
            <div className="mt-3 relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  mean == null ? 'bg-muted' : mean >= 0.8 ? 'bg-ok-vivid' : mean >= 0.6 ? 'bg-warn-vivid' : 'bg-bad-vivid'
                )}
                style={{ width: `${mean != null ? mean * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* One card per scored metric */}
        {shown.map((m) => {
          const val = detail[m] != null ? Number(detail[m]) : null;
          const pct = val != null ? Math.max(0, Math.min(1, val)) * 100 : 0;
          const isExact = m === EXACT_MATCH;
          return (
            <div
              key={m}
              className="flex flex-col justify-between rounded-md border border-line bg-surface p-4 transition-shadow hover:shadow-lift"
            >
              <div>
                <span
                  className="block truncate text-xs font-medium text-muted cursor-help"
                  title={METRIC_DESCRIPTIONS[m]}
                >
                  {METRIC_LABELS[m]}
                </span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xl font-bold tabular-nums text-ink">
                    {isExact ? `${emHit}/${emTotal}` : fmt3(val)}
                  </span>
                  {isExact ? <OxBadge value={val} rate /> : <ScoreBadge score={val} />}
                </div>
              </div>
              <div className="mt-3 relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    val == null ? 'bg-muted' : val >= 0.8 ? 'bg-ok-vivid' : val >= 0.6 ? 'bg-warn-vivid' : 'bg-bad-vivid'
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
  const shownPair = Array.from(new Set([...scoredMetrics(detailA), ...scoredMetrics(detailB)]));
  const delta = meanA != null && meanB != null ? meanB - meanA : null;
  // Run-level EXACT_VAL is already the match rate (mean of the per-case 0/1).
  const exA = detailA.exact_match != null ? Number(detailA.exact_match) : null;
  const exB = detailB.exact_match != null ? Number(detailB.exact_match) : null;
  // RAGAS decides the winner when it ran; a 정답 일치 only pair falls back to the
  // match rate rather than showing no verdict at all.
  const [cmpA, cmpB] = meanA != null || meanB != null ? [meanA, meanB] : [exA, exB];
  const winner = cmpA != null && cmpB != null ? (cmpB > cmpA ? 'B' : cmpA > cmpB ? 'A' : 'TIE') : null;

  return (
    <div className="mb-6 space-y-4">
      {/* 2 Hero Summary Cards Side by Side (Version A vs Version B) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Version A Hero Card */}
        <div
          className={cn(
            'flex flex-col justify-between rounded-md border bg-surface p-4',
            winner === 'A' ? 'border-ink ring-1 ring-ink/10' : 'border-line'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="neutral">Version A ({sideLabel(labelA)})</Badge>
              {winner === 'A' && <Badge tone="accent">🏆 Winner</Badge>}
            </div>
            <ScoreBadge score={meanA} />
          </div>
          <div className="my-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums text-ink">
              {fmt3(meanA)}
            </span>
            <span className="text-xs text-muted">RAGAS Mean</span>
            {exA != null && (
              <span className="ml-auto flex items-baseline gap-1.5 text-xs text-muted">
                정답 일치 <OxBadge value={exA} rate />
              </span>
            )}
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-muted/60 transition-all duration-300"
              style={{ width: `${meanA != null ? meanA * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Version B Hero Card */}
        <div
          className={cn(
            'flex flex-col justify-between rounded-md border bg-surface p-4',
            winner === 'B' ? 'border-ink ring-1 ring-ink/10' : 'border-line'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="accent">Version B ({sideLabel(labelB)})</Badge>
              {winner === 'B' && <Badge tone="accent">🏆 Winner</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {delta != null && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
                    delta > 0
                      ? 'border-ok/25 bg-ok/[0.07] text-ok'
                      : delta < 0
                      ? 'border-bad/25 bg-bad/[0.07] text-bad'
                      : 'border-line bg-surface-2 text-muted'
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
            <span className="text-xs text-muted">RAGAS Mean</span>
            {exB != null && (
              <span className="ml-auto flex items-baseline gap-1.5 text-xs text-muted">
                정답 일치 <OxBadge value={exB} rate />
              </span>
            )}
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${meanB != null ? meanB * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* One comparison card per metric scored on either side */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {shownPair.map((m) => {
          const av = detailA[m] != null ? Number(detailA[m]) : null;
          const bv = detailB[m] != null ? Number(detailB[m]) : null;
          const d = av != null && bv != null ? bv - av : null;
          const pctA = av != null ? Math.max(0, Math.min(1, av)) * 100 : 0;
          const pctB = bv != null ? Math.max(0, Math.min(1, bv)) * 100 : 0;

          return (
            <div key={m} className="flex flex-col justify-between rounded-md border border-line bg-surface p-4">
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
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-muted/60" style={{ width: `${pctA}%` }} />
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pctB}%` }} />
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2 text-[11px]">
                <span className="text-muted">Delta</span>
                <span
                  className={cn(
                    'font-mono font-semibold tabular-nums',
                    d == null ? 'text-muted' : d > 0 ? 'text-ok' : d < 0 ? 'text-bad' : 'text-muted'
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
