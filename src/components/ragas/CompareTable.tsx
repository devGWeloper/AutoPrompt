'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import {
  RAGAS_METRICS,
  METRIC_LABELS,
  METRIC_DESCRIPTIONS,
  type RagasMetric,
  type RagasResultRow,
  type RagasRunDetail,
} from '@/lib/types';
import { AnswerBox, caseMean, Chevron, CollapseAllStrip, fmt3 } from './shared';

// One side's absolute-score bar (fills 0→value on a 0..1 scale). B is the accent
// colour, A is neutral grey; the winning side's number is inked + bold.
function MetricBar({ side, value, win }: { side: 'A' | 'B'; value: number | null; win: boolean }) {
  const pct = value != null ? Math.max(0, Math.min(1, value)) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-[10px] font-semibold text-muted">{side}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-bg">
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
  return RAGAS_METRICS.map((m) => {
    const av = a && a[m] != null ? Number(a[m]) : null;
    const bv = b && b[m] != null ? Number(b[m]) : null;
    const d = av != null && bv != null ? bv - av : null;
    return { m, av, bv, d };
  });
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
// 0..1 scale and Δ (B−A) on the right. Used by both the averages table and each
// A/B case so the whole compare view speaks one visual language.
function PairedMetricList({ rows }: { rows: MetricRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ m, av, bv, d }) => (
        <li key={m} className="grid grid-cols-[minmax(104px,0.8fr)_2fr_auto] items-center gap-4 px-3.5 py-2.5">
          <span className="truncate text-sm font-medium text-ink" title={METRIC_DESCRIPTIONS[m]}>{METRIC_LABELS[m]}</span>
          <div className="flex flex-col gap-1.5">
            <MetricBar side="A" value={av} win={d != null && d < 0} />
            <MetricBar side="B" value={bv} win={d != null && d > 0} />
          </div>
          <span className={'w-14 shrink-0 text-right font-mono text-xs tabular-nums ' + (d == null ? 'text-muted' : d > 0 ? 'text-ok' : d < 0 ? 'text-bad' : 'text-muted')}>
            {d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(3)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Per-case A/B score box — its own collapsible section (collapsed by default):
// the header always shows both means (winner bold); bars unfold on demand.
function CaseScoreBars({ a, b }: { a?: RagasResultRow; b?: RagasResultRow }) {
  const [open, setOpen] = useState(false);
  const rows = buildMetricRows(a, b);
  const scored = rows.some((r) => r.av != null || r.bv != null);
  const aMean = caseMean(a);
  const bMean = caseMean(b);
  if (!scored) {
    return (
      <div className="mt-3 overflow-hidden rounded-sm border border-line bg-surface">
        <div className="py-3 text-center text-[11px] text-muted">채점 중…</div>
      </div>
    );
  }
  return (
    <div className="mt-3 overflow-hidden rounded-sm border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 bg-surface-2/60 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <Chevron open={open} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">점수</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">
          <span className={cn(aMean != null && bMean != null && aMean > bMean && 'font-semibold text-ink')}>A {fmt3(aMean)}</span>
          {' · '}
          <span className={cn(aMean != null && bMean != null && bMean > aMean && 'font-semibold text-ink')}>B {fmt3(bMean)}</span>
        </span>
      </button>
      {open && <div className="border-t border-line"><PairedMetricList rows={rows} /></div>}
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
}: {
  detailA: RagasRunDetail;
  detailB: RagasRunDetail;
  labelA: string;
  labelB: string;
  scored?: boolean;
}) {
  const byA = new Map(detailA.results.map((r) => [r.case_id, r] as const));
  const byB = new Map(detailB.results.map((r) => [r.case_id, r] as const));
  const ids = Array.from(new Set([...byA.keys(), ...byB.keys()]));
  // Answers only if either run was cancelled (incomplete scoring) or the pair
  // ran without scoring (METRICS='[]'); live streaming passes `scored` directly.
  const showScores =
    detailA.status !== 'CANCELLED' && detailB.status !== 'CANCELLED' &&
    (scored ?? (detailA.metrics !== '[]' && detailB.metrics !== '[]'));
  // Collapsed by default — see CaseTable.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const keys = ids.map((cid) => String(cid));
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
              {isClosed && (a?.answer != null || b?.answer != null) && (
                <span className="mt-0.5 flex min-w-0 flex-[2] items-baseline gap-2.5 text-xs text-muted">
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold">A</span> {a?.answer ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold">B</span> {b?.answer ?? '—'}</span>
                </span>
              )}
              {isClosed && showScores && (
                aMean != null || bMean != null
                  ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      <span className={cn(aMean != null && bMean != null && aMean > bMean && 'font-semibold text-ink')}>A {fmt3(aMean)}</span>
                      {' · '}
                      <span className={cn(aMean != null && bMean != null && bMean > aMean && 'font-semibold text-ink')}>B {fmt3(bMean)}</span>
                    </span>
                  : <span className="shrink-0 text-[11px] text-muted">채점 중…</span>
              )}
            </button>
            {!isClosed && (
              <div className="px-4 pb-3.5 pl-10">
                {gt && <p className="mb-3 whitespace-pre-wrap text-xs text-muted"><span className="font-medium">Ground truth ·</span> {gt}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-sm border border-line bg-bg/40 p-3">
                    <Badge tone="neutral">A · v{labelA}</Badge>
                    <div className="mt-2"><AnswerBox text={a?.answer} error={a?.error_msg} /></div>
                  </div>
                  <div className="rounded-sm border border-line bg-bg/40 p-3">
                    <Badge tone="accent">B · v{labelB}</Badge>
                    <div className="mt-2"><AnswerBox text={b?.answer} error={b?.error_msg} /></div>
                  </div>
                </div>
                {showScores && <CaseScoreBars a={a} b={b} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
