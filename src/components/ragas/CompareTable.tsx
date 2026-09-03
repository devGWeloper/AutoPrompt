'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import {
  ALL_METRICS,
  EXACT_MATCH,
  METRIC_LABELS,
  type RagasMetric,
  type RagasResultRow,
  type RagasRunDetail,
} from '@/lib/types';
import {
  AnswerBox, caseMean, Chevron, CollapseAllStrip, CopyButton, DisclosureHeader, ElapsedTag, fmt3, fmtElapsed,
  compareSideLabel, OxBadge, PendingHint, ScoredPreview, TraceValueBox,
} from './shared';
import { DiffAgainst, PaneLabel } from './MatchDiff';

/** The expected answer, once, above both sides — it is the same text for A and
 * B, and repeating it under each would push the two answers apart. */
function GroundTruthBox({ text }: { text: string }) {
  return (
    <div className="mb-3 overflow-hidden rounded-sm border border-line bg-surface">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
        <PaneLabel tone="right">기대 정답</PaneLabel>
        <span className="ml-auto"><CopyButton text={text} /></span>
      </div>
      <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-relaxed text-ink">
        {text}
      </div>
    </div>
  );
}

/**
 * One side of a case. With an expected answer present, the side shows what it
 * was judged on with the parts that differ from it marked, so the two sides can
 * be read against the same yardstick instead of against each other by eye.
 */
function SideBox({
  side, label, tone, row, gt, settled,
}: {
  side: 'A' | 'B';
  label: string;
  tone: 'neutral' | 'accent';
  row?: RagasResultRow;
  gt: string | null;
  settled?: boolean;
}) {
  const scored = row?.trace_value ?? row?.answer ?? null;
  const diffable = gt !== null && scored !== null;
  return (
    // The two panels sit side by side and otherwise look identical, so the side
    // is carried by the edge of the box as well as by the badge — at a glance
    // the eye finds the rail, not a two-letter word inside a sentence.
    <div
      className={cn(
        'min-w-0 rounded-sm border border-line border-l-2 bg-surface-2 p-3',
        tone === 'accent' ? 'border-l-accent' : 'border-l-muted/50',
      )}
    >
      <div className="flex items-center gap-2">
        <Badge tone={tone}>
          <span className="font-mono font-semibold">{side}</span>
          <span className="text-muted-soft">·</span>
          <span className="truncate">{label}</span>
        </Badge>
        {row?.exact_match != null && <OxBadge value={row.exact_match} />}
        <span className="ml-auto"><ElapsedTag ms={row?.elapsed_ms} ttft={row?.ttft_ms} /></span>
      </div>
      {diffable ? (
        <>
          {row?.trace_value && (
            <div className="mt-2 flex items-center gap-1.5">
              <PaneLabel tone="left">채점 대상</PaneLabel>
              <span className="truncate rounded-sm border border-line px-1 py-px font-mono text-[10px] text-muted">
                {row.trace_var_nm || 'trace'}
              </span>
            </div>
          )}
          <DiffAgainst className="mt-2" text={scored} expected={gt} unwrapBody={!row?.trace_value} />
          {/* 중간 변수를 채점한 경우에만 답변이 따로 있다 — 아니면 위가 곧 답변이다. */}
          {row?.trace_value && (
            <>
              <p className="mt-3 eyebrow">답변</p>
              <div className="mt-0.5"><AnswerBox text={row?.answer} error={row?.error_msg} settled={settled} /></div>
            </>
          )}
        </>
      ) : (
        <>
          {row?.trace_value && <div className="mt-2"><TraceValueBox row={row} /></div>}
          <div className="mt-2"><AnswerBox text={row?.answer} error={row?.error_msg} settled={settled} /></div>
        </>
      )}
    </div>
  );
}

/** One timing measure across both sides, in the same A · B shape the score
 * badges use. Faster is inked — but only when both sides have a number, or the
 * ink would mark a lone value as if it had beaten something. */
function TimingPair({
  label,
  title,
  va,
  vb,
  fmt,
}: {
  label: string;
  title?: string;
  va: number | null | undefined;
  vb: number | null | undefined;
  fmt: (v: number | null | undefined) => string | null;
}) {
  const ta = fmt(va);
  const tb = fmt(vb);
  if (ta === null && tb === null) return null;
  const both = va != null && vb != null;
  const aWins = both && va! < vb!;
  const bWins = both && vb! < va!;
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted" title={title}>
      <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px]">{label}</span>
      <span>
        <span className={cn(aWins && 'font-semibold text-ink')}>A {ta ?? '—'}</span>
        {' · '}
        <span className={cn(bWins && 'font-semibold text-ink')}>B {tb ?? '—'}</span>
      </span>
    </div>
  );
}

/**
 * Both sides' timings. Shown for unscored runs too — speed is a comparison of
 * its own, and on an A/B it is often the only difference the two sides have.
 *
 * TTFT sits above the total because the two can disagree, and when they do the
 * disagreement is the finding: a side that wins on TTFT but loses on total was
 * not busier, it just said more. Only streaming endpoints produce the first
 * line; without it this is the single total row it has always been.
 */
function ElapsedPair({ a, b }: { a?: RagasResultRow; b?: RagasResultRow }) {
  return (
    <div className="flex flex-col gap-0.5">
      <TimingPair
        label="TTFT"
        title="요청 → 첫 토큰. 생성 시간이 빠져 있어 큐 대기가 그대로 드러난다."
        va={a?.ttft_ms}
        vb={b?.ttft_ms}
        fmt={fmtElapsed}
      />
      <TimingPair label="시간" title="요청 → 답변 완료" va={a?.elapsed_ms} vb={b?.elapsed_ms} fmt={fmtElapsed} />
    </div>
  );
}

// One side's absolute-score bar (fills 0→value on a 0..1 scale). B is the accent
// colour, A is neutral grey; the winning side's number is inked + bold.
function MetricBar({ side, value, win }: { side: 'A' | 'B'; value: number | null; win: boolean }) {
  const pct = value != null ? Math.max(0, Math.min(1, value)) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-[10px] font-semibold text-muted">{side}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className={'absolute inset-y-0 left-0 rounded-full ' + (side === 'B' ? 'bg-accent' : 'bg-muted-soft')}
          style={{ width: pct + '%' }}
        />
      </div>
      <span className={'w-12 shrink-0 text-right font-mono text-xs tabular-nums ' + (win ? 'font-semibold text-ink' : 'text-muted')}>
        {fmt3(value)}
      </span>
    </div>
  );
}

type MetricRow = { m: RagasMetric; av: number | null; bv: number | null; d: number | null };

// Extract the per-metric A/B values (+ delta) from any two score-bearing rows —
// works for both run-level averages (RagasRunDetail) and single cases (RagasResultRow).
function buildMetricRows(
  a: RagasResultRow | RagasRunDetail | undefined,
  b: RagasResultRow | RagasRunDetail | undefined,
): MetricRow[] {
  return ALL_METRICS.map((m) => {
    const av = a && a[m] != null ? Number(a[m]) : null;
    const bv = b && b[m] != null ? Number(b[m]) : null;
    const d = av != null && bv != null ? bv - av : null;
    return { m, av, bv, d };
  }).filter((r) => r.av != null || r.bv != null);
}

// One-line A/B verdict for the Comparison card header: who leads + the win tally.
// Renders nothing until at least one metric has been scored on both sides.
export function CompareVerdict({ detailA, detailB }: { detailA: RagasRunDetail; detailB: RagasRunDetail }) {
  const rows = buildMetricRows(detailA, detailB);
  const bWins = rows.filter((r) => r.d != null && r.d > 0).length;
  const aWins = rows.filter((r) => r.d != null && r.d < 0).length;
  const ties = rows.filter((r) => r.d != null && r.d === 0).length;
  if (bWins + aWins + ties === 0) return null;
  const verdict = bWins > aWins ? 'B ahead' : aWins > bWins ? 'A ahead' : 'Even';
  return (
    <span className="font-semibold text-ink">
      {verdict}
      <span className="ml-1.5 font-mono font-normal tabular-nums text-muted">· B {bWins} · A {aWins}{ties > 0 ? ` · tie ${ties}` : ''}</span>
    </span>
  );
}

// The shared leaderboard body: one row per metric with paired A/B bars on a
// 0..1 scale and Δ (B−A) on the right as a high-contrast diff badge.
function PairedMetricList({ rows }: { rows: MetricRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ m, av, bv, d }) => (
        <li key={m} className="grid grid-cols-[minmax(104px,0.8fr)_2fr_auto] items-center gap-4 px-3.5 py-2.5">
          <span className="truncate text-sm font-medium text-ink">{METRIC_LABELS[m]}</span>
          {/* 정답 일치 is a per-case verdict — O/X reads better than a 0/1 bar. */}
          {m === EXACT_MATCH ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2"><span className="w-3 shrink-0 text-[10px] font-semibold text-muted">A</span><OxBadge value={av} /></div>
              <div className="flex items-center gap-2"><span className="w-3 shrink-0 text-[10px] font-semibold text-muted">B</span><OxBadge value={bv} /></div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <MetricBar side="A" value={av} win={d != null && d < 0} />
              <MetricBar side="B" value={bv} win={d != null && d > 0} />
            </div>
          )}
          {m === EXACT_MATCH ? (
            <span className="min-w-[60px] text-center text-[11px] font-medium text-muted">
              {d == null ? '—' : d === 0 ? '동일' : d > 0 ? 'B만 일치' : 'A만 일치'}
            </span>
          ) : (
            <span
              className={cn(
                'inline-flex min-w-[60px] items-center justify-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
                d == null
                  ? 'border-transparent text-muted'
                  : d > 0
                  ? 'border-ok-line bg-ok-soft text-ok'
                  : d < 0
                  ? 'border-bad-line bg-bad-soft text-bad'
                  : 'border-line bg-surface-2 text-muted'
              )}
            >
              {d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(3)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function CaseScoreBars({
  a,
  b,
  cancelled,
  settled,
}: {
  a?: RagasResultRow;
  b?: RagasResultRow;
  cancelled?: boolean;
  /** Both runs have reached a terminal state — see `ScoreBars`. */
  settled?: boolean;
}) {
  const rows = buildMetricRows(a, b);
  const scored = rows.some((r) => r.av != null || r.bv != null);

  if (!scored) {
    // An answer that arrived but has an error carries the scorer's failure — say
    // so rather than leaving the panel on '채점 중…' for the rest of the session.
    const failed = [a, b].filter((r) => r?.answer != null && r?.error_msg).map((r) => r!.error_msg!);
    // With nothing wrong recorded, only the runs' status can say whether a score
    // is still on its way. Inferring it from the rows left a finished A/B — a
    // stopped one, a failed one, or a pair of empty answers — waiting forever.
    const why = failed.length
      ? `채점 실패 — ${failed[0]}`
      : !settled
        ? '채점 중…'
        : cancelled
          ? '실행 취소 — 채점하지 않음'
          : [a, b].every((r) => r?.answer == null && !r?.error_msg)
            ? '양쪽 답변이 비어 있음 — 채점하지 않음'
            : '채점되지 않음';
    return (
      <div
        className={cn(
          'mt-3 overflow-hidden rounded-sm border border-line bg-surface p-3 text-center text-[11px]',
          failed.length ? 'text-bad' : 'text-muted',
        )}
      >
        {why}
      </div>
    );
  }
  return (
    <div className="mt-3 overflow-hidden rounded-sm border border-line bg-surface">
      <div className="border-b border-line bg-surface-2/60 px-3.5 py-2">
        <span className="eyebrow">지표 비교</span>
      </div>
      <PairedMetricList rows={rows} />
      {/* Partly scored (e.g. 정답 일치 landed, the RAGAS metrics did not) — the
          bars alone would read as a clean result. */}
      {[a, b].some((r) => r?.answer != null && r?.error_msg) && (
        <p className="border-t border-line px-3.5 py-2 text-[11px] text-bad">
          채점 실패 — {[a, b].filter((r) => r?.answer != null && r?.error_msg).map((r) => r!.error_msg!)[0]}
        </p>
      )}
    </div>
  );
}

// Answer-centric A/B case view: per case, the two versions' answers sit side by
// side, and below them the per-case scores use the same paired-bar leaderboard
// as the run averages so the whole compare view reads in one language.
export function CaseCompareTable({
  detailA,
  detailB,
  labelA,
  labelB,
  scored,
  defaultAllOpen = false,
}: {
  detailA: RagasRunDetail;
  detailB: RagasRunDetail;
  /** Display-ready side name. Omit it and the run itself is asked — which is the
   * right answer for a saved run, and the only one that works for a model
   * comparison (no version to read). Passed in only where the detail is
   * synthesised and carries no run fields: a live stream, a manual call. */
  labelA?: string;
  labelB?: string;
  scored?: boolean;
  defaultAllOpen?: boolean;
}) {
  const byA = new Map(detailA.results.map((r) => [r.case_id, r] as const));
  const byB = new Map(detailB.results.map((r) => [r.case_id, r] as const));
  const ids = Array.from(new Set([...byA.keys(), ...byB.keys()]));
  // Answers only if either run was cancelled (incomplete scoring) or the pair
  // ran without scoring (METRICS='[]'); live streaming passes `scored` directly.
  // Same rule as the single-run table: a stopped pair keeps what it scored.
  const cancelled = detailA.status === 'CANCELLED' || detailB.status === 'CANCELLED';
  // Settled only once BOTH sides are done — while one is still running the pair
  // genuinely has scores on the way, and saying otherwise would be premature.
  const settled = [detailA.status, detailB.status].every(
    (s) => !['PENDING', 'RUNNING', 'CANCELLING'].includes(s),
  );
  const nameA = labelA ?? compareSideLabel(detailA);
  const nameB = labelB ?? compareSideLabel(detailB);
  const showScores = scored ?? (detailA.metrics !== '[]' && detailB.metrics !== '[]');
  const keys = ids.map((cid) => String(cid));
  const [opened, setOpened] = useState<Set<string>>(() =>
    defaultAllOpen ? new Set(keys) : new Set()
  );
  const allClosed = opened.size === 0;
  const toggle = (k: string) =>
    setOpened((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (ids.length === 0) {
    return <div className="py-8 text-center text-xs text-muted">결과가 없습니다</div>;
  }
  return (
    <div className="divide-y divide-line">
      {ids.length > 1 && (
        <CollapseAllStrip allClosed={allClosed} onToggle={() => setOpened(allClosed ? new Set(keys) : new Set())} />
      )}
      {ids.map((cid) => {
        const key = String(cid);
        const isClosed = !opened.has(key);
        const a = byA.get(cid);
        const b = byB.get(cid);
        const q = a?.question ?? b?.question ?? '—';
        const gt = a?.ground_truth ?? b?.ground_truth ?? null;
        const aMean = caseMean(a);
        const bMean = caseMean(b);
        const delta = aMean != null && bMean != null ? bMean - aMean : null;

        return (
          <div key={key}>
            <DisclosureHeader open={!isClosed} onToggle={() => toggle(key)}>
              <Chevron open={!isClosed} className="mt-1" />
              <span className={cn('min-w-0 flex-1 text-sm text-ink', isClosed ? 'truncate' : 'whitespace-pre-wrap break-words font-medium')}>
                {q}
              </span>
              {!isClosed && q !== '—' && (
                <span className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <CopyButton text={q} />
                </span>
              )}
              {isClosed && (a || b) && (
                <span className="mt-0.5 flex min-w-0 flex-[2] items-baseline gap-2.5 text-xs text-muted">
                  <span className="flex min-w-0 flex-1 items-baseline gap-1">
                    <span className="shrink-0 font-semibold">A</span>
                    {a ? <ScoredPreview row={a} className="min-w-0 flex-1" /> : <PendingHint label="대기 중" className="min-w-0 flex-1" />}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-1">
                    <span className="shrink-0 font-semibold">B</span>
                    {b ? <ScoredPreview row={b} className="min-w-0 flex-1" /> : <PendingHint label="대기 중" className="min-w-0 flex-1" />}
                  </span>
                </span>
              )}
              {/* Two independent verdicts per side: the O/X pair and the RAGAS
                  pair, plus the response times. They are stacked rather than
                  merged — a run with both selected has two answers to give, not
                  one blended number. */}
              {isClosed && (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <ElapsedPair a={a} b={b} />
                  {showScores && (
                    <>
                      {(a?.exact_match != null || b?.exact_match != null) && (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted">
                          A <OxBadge value={a?.exact_match ?? null} />
                          B <OxBadge value={b?.exact_match ?? null} />
                        </div>
                      )}
                      {(aMean != null || bMean != null) && (
                        <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted">
                          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px]">RAGAS</span>
                          <span>
                            <span className={cn(aMean != null && bMean != null && aMean > bMean && 'font-semibold text-ink')}>A {fmt3(aMean)}</span>
                            {' · '}
                            <span className={cn(aMean != null && bMean != null && bMean > aMean && 'font-semibold text-ink')}>B {fmt3(bMean)}</span>
                          </span>
                          {delta != null && (
                            <span
                              className={cn(
                                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold border',
                                delta > 0
                                  ? 'border-ok-line bg-ok-soft text-ok'
                                  : delta < 0
                                  ? 'border-bad-line bg-bad-soft text-bad'
                                  : 'border-line bg-surface-2 text-muted'
                              )}
                            >
                              {(delta > 0 ? '+' : '') + delta.toFixed(3)}
                            </span>
                          )}
                        </div>
                      )}
                      {a?.exact_match == null && b?.exact_match == null && aMean == null && bMean == null && (
                        (a?.error_msg || b?.error_msg)
                          ? <span className="text-[11px] text-bad" title={a?.error_msg ?? b?.error_msg ?? undefined}>오류</span>
                          : <span className="text-[11px] text-muted">{!settled ? '채점 중…' : cancelled ? '채점 안 함' : '점수 없음'}</span>
                      )}
                    </>
                  )}
                </div>
              )}
            </DisclosureHeader>
            {!isClosed && (
              <div className="px-4 pb-3.5 pl-10">
                {gt && <GroundTruthBox text={gt} />}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SideBox side="A" label={nameA} tone="neutral" row={a} gt={gt} settled={settled} />
                  <SideBox side="B" label={nameB} tone="accent" row={b} gt={gt} settled={settled} />
                </div>
                {showScores && <CaseScoreBars a={a} b={b} cancelled={cancelled} settled={settled} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
