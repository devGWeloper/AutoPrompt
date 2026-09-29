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
  if (score == null) return { label: '—', tone: 'neutral' };
  if (score >= 0.8) return { label: 'High', tone: 'ok' };
  if (score >= 0.6) return { label: 'Mid', tone: 'warn' };
  return { label: 'Low', tone: 'bad' };
}

/**
 * 요약 카드의 껍데기.
 *
 * 모난 각(rounded-sm), 헤어라인 하나, 그림자 없음. 크게 둥근 모서리와 들리는
 * 그림자, 앞날의 3px 톤 레일은 숫자를 '위젯' 으로 보이게 만든다 — 이 판이 하는
 * 일은 잰 값을 또박또박 적어 두는 것이고, 그건 서류의 일이다.
 */
const CARD = 'flex flex-col justify-between rounded-sm border border-line bg-surface p-3.5';

/** 카드가 크게 세우는 숫자. 굵기는 semibold 까지 — bold 에 음수 자간까지 주면
 * 숫자가 제목처럼 커져서, 정작 무엇을 잰 값인지 적은 라벨이 딸려 보인다. */
const FIGURE = 'font-mono text-[22px] font-semibold leading-none tabular-nums text-ink';

const barFill = (v: number | null) =>
  v == null ? 'bg-muted-soft' : v >= 0.8 ? 'bg-ok' : v >= 0.6 ? 'bg-warn' : 'bg-bad';

/**
 * 점수 막대 — 3px, 모난 모서리.
 *
 * 색은 vivid 가 아니라 글자로도 읽히는 기본 stop 을 쓴다. vivid 는 점 하나를 찍는
 * 색이라 넓게 깔면 형광펜처럼 뜬다. 둥글고 통통한 막대는 게이지로 읽히는데, 이건
 * 계기판이 아니라 숫자의 크기를 한 번 더 말해 주는 밑줄이다.
 */
function Bar({ value, tone, className }: { value: number | null; tone?: string; className?: string }) {
  const pct = value != null ? Math.max(0, Math.min(1, value)) * 100 : 0;
  return (
    <div className={cn('h-[3px] w-full overflow-hidden bg-surface-3', className)}>
      <div
        className={cn('h-full transition-all duration-300', tone ?? barFill(value))}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** 점수대 딱지 — 모난 각, 점(dot) 없음. 둥근 알약에 색점까지 붙으면 표가 아니라
 * 대시보드 장식이 된다. 등급은 글자 세 자로 충분하다. */
function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums',
        score >= 0.8
          ? 'border-ok-line bg-ok-soft text-ok'
          : score >= 0.6
          ? 'border-warn-line bg-warn-soft text-warn'
          : 'border-bad-line bg-bad-soft text-bad'
      )}
    >
      {scoreLevel(score).label}
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
          <div className={cn(CARD, 'bg-surface-2')}>
            <div>
              <span className="block truncate text-caption uppercase tracking-[0.9px] text-muted">
                RAGAS Mean
              </span>
              <div className="mt-2 flex items-baseline justify-between">
                <span className={FIGURE}>{fmt3(mean)}</span>
                <ScoreBadge score={mean} />
              </div>
            </div>
            <Bar value={mean} className="mt-3" />
          </div>
        )}

        {/* One card per scored metric */}
        {shown.map((m) => {
          const val = detail[m] != null ? Number(detail[m]) : null;
          const isExact = m === EXACT_MATCH;
          return (
            <div key={m} className={CARD}>
              <div>
                <span
                  className="block truncate text-caption uppercase tracking-[0.9px] text-muted cursor-help"
                >
                  {METRIC_LABELS[m]}
                </span>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className={FIGURE}>{isExact ? `${emHit}/${emTotal}` : fmt3(val)}</span>
                  {isExact ? <OxBadge value={val} rate /> : <ScoreBadge score={val} />}
                </div>
              </div>
              <Bar value={val} className="mt-3" />
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
      'flex flex-col justify-between rounded-sm border bg-surface p-3.5',
      // 나은 쪽은 테두리 색으로만 가리킨다 — ring 은 테두리 밖으로 번져 빛나는
      // 자리를 만드는데, 서류에서 어느 칸이 빛날 일은 없다.
      ahead === side ? 'border-accent' : 'border-line',
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
            <span className={cn(FIGURE, 'text-[26px]')}>{headA.value}</span>
            <span className="text-xs text-muted">{headA.label}</span>
            {/* 일치율이 이미 머리 숫자면 같은 것을 옆에 또 적지 않는다. */}
            {headA.ragas && exA != null && (
              <span className="ml-auto flex items-baseline gap-1.5 text-xs text-muted">
                {METRIC_LABELS[EXACT_MATCH]} <OxBadge value={exA} rate />
              </span>
            )}
          </div>
          <Bar value={headA.score} tone="bg-muted-soft" />
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
                    'inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums',
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
            <span className={cn(FIGURE, 'text-[26px]')}>{headB.value}</span>
            <span className="text-xs text-muted">{headB.label}</span>
            {headB.ragas && exB != null && (
              <span className="ml-auto flex items-baseline gap-1.5 text-xs text-muted">
                {METRIC_LABELS[EXACT_MATCH]} <OxBadge value={exB} rate />
              </span>
            )}
          </div>
          <Bar value={headB.score} tone="bg-accent" />
        </div>
      </div>

      {/* One comparison card per metric scored on either side */}
      <div className={cn('grid gap-3', pairCols(shownPair.length))}>
        {shownPair.map((m) => {
          const av = detailA[m] != null ? Number(detailA[m]) : null;
          const bv = detailB[m] != null ? Number(detailB[m]) : null;
          const d = av != null && bv != null ? bv - av : null;

          return (
            <div key={m} className={CARD}>
              <div>
                <span className="block truncate text-xs font-semibold text-ink">
                  {METRIC_LABELS[m]}
                </span>
                <div className="mt-2 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className={cn(d != null && d < 0 ? 'font-semibold text-ink' : 'text-muted')}>
                    A {metricValue(m, av)}
                  </span>
                  <span className={cn(d != null && d > 0 ? 'font-semibold text-ink' : 'text-muted')}>
                    B {metricValue(m, bv)}
                  </span>
                </div>
              </div>

              {/* A · B 두 줄. 같은 자리에서 시작해 같은 자리에서 끝나는 막대라야
                  길이 차이가 곧 점수 차이로 읽힌다. */}
              <div className="mt-3 space-y-1">
                <Bar value={av} tone="bg-muted-soft" />
                <Bar value={bv} tone="bg-accent" />
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
