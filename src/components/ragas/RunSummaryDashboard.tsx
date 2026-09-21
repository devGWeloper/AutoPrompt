'use client';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import {
  EXACT_MATCH,
  METRIC_LABELS,
  type RagasMetric,
  type RagasRunDetail,
} from '@/lib/types';
import { compareSideLabel, fmt3, OxBadge, runMean, scoredMetrics } from './shared';

// Card grid width follows the card count so a 정답 일치 only run doesn't leave
// four empty columns.
function gridCols(n: number): string {
  if (n <= 2) return 'grid-cols-1 sm:grid-cols-2';
  if (n <= 3) return 'grid-cols-2 sm:grid-cols-3';
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6';
}

/** 비교 카드도 개수만큼만 칸을 연다 — Action Test 하나만 잰 비교에서 다섯 칸짜리
 * 격자를 열면 카드 하나와 빈 칸 넷이 남는다. */
function pairCols(n: number): string {
  if (n <= 2) return 'grid-cols-1 sm:grid-cols-2';
  if (n === 3) return 'grid-cols-1 sm:grid-cols-3';
  if (n === 4) return 'grid-cols-2 sm:grid-cols-4';
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';
}

function scoreLevel(score: number | null) {
  if (score == null) return { label: '—', tone: 'neutral', color: 'bg-muted' };
  if (score >= 0.8) return { label: 'High', tone: 'ok', color: 'bg-ok-vivid' };
  if (score >= 0.6) return { label: 'Mid', tone: 'warn', color: 'bg-warn-vivid' };
  return { label: 'Low', tone: 'bad', color: 'bg-bad-vivid' };
}

// inview's KPI card marks its tone with a solid 3px rail down the leading edge —
// the colour of the score, readable before the number is.
function toneRail(score: number | null): string {
  if (score == null) return 'bg-line-strong';
  if (score >= 0.8) return 'bg-ok';
  if (score >= 0.6) return 'bg-warn';
  return 'bg-bad';
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted">—</span>;
  const lvl = scoreLevel(score);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
        score >= 0.8
          ? 'border-ok-line bg-ok-soft text-ok'
          : score >= 0.6
          ? 'border-warn-line bg-warn-soft text-warn'
          : 'border-bad-line bg-bad-soft text-bad'
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
  const emTotal = detail.results.filter((r) => r.exact_match != null || r.passed).length;
  // 사람이 통과시킨 케이스도 맞은 것으로 센다 — 카드의 'N/M' 과 그 옆 비율 배지는
  // 실행 단위 EXACT_VAL(서버가 통과를 반영해 다시 낸 값)에서 오므로, 여기만
  // 채점 결과 그대로 세면 같은 카드 안에서 두 숫자가 어긋난다.
  const emHit = detail.results.filter(
    (r) => r.passed || (r.exact_match != null && Number(r.exact_match) >= 0.5),
  ).length;
  // The summary card averages the RAGAS metrics only (정답 일치 has its own card,
  // and a 0/1 verdict does not belong in a mean), so it earns its place only when
  // there are at least two of them to average.
  const withOverall = shown.filter((m) => m !== EXACT_MATCH).length > 1;

  return (
    <div className="mb-4">
      <div className={cn('grid gap-3', gridCols(shown.length + (withOverall ? 1 : 0)))}>
        {/* Overall Mean Card */}
        {withOverall && (
          <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-line bg-surface-2 p-4 pl-5 shadow-card">
            <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', toneRail(mean))} />
            <div>
              <span className="block truncate text-caption uppercase tracking-[0.9px] text-muted">
                RAGAS Mean
              </span>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="font-mono text-[26px] font-bold leading-none tracking-[-0.6px] tabular-nums text-ink">
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
              className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-line bg-surface p-4 pl-5 shadow-card transition-shadow hover:shadow-lift"
            >
              <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', toneRail(val))} />
              <div>
                <span
                  className="block truncate text-caption uppercase tracking-[0.9px] text-muted cursor-help"
                >
                  {METRIC_LABELS[m]}
                </span>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[26px] font-bold leading-none tracking-[-0.6px] tabular-nums text-ink">
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

/**
 * 히어로 카드가 크게 세우는 숫자 — 그 실행이 실제로 잰 것.
 *
 * 'RAGAS Mean' 과 '—' 를 늘 세워 두던 이전 카드는, RAGAS 를 켜지 않은 실행에서
 * 재지도 않은 지표의 이름만 큼직하게 보여 주고 정작 잰 것(Action Test 일치율)은
 * 구석에 두었다. 화면에서 제일 큰 숫자가 무엇인지 헷갈리면 나머지를 읽을 이유가
 * 없다: RAGAS 를 쟀으면 그 평균, 아니면 일치율, 둘 다 아니면 잰 것이 없다고 말한다.
 */
function heroScore(mean: number | null, exact: number | null) {
  if (mean != null) return { score: mean, value: fmt3(mean), label: 'RAGAS Mean', ragas: true };
  if (exact != null) {
    return { score: exact, value: `${Math.round(exact * 100)}%`, label: `${METRIC_LABELS[EXACT_MATCH]} 일치율`, ragas: false };
  }
  return { score: null, value: '—', label: '점수 없음', ragas: false };
}

/** 일치율은 비율이라 퍼센트로 읽는다 — 0.800 은 RAGAS 점수와 같은 꼴이라 서로
 * 다른 두 종류의 수를 같은 자리에서 견주게 만든다. */
const metricValue = (m: RagasMetric, v: number | null) =>
  m !== EXACT_MATCH ? fmt3(v) : v == null ? '—' : `${Math.round(v * 100)}%`;

const metricDelta = (m: RagasMetric, d: number | null) =>
  d == null ? '—' : m !== EXACT_MATCH
    ? (d > 0 ? '+' : '') + d.toFixed(3)
    : `${d > 0 ? '+' : ''}${Math.round(d * 100)}%p`;

// Compare Run Dashboard: Two Side-by-Side Hero Cards (Version A & Version B) + 5 Paired Metric Cards
export function CompareSummaryDashboard({
  detailA,
  detailB,
  labelA,
  labelB,
}: {
  detailA: RagasRunDetail;
  detailB: RagasRunDetail;
  /** Display-ready side name; omitted, the run says what it varied. The old
   * wording hard-coded "Version", which a model comparison never was. */
  labelA?: string;
  labelB?: string;
}) {
  const nameA = labelA ?? compareSideLabel(detailA);
  const nameB = labelB ?? compareSideLabel(detailB);
  const meanA = runMean(detailA);
  const meanB = runMean(detailB);
  const shownPair = Array.from(new Set([...scoredMetrics(detailA), ...scoredMetrics(detailB)]));
  // Run-level EXACT_VAL is already the match rate (mean of the per-case 0/1).
  const exA = detailA.exact_match != null ? Number(detailA.exact_match) : null;
  const exB = detailB.exact_match != null ? Number(detailB.exact_match) : null;
  // RAGAS decides the better side when it ran; a 정답 일치 only pair falls back to
  // the match rate rather than showing nothing at all.
  const [cmpA, cmpB] = meanA != null || meanB != null ? [meanA, meanB] : [exA, exB];
  const ahead = cmpA != null && cmpB != null ? (cmpB > cmpA ? 'B' : cmpA > cmpB ? 'A' : null) : null;
  const heroCard = (side: 'A' | 'B') =>
    cn(
      'flex flex-col justify-between rounded-xl border bg-surface p-4 shadow-card',
      ahead === side ? 'border-accent ring-1 ring-accent/25' : 'border-line',
    );
  const headA = heroScore(meanA, exA);
  const headB = heroScore(meanB, exB);
  const headDelta = headA.score != null && headB.score != null ? headB.score - headA.score : null;

  return (
    <div className="mb-6 space-y-4">
      {/* 2 Hero Summary Cards Side by Side (Version A vs Version B) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Version A Hero Card */}
        <div className={heroCard('A')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="neutral">A · {nameA}</Badge>
            </div>
            <ScoreBadge score={headA.score} />
          </div>
          <div className="my-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums text-ink">
              {headA.value}
            </span>
            <span className="text-xs text-muted">{headA.label}</span>
            {/* 일치율이 이미 머리 숫자면 같은 것을 옆에 또 적지 않는다. */}
            {headA.ragas && exA != null && (
              <span className="ml-auto flex items-baseline gap-1.5 text-xs text-muted">
                {METRIC_LABELS[EXACT_MATCH]} <OxBadge value={exA} rate />
              </span>
            )}
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-muted-soft transition-all duration-300"
              style={{ width: `${headA.score != null ? headA.score * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Version B Hero Card */}
        <div className={heroCard('B')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="accent">B · {nameB}</Badge>
            </div>
            <div className="flex items-center gap-2">
              {/* Δ 는 두 카드가 크게 세운 그 숫자의 차이다 — 위는 일치율인데 Δ 만
                  RAGAS 평균 차이를 적으면 둘을 빼도 답이 나오지 않는다. */}
              {headDelta != null && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
                    headDelta > 0
                      ? 'border-ok-line bg-ok-soft text-ok'
                      : headDelta < 0
                      ? 'border-bad-line bg-bad-soft text-bad'
                      : 'border-line bg-surface-2 text-muted'
                  )}
                >
                  Δ {headA.ragas
                    ? (headDelta > 0 ? '+' : '') + headDelta.toFixed(3)
                    : `${headDelta > 0 ? '+' : ''}${Math.round(headDelta * 100)}%p`}
                </span>
              )}
              <ScoreBadge score={headB.score} />
            </div>
          </div>
          <div className="my-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums text-ink">
              {headB.value}
            </span>
            <span className="text-xs text-muted">{headB.label}</span>
            {headB.ragas && exB != null && (
              <span className="ml-auto flex items-baseline gap-1.5 text-xs text-muted">
                {METRIC_LABELS[EXACT_MATCH]} <OxBadge value={exB} rate />
              </span>
            )}
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${headB.score != null ? headB.score * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* One comparison card per metric scored on either side */}
      <div className={cn('grid gap-3', pairCols(shownPair.length))}>
        {shownPair.map((m) => {
          const av = detailA[m] != null ? Number(detailA[m]) : null;
          const bv = detailB[m] != null ? Number(detailB[m]) : null;
          const d = av != null && bv != null ? bv - av : null;
          const pctA = av != null ? Math.max(0, Math.min(1, av)) * 100 : 0;
          const pctB = bv != null ? Math.max(0, Math.min(1, bv)) * 100 : 0;

          return (
            <div key={m} className="flex flex-col justify-between rounded-md border border-line bg-surface p-4">
              <div>
                <span className="block truncate text-xs font-semibold text-ink">
                  {METRIC_LABELS[m]}
                </span>
                <div className="mt-2 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className={cn('font-medium', d != null && d < 0 ? 'font-bold text-ink' : 'text-muted')}>
                    A {metricValue(m, av)}
                  </span>
                  <span className={cn('font-medium', d != null && d > 0 ? 'font-bold text-ink' : 'text-muted')}>
                    B {metricValue(m, bv)}
                  </span>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {/* Dual Bars A & B */}
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-muted-soft" style={{ width: `${pctA}%` }} />
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pctB}%` }} />
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[11px]">
                <span className="text-muted">Delta</span>
                <span
                  className={cn(
                    'font-mono font-semibold tabular-nums',
                    d == null ? 'text-muted' : d > 0 ? 'text-ok' : d < 0 ? 'text-bad' : 'text-muted'
                  )}
                >
                  {metricDelta(m, d)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
