'use client';

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
const CARD = 'flex flex-col justify-between rounded-sm border bg-surface p-3.5';

/**
 * 카드의 테두리. 둘로 갈린다.
 *
 * RAGAS 평균과 Action Test 는 이 판에서 먼저 읽히는 두 값이다 — 앞은 "얼마나
 * 잘했나" 를 한 수로 말하고, 뒤는 "몇 건이 통과했나" 를 말한다. 나머지 카드는 그
 * 둘을 뜯어 본 것이라, 열 장이 같은 테두리로 서면 어디부터 읽어야 하는지가 없다.
 *
 * 색으로 가리지 않고 테두리 농도만 쓴다: 이 판에서 색은 점수대(ok · warn · bad)가
 * 쓰는 말이고, 파랑은 '나은 쪽' 이 쓰는 말이다. 둘 중 어느 것도 '먼저 읽을 카드'
 * 라는 뜻이 아니다.
 */
const CARD_LINE = 'border-line';
const CARD_LEAD = 'border-[#97a0ab]';

/** 먼저 읽히는 카드인가 — RAGAS 평균(지표 없음)과 Action Test. */
const isLead = (m?: RagasMetric) => m === undefined || m === EXACT_MATCH;

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
          <div className={cn(CARD, CARD_LEAD, 'bg-surface-2')}>
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
            <div key={m} className={cn(CARD, isLead(m) ? CARD_LEAD : CARD_LINE)}>
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

/** 일치율은 비율이라 퍼센트로 읽는다 — 0.800 은 RAGAS 점수와 같은 꼴이라 서로
 * 다른 두 종류의 수를 같은 자리에서 견주게 만든다. */
const metricValue = (m: RagasMetric, v: number | null) =>
  m !== EXACT_MATCH ? fmt3(v) : v == null ? '—' : `${Math.round(v * 100)}%`;

const metricDelta = (m: RagasMetric, d: number | null) =>
  d == null ? '—' : m !== EXACT_MATCH
    ? (d > 0 ? '+' : '') + d.toFixed(3)
    : `${d > 0 ? '+' : ''}${Math.round(d * 100)}%p`;

/** 카드의 값·차이. 지표가 없는 카드는 RAGAS 평균이라 RAGAS 지표와 같은 꼴로 읽는다. */
const cardValue = (m: RagasMetric | undefined, v: number | null) => (m ? metricValue(m, v) : fmt3(v));
const cardDelta = (m: RagasMetric | undefined, d: number | null) =>
  m ? metricDelta(m, d) : d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(3);

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

  /**
   * 카드 한 벌. 지표마다 하나씩이고, 맨 앞에 RAGAS 평균이 선다.
   *
   * 평균은 지표가 아니라 지표들의 평균이라 shownPair 에 들어 있지 않다. 예전에는
   * 그 값을 위쪽 A·B 히어로 카드가 크게 세웠는데, 그 카드가 같은 지표들을 한 번 더
   * 적어 격자와 내용이 겹쳤다. 큰 상자 둘을 걷고 평균만 같은 모양의 카드로 옮겨,
   * 값은 그대로 남기고 중복만 없앤다.
   */
  const cards: { key: string; label: string; metric?: RagasMetric }[] = [
    ...(meanA != null || meanB != null ? [{ key: 'mean', label: 'RAGAS Mean' }] : []),
    ...shownPair.map((m) => ({ key: m as string, label: METRIC_LABELS[m], metric: m })),
  ];
  const valueOf = (m: RagasMetric | undefined, d: RagasRunDetail, mean: number | null) =>
    m ? (d[m] != null ? Number(d[m]) : null) : mean;

  return (
    <div className="mb-6 space-y-4">
      {/* 어느 쪽이 A 이고 B 인지는 한 줄로 적는다 — 카드가 'A' · 'B' 로만 부르니
          그 둘이 무엇인지는 격자 위에서 한 번 말해 두면 된다. 큰 상자는 필요 없다. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          <span className="font-mono font-semibold text-ink">A</span> {nameA}
        </span>
        <span aria-hidden className="h-3 w-px bg-line-strong" />
        <span>
          <span className="font-mono font-semibold text-ink">B</span> {nameB}
        </span>
      </div>

      {/* RAGAS 평균 + 지표마다 한 장 */}
      <div className={cn('grid gap-3', pairCols(cards.length))}>
        {cards.map(({ key, label, metric: m }) => {
          const av = valueOf(m, detailA, meanA);
          const bv = valueOf(m, detailB, meanB);
          const d = av != null && bv != null ? bv - av : null;

          return (
            <div key={key} className={cn(CARD, isLead(m) ? CARD_LEAD : CARD_LINE)}>
              <div>
                <span className="block truncate text-xs font-semibold text-ink">{label}</span>
                <div className="mt-2 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className={cn(d != null && d < 0 ? 'font-semibold text-ink' : 'text-muted')}>
                    A {cardValue(m, av)}
                  </span>
                  <span className={cn(d != null && d > 0 ? 'font-semibold text-ink' : 'text-muted')}>
                    B {cardValue(m, bv)}
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
                  {cardDelta(m, d)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
