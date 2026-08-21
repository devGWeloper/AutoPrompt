'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import {
  ALL_METRICS,
  EXACT_MATCH,
  METRIC_LABELS,
  METRIC_DESCRIPTIONS,
  type RagasMetric,
  type RagasResultRow,
  type RagasRunDetail,
} from '@/lib/types';
import {
  AnswerBox, caseMean, Chevron, CollapseAllStrip, ElapsedTag, fmt3, fmtElapsed, OxBadge,
  PendingHint, ScoredPreview, sideLabel, TraceValueBox,
} from './shared';

/** Both sides' response times on one line, in the same A · B shape the score
 * badges use. Shown for unscored runs too — speed is a comparison of its own,
 * and on an A/B it is often the only difference the two endpoints have. */
function ElapsedPair({ a, b }: { a?: RagasResultRow; b?: RagasResultRow }) {
  const ta = fmtElapsed(a?.elapsed_ms);
  const tb = fmtElapsed(b?.elapsed_ms);
  if (ta === null && tb === null) return null;
  // Faster wins — but only when both sides answered, or the ink would mark a
  // lone time as if it had beaten something.
  const both = a?.elapsed_ms != null && b?.elapsed_ms != null;
  const aWins = both && a!.elapsed_ms! < b!.elapsed_ms!;
  const bWins = both && b!.elapsed_ms! < a!.elapsed_ms!;
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted" title="응답 시간 (채점 시간 제외)">
      <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px]">시간</span>
      <span>
        <span className={cn(aWins && 'font-semibold text-ink')}>A {ta ?? '—'}</span>
        {' · '}
        <span className={cn(bWins && 'font-semibold text-ink')}>B {tb ?? '—'}</span>
      </span>
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
          className={'absolute inset-y-0 left-0 rounded-full ' + (side === 'B' ? 'bg-accent' : 'bg-muted/40')}
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
          <span className="truncate text-sm font-medium text-ink" title={METRIC_DESCRIPTIONS[m]}>{METRIC_LABELS[m]}</span>
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
                'inline-flex min-w-[60px] items-center justify-center rounded-sm px-2 py-0.5 font-mono text-xs font-semibold tabular-nums border',
                d == null
                  ? 'border-transparent text-muted'
                  : d > 0
                  ? 'border-ok/25 bg-ok/[0.07] text-ok'
                  : d < 0
                  ? 'border-bad/25 bg-bad/[0.07] text-bad'
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

function CaseScoreBars({ a, b, cancelled }: { a?: RagasResultRow; b?: RagasResultRow; cancelled?: boolean }) {
  const rows = buildMetricRows(a, b);
  const scored = rows.some((r) => r.av != null || r.bv != null);

  if (!scored) {
    // Stopped before this case was judged — nothing is still on its way.
    if (cancelled && ![a, b].some((r) => r?.error_msg)) {
      return (
        <div className="mt-3 overflow-hidden rounded-sm border border-line bg-surface p-3 text-center text-[11px] text-muted">
          실행 취소 — 채점하지 않음
        </div>
      );
    }
    // An answer that arrived but has an error carries the scorer's failure — say
    // so rather than leaving the panel on '채점 중…' for the rest of the session.
    const failed = [a, b].filter((r) => r?.answer != null && r?.error_msg).map((r) => r!.error_msg!);
    return (
      <div
        className={cn(
          'mt-3 overflow-hidden rounded-sm border border-line bg-surface p-3 text-center text-[11px]',
          failed.length ? 'text-bad' : 'text-muted',
        )}
      >
        {failed.length ? `채점 실패 — ${failed[0]}` : '채점 중…'}
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
  labelA: string;
  labelB: string;
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
            <button
              type="button"
              onClick={() => toggle(key)}
              className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
            >
              <Chevron open={!isClosed} className="mt-1" />
              <span className={cn('min-w-0 flex-1 text-sm text-ink', isClosed ? 'truncate' : 'whitespace-pre-wrap break-words font-medium')}>
                {q}
              </span>
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
                                  ? 'border-ok/25 bg-ok/[0.07] text-ok'
                                  : delta < 0
                                  ? 'border-bad/25 bg-bad/[0.07] text-bad'
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
                          : <span className="text-[11px] text-muted">{cancelled ? '채점 안 함' : '채점 중…'}</span>
                      )}
                    </>
                  )}
                </div>
              )}
            </button>
            {!isClosed && (
              <div className="px-4 pb-3.5 pl-10">
                {gt && <p className="mb-3 whitespace-pre-wrap text-xs text-muted"><span className="font-medium">Ground truth ·</span> {gt}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-sm border border-line bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="neutral">A · {sideLabel(labelA)}</Badge>
                      <ElapsedTag ms={a?.elapsed_ms} />
                    </div>
                    {a?.trace_value && <div className="mt-2"><TraceValueBox row={a} /></div>}
                    <div className="mt-2"><AnswerBox text={a?.answer} error={a?.error_msg} /></div>
                  </div>
                  <div className="rounded-sm border border-line bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="accent">B · {sideLabel(labelB)}</Badge>
                      <ElapsedTag ms={b?.elapsed_ms} />
                    </div>
                    {b?.trace_value && <div className="mt-2"><TraceValueBox row={b} /></div>}
                    <div className="mt-2"><AnswerBox text={b?.answer} error={b?.error_msg} /></div>
                  </div>
                </div>
                {showScores && <CaseScoreBars a={a} b={b} cancelled={cancelled} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
