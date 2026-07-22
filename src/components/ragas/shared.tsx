'use client';

import { useCallback, useEffect, useState } from 'react';
import { Select } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  RAGAS_METRICS,
  METRIC_LABELS,
  METRIC_DESCRIPTIONS,
  type RagasMetric,
  type Dataset,
  type FlowCurrent,
  type FlowNode,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
} from '@/lib/types';

// ---- formatting ------------------------------------------------------------

export const errText = (e: unknown) => (e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
export const fmt2 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(2) : '—');
export const fmt3 = (v: number | null | undefined) => (v != null ? Number(v).toFixed(3) : '—');

/** Compact table timestamp from the server's YYYY-MM-DDTHH:MM:SS string: time
 * only if today, MM-DD HH:MM within the year, full date otherwise. The full
 * string stays available via the cell's title tooltip. */
export function fmtDt(iso: string): string {
  const [d, t] = iso.split('T');
  if (!d || !t) return iso;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hm = t.slice(0, 5);
  if (d === today) return hm;
  return d.startsWith(`${now.getFullYear()}-`) ? `${d.slice(5)} ${hm}` : `${d} ${hm}`;
}

// Overall run score = mean of the available metric averages (null if none
// scored). Accepts anything carrying the metric fields (details and summaries).
export function runMean(d: { [K in RagasMetric]?: number | null }): number | null {
  const vs = RAGAS_METRICS.map((m) => d[m]).filter((v): v is number => v != null);
  return vs.length ? vs.reduce((s, v) => s + Number(v), 0) / vs.length : null;
}

// Mean of one case's available metric scores (null until something is scored).
export function caseMean(r: RagasResultRow | undefined): number | null {
  if (!r) return null;
  const vs = RAGAS_METRICS.map((m) => r[m]).filter((v): v is number => v != null);
  return vs.length ? vs.reduce((s, v) => s + Number(v), 0) / vs.length : null;
}

/** Insert or replace a streamed result row, keeping case order (by result id). */
export function upsertResult(cur: RagasResultRow[], row: RagasResultRow): RagasResultRow[] {
  const i = cur.findIndex((x) => x.ragas_result_id === row.ragas_result_id);
  if (i === -1) return [...cur, row].sort((a, b) => a.ragas_result_id - b.ragas_result_id);
  const next = cur.slice();
  next[i] = row;
  return next;
}

// ---- hooks -----------------------------------------------------------------

export function useFlowDatasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const reload = useCallback(() => {
    api.get<Dataset[]>('/flow/datasets').then(setDatasets).catch(() => setDatasets([]));
  }, []);
  useEffect(reload, [reload]);
  return { datasets, reload };
}

export function usePromptNodes() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  useEffect(() => {
    api
      .get<FlowCurrent>('/flow/current')
      .then((f) => setNodes(f.nodes))
      .catch(() => setNodes([]));
  }, []);
  return nodes;
}

// ---- small shared controls -------------------------------------------------

/** 'RAGAS 채점' master switch, shared by every run mode. A real track+knob
 * switch — unlike a dimmed chip, its on/off affordance is unmistakable. */
export function ScoreToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="group inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold"
    >
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          on ? 'bg-accent' : 'bg-muted/30 group-hover:bg-muted/45',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
            on && 'translate-x-3',
          )}
        />
      </span>
      <span className={cn('transition-colors', on ? 'text-ink' : 'text-muted')}>RAGAS 채점</span>
    </button>
  );
}

/** Metric picker as an always-visible chip row (= inview .exclude-chip):
 * selected chips are accent-tinted, deselected ones sit quiet. No disclosure
 * to unfold, so the settings strip keeps a single stable line. */
export function MetricChips({ metrics, setMetrics }: { metrics: string[]; setMetrics: (f: (cur: string[]) => string[]) => void }) {
  return (
    <>
      {RAGAS_METRICS.map((m) => {
        const on = metrics.includes(m);
        return (
          <button
            key={m}
            type="button"
            title={METRIC_DESCRIPTIONS[m]}
            aria-pressed={on}
            onClick={() => setMetrics((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
            className={cn(
              'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              on ? 'border-accent/25 bg-accent-soft/60 text-accent' : 'border-transparent text-muted hover:bg-surface-2',
            )}
          >
            {METRIC_LABELS[m]}
          </button>
        );
      })}
    </>
  );
}

export function DatasetSelect({ datasets, value, onChange }: { datasets: Dataset[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="w-48">
      <option value="" disabled>Dataset</option>
      {datasets.map((d) => (<option key={d.dataset_id} value={d.dataset_id}>{d.dataset_nm}</option>))}
    </Select>
  );
}

export function VersionSelect({ versions, value, onChange, placeholder }: { versions: PromptVersionSummary[]; value: number | null; onChange: (id: number) => void; placeholder: string }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="w-36">
      <option value="" disabled>{placeholder}</option>
      {versions.map((v) => (
        <option key={v.prompt_id} value={v.prompt_id}>v{v.version_no}</option>
      ))}
    </Select>
  );
}

export function SegToggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={'rounded px-3 py-1.5 text-sm font-medium transition-colors ' + (value === o.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const dot =
    status === 'done' ? 'bg-ok'
    : status === 'failed' ? 'bg-bad'
    : status === 'cancelled' ? 'bg-bad/60'
    : status === 'running' ? 'bg-accent animate-pulse'
    : 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
      <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + dot} />
      {status}
    </span>
  );
}

export function ErrBox({ msg }: { msg: string }) {
  return <div className="rounded-md border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{msg}</div>;
}

// Bounded, scrollable answer box — answers can be long, so cap the height and
// scroll inside (break-words so long unbroken tokens/URLs don't overflow wide).
export function AnswerBox({ text, error }: { text?: string | null; error?: string | null }) {
  if (text == null) return <p className="text-sm text-bad">{error ?? '—'}</p>;
  return (
    <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm leading-relaxed text-ink">
      {text}
    </div>
  );
}

// Small rotating disclosure chevron shared by collapsible rows.
export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90', className)}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 'Collapse all / Expand all' strip shown above case lists with >1 case. */
export function CollapseAllStrip({ allClosed, onToggle }: { allClosed: boolean; onToggle: () => void }) {
  return (
    <div className="flex justify-end bg-surface-2/60 px-4 py-1.5">
      <button type="button" onClick={onToggle} className="text-[11px] font-medium text-muted hover:text-ink">
        {allClosed ? '모두 펼치기' : '모두 접기'}
      </button>
    </div>
  );
}

// Single-run score view: one bar per metric on a 0..1 scale — the single-side
// counterpart of the A/B paired bars. Wrapped in its own collapsible section
// (collapsed by default) whose header always shows the case average.
export function ScoreBars({ row }: { row: RagasResultRow }) {
  const [open, setOpen] = useState(false);
  const scored = RAGAS_METRICS.some((m) => row[m] != null);
  if (!scored) {
    return row.answer == null && row.error_msg
      ? <span className="text-[11px] text-bad">{row.error_msg}</span>
      : <span className="text-[11px] text-muted">채점 중…</span>;
  }
  const mean = caseMean(row);
  return (
    <div className="overflow-hidden rounded-sm border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 bg-surface-2/60 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <Chevron open={open} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">점수</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">평균 <span className="font-semibold text-ink">{fmt3(mean)}</span></span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
          {RAGAS_METRICS.map((m) => {
            const v = row[m] != null ? Number(row[m]) : null;
            const pct = v != null ? Math.max(0, Math.min(1, v)) * 100 : 0;
            return (
              <li key={m} className="grid grid-cols-[minmax(92px,auto)_1fr_auto] items-center gap-3">
                <span className="truncate text-[11px] text-muted" title={METRIC_DESCRIPTIONS[m]}>{METRIC_LABELS[m]}</span>
                <div className="relative h-2 overflow-hidden rounded-full bg-bg">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct + '%' }} />
                </div>
                <span className={'w-12 shrink-0 text-right font-mono text-xs tabular-nums ' + (v != null ? 'text-ink' : 'text-muted')}>{fmt3(v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Answer-centric case view: each case is a collapsible block. The header line is
// the question (plus its average score when collapsed); the body holds ground
// truth, answer, and the per-metric score bars.
export function CaseTable({ detail, bordered, scored }: { detail: RagasRunDetail; bordered?: boolean; scored?: boolean }) {
  // Answers only (no score chips) for: cancelled runs (incomplete scoring),
  // legacy direct calls (engine 'direct'), and no-scoring runs (METRICS='[]').
  // Live streaming passes `scored` explicitly since its detail stub has no metadata.
  const showScores =
    detail.status !== 'CANCELLED' && (scored ?? (detail.engine !== 'direct' && detail.metrics !== '[]'));
  // Collapsed by default — tracking the *opened* set keeps late-arriving
  // (streamed) rows collapsed too.
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const ids = detail.results.map((r) => r.ragas_result_id);
  const allClosed = opened.size === 0;
  const toggle = (id: number) =>
    setOpened((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const list = (
    <div className="divide-y divide-line">
      {ids.length > 1 && (
        <CollapseAllStrip allClosed={allClosed} onToggle={() => setOpened(allClosed ? new Set(ids) : new Set())} />
      )}
      {detail.results.map((r) => {
        const isClosed = !opened.has(r.ragas_result_id);
        const mean = caseMean(r);
        return (
          <div key={r.ragas_result_id}>
            <button
              type="button"
              onClick={() => toggle(r.ragas_result_id)}
              className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
            >
              <Chevron open={!isClosed} className="mt-1" />
              <span className={cn('min-w-0 flex-1 text-sm text-ink', isClosed ? 'truncate' : 'whitespace-pre-wrap break-words font-medium')}>
                {r.question ?? '—'}
              </span>
              {isClosed && r.answer && (
                <span className="mt-0.5 min-w-0 flex-1 truncate text-xs text-muted">{r.answer}</span>
              )}
              {isClosed && showScores && (
                mean != null
                  ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted">평균 <span className="font-semibold text-ink">{fmt3(mean)}</span></span>
                  : r.answer == null && r.error_msg
                    ? <span className="shrink-0 text-[11px] text-bad">오류</span>
                    : <span className="shrink-0 text-[11px] text-muted">채점 중…</span>
              )}
            </button>
            {!isClosed && (
              <div className={cn('px-4 pb-3.5 pl-10', !!r.ground_truth && 'grid gap-4 sm:grid-cols-2')}>
                {r.ground_truth && (
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Ground truth</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{r.ground_truth}</p>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">답변</p>
                  <div className="mt-0.5"><AnswerBox text={r.answer} error={r.error_msg} /></div>
                  {showScores && <div className="mt-3"><ScoreBars row={r} /></div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {detail.results.length === 0 && (
        <div className="py-8 text-center text-xs text-muted">결과가 없습니다</div>
      )}
    </div>
  );
  if (detail.error_msg) {
    return (
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <div className="border-b border-line bg-bad/5 px-3 py-2 text-xs text-bad">{detail.error_msg}</div>
        {list}
      </div>
    );
  }
  return bordered ? <div className="overflow-hidden rounded-sm border border-line bg-surface">{list}</div> : list;
}
