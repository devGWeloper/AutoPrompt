'use client';

import { cn } from '@/lib/cn';
import {
  EXACT_MATCH,
  METRIC_LABELS,
  type RagasMetric,
  type RagasRunDetail,
} from '@/lib/types';
import { compareSideLabel, fmt3, PassRateBadge, rateTone, runMean, scoredMetrics } from './shared';

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

/**
 * 카드 제목. 단일 실행과 A·B 가 같은 것을 쓴다.
 *
 * 전에는 단일이 eyebrow(작은 대문자 + 자간)였고 A·B 는 굵은 본문이라, 같은 지표
 * 이름이 두 화면에서 다른 글씨로 적혔다. 지표 이름은 '충실도' 처럼 한글이라
 * uppercase 가 하는 일이 없고 자간만 벌어져 읽기 나빴으므로, A·B 쪽 꼴로 모았다.
 */
const CARD_LABEL = 'block truncate text-xs font-semibold text-ink';

/**
 * A·B 카드의 두 값. 단일 카드의 FIGURE(22px) 만큼 키울 수는 없다 — 한 카드에 숫자가
 * 둘이라서다. 대신 본문보다 한 단 크게 잡아, 카드가 저마다 다른 부품처럼 보이지
 * 않게 한다(이전에는 text-xs 로 라벨보다도 작았다).
 */
const PAIR_FIGURE = 'font-mono text-sm tabular-nums';

/**
 * 이 실행에서 통과한 케이스 수 / 판정이 있는 케이스 수.
 *
 * Action Test 는 비율이 아니라 '몇 개 중 몇 개' 로 읽는 값이다 — 92% 는 12건 중
 * 11건인지 100건 중 92건인지 말하지 않고, 둘은 믿음이 다르다. 단일 실행과 A·B 가
 * 같은 함수를 써서 두 화면이 같은 수를 적는다.
 *
 * 사람이 통과시킨 케이스도 통과로 센다. 실행 단위 EXACT_VAL 이 그렇게 계산되므로,
 * 여기만 채점 결과 그대로 세면 같은 카드 안에서 두 숫자가 어긋난다.
 */
function exactCount(d: RagasRunDetail): { hit: number; total: number } {
  return {
    hit: d.results.filter((r) => r.passed || (r.exact_match != null && Number(r.exact_match) >= 0.5)).length,
    total: d.results.filter((r) => r.exact_match != null || r.passed).length,
  };
}

/** 먼저 읽히는 카드인가 — RAGAS 평균(지표 없음)과 Action Test. */
const isLead = (m?: RagasMetric) => m === undefined || m === EXACT_MATCH;

/** 카드가 크게 세우는 숫자. 굵기는 semibold 까지 — bold 에 음수 자간까지 주면
 * 숫자가 제목처럼 커져서, 정작 무엇을 잰 값인지 적은 라벨이 딸려 보인다. */
const FIGURE = 'font-mono text-[22px] font-semibold leading-none tabular-nums text-ink';

const barFill = (v: number | null) =>
  v == null ? 'bg-muted-soft' : v >= 0.8 ? 'bg-ok' : v >= 0.6 ? 'bg-warn' : 'bg-bad';

/**
 * Action Test 막대의 색. 0~1 품질 점수인 RAGAS 지표와 자가 다르다 — 이건 통과율이고,
 * 100% 만 '다 됐다' 다. 옆에 서는 PASS 배지와 같은 규칙(rateTone)을 써서, 한 줄의 두
 * 조각이 같은 말을 하게 한다.
 */
const RATE_FILL: Record<string, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', none: 'bg-muted-soft' };
const rateFill = (v: number | null) => RATE_FILL[rateTone(v)];

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
  const { hit: emHit, total: emTotal } = exactCount(detail);
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
              <span className={CARD_LABEL}>RAGAS Mean</span>
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
                {/* cursor-help 은 걷었다 — 붙일 title 이 없는데 커서만 물음표로 바뀌어,
                    가리키면 설명이 뜰 것처럼 말하고 아무것도 뜨지 않았다. */}
                <span className={CARD_LABEL}>{METRIC_LABELS[m]}</span>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className={FIGURE}>{isExact ? `${emHit}/${emTotal}` : fmt3(val)}</span>
                  {isExact ? <PassRateBadge hit={emHit} total={emTotal} /> : <ScoreBadge score={val} />}
                </div>
              </div>
              <Bar value={val} tone={isExact ? rateFill(val) : undefined} className="mt-3" />
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

/** 카드에 적는 값. 지표가 없는 카드는 RAGAS 평균이라 RAGAS 지표와 같은 꼴로 읽고,
 * Action Test 는 단일 실행 카드와 같이 '몇 개 중 몇 개' 로 적는다. */
const cardValue = (m: RagasMetric | undefined, v: number | null, d: RagasRunDetail) => {
  if (m === EXACT_MATCH) {
    const { hit, total } = exactCount(d);
    return `${hit}/${total}`;
  }
  return m ? metricValue(m, v) : fmt3(v);
};
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
                <span className={CARD_LABEL}>{label}</span>
                {/* 사이드마다 한 줄 — 왼쪽에 A · B 와 그 값, 그 옆에 제 막대.
                    값과 막대가 같은 줄에 있어야 '이 숫자가 이 길이' 가 한 번에
                    읽힌다. 값 두 줄과 막대 두 줄을 따로 쌓아 두었을 때는 위아래로
                    짝을 맞춰 봐야 했다.
                    값 칸은 고정 폭이다 — 자리가 흔들리면 두 막대가 다른 x 에서
                    시작해, 길이를 견주라고 그린 막대에서 그것만은 일어나면 안 된다. */}
                <div className="mt-2 space-y-1">
                  {([
                    ['A', av, detailA, d != null && d < 0],
                    ['B', bv, detailB, d != null && d > 0],
                  ] as const).map(([side, v, det, ahead]) => (
                    <div key={side} className="flex items-center gap-2">
                      <span className={cn(PAIR_FIGURE, 'w-[4.5rem] shrink-0', ahead ? 'font-semibold text-ink' : 'text-muted')}>
                        {side} {cardValue(m, v, det)}
                      </span>
                      {/* 막대 색은 tone 을 주지 않아 단일 실행과 같은 점수색(초록 ·
                          노랑 · 빨강)이 된다. 사이드를 색으로 가르던 이전 값(A 회색 ·
                          B 파랑)은 같은 지표가 두 화면에서 다른 색으로 보이게 했고,
                          어느 쪽이 A 인지는 이미 왼쪽 글자가 말한다. */}
                      <Bar value={v} tone={m === EXACT_MATCH ? rateFill(v) : undefined} className="min-w-0 flex-1" />
                      {/* Action Test 는 0/1 판정이라 점수 막대만으로는 '통과인가' 가
                          안 읽힌다 — 단일 실행 카드가 11/12 옆에 PASS 배지를 두는
                          까닭이고, 여기에도 사이드마다 같은 배지가 선다. */}
                      {m === EXACT_MATCH && <PassRateBadge {...exactCount(det)} />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[11px]">
                {/* 'Delta' 가 아니라 '차이' 다. 이 화면의 영어는 그것이 곧 이름인
                    것들(RAGAS · Action Test · Faithfulness)에만 남기고, 그냥 '차이' 를
                    뜻하는 낱말은 우리말로 적는다. */}
                <span className="text-muted">차이</span>
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
