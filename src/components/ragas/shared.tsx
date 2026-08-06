'use client';

import { useCallback, useEffect, useState } from 'react';
import { Select } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  ALL_METRICS,
  EXACT_MATCH,
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

type Scored = { [K in RagasMetric]?: number | null };

// Overall run score = mean of the available metric averages (null if none
// scored). Accepts anything carrying the metric fields (details and summaries).
export function runMean(d: Scored): number | null {
  const vs = ALL_METRICS.map((m) => d[m]).filter((v): v is number => v != null);
  return vs.length ? vs.reduce((s, v) => s + Number(v), 0) / vs.length : null;
}

// Mean of one case's available metric scores (null until something is scored).
export function caseMean(r: RagasResultRow | undefined): number | null {
  if (!r) return null;
  const vs = ALL_METRICS.map((m) => r[m]).filter((v): v is number => v != null);
  return vs.length ? vs.reduce((s, v) => s + Number(v), 0) / vs.length : null;
}

/** Metrics that actually carry a score — the only ones worth rendering. */
export function scoredMetrics(d: Scored): RagasMetric[] {
  return ALL_METRICS.filter((m) => d[m] != null);
}

/** True when 정답 일치 is the only thing scored → show O/X instead of an average. */
export function exactOnly(d: Scored): boolean {
  const s = scoredMetrics(d);
  return s.length === 1 && s[0] === EXACT_MATCH;
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

/** '채점' master switch, shared by every run mode. */
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
      <span className={cn('transition-colors', on ? 'text-ink' : 'text-muted')}>채점</span>
    </button>
  );
}

function Chip({
  label, on, onClick, title, strong,
}: { label: string; on: boolean; onClick: () => void; title?: string; strong?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
        strong ? 'font-semibold' : 'font-medium',
        on ? 'border-accent/25 bg-accent-soft/60 text-accent' : 'border-transparent text-muted hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}

/**
 * Evaluation-option picker: two groups — 정답 일치 (no LLM) and RAGAS. Turning
 * RAGAS on selects all five metrics and reveals them for individual picking;
 * turning it off (or deselecting all five) hides them again.
 */
export function EvalOptions({ metrics, setMetrics }: { metrics: string[]; setMetrics: (f: (cur: string[]) => string[]) => void }) {
  const exactOn = metrics.includes(EXACT_MATCH);
  const ragasOn = RAGAS_METRICS.some((m) => metrics.includes(m));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          strong
          label={METRIC_LABELS[EXACT_MATCH]}
          title={METRIC_DESCRIPTIONS[EXACT_MATCH]}
          on={exactOn}
          onClick={() => setMetrics((cur) => (exactOn ? cur.filter((x) => x !== EXACT_MATCH) : [...cur, EXACT_MATCH]))}
        />
        <Chip
          strong
          label="RAGAS"
          title="심판 LLM으로 채점하는 RAGAS 지표입니다. 켜면 아래에서 지표를 고를 수 있습니다."
          on={ragasOn}
          onClick={() =>
            setMetrics((cur) =>
              ragasOn
                ? cur.filter((x) => !RAGAS_METRICS.includes(x as (typeof RAGAS_METRICS)[number]))
                : [...cur, ...RAGAS_METRICS],
            )
          }
        />
      </div>
      {ragasOn && (
        <div className="ml-1 flex flex-wrap items-center gap-1.5 border-l-2 border-line pl-3">
          {RAGAS_METRICS.map((m) => (
            <Chip
              key={m}
              label={METRIC_LABELS[m]}
              title={METRIC_DESCRIPTIONS[m]}
              on={metrics.includes(m)}
              onClick={() => setMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A/B side label: the prompt version when one was chosen, otherwise the side is
 * identified by its own endpoint (A/B across two endpoints). */
export const sideLabel = (label: string) => (label ? `v${label}` : '엔드포인트');

export function DatasetSelect({ datasets, value, onChange }: { datasets: Dataset[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="w-48">
      <option value="" disabled>Dataset</option>
      {datasets.map((d) => (
        <option key={d.dataset_id} value={d.dataset_id}>
          {d.dataset_nm}{d.case_count != null ? ` (${d.case_count})` : ''}
        </option>
      ))}
    </Select>
  );
}

export function VersionSelect({ versions, value, onChange, placeholder, className }: { versions: PromptVersionSummary[]; value: number | null; onChange: (id: number) => void; placeholder: string; className?: string }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className={cn('w-36', className)}>
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

/** Placeholder for an answer that hasn't arrived yet. A bare '—' in error red
 * reads as a failure; a pulsing dot reads as "still running". */
export function PendingHint({ label = '응답 대기 중…', className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted', className)}>
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
      {label}
    </span>
  );
}

// Bounded, scrollable answer box.
export function AnswerBox({ text, error }: { text?: string | null; error?: string | null }) {
  if (text == null) return error ? <p className="text-sm text-bad">{error}</p> : <PendingHint />;
  return (
    <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm leading-relaxed text-ink">
      {text}
    </div>
  );
}

/** Pretty-print JSON for display; anything that isn't JSON is shown as-is. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Collapse whitespace so a captured value fits a one-line preview. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Marks a preview as showing a captured variable rather than the answer. */
export function TraceTag({ name }: { name?: string | null }) {
  return (
    <span className="shrink-0 rounded-sm border border-line px-1 py-px font-mono text-[10px] text-muted">
      {name || 'trace'}
    </span>
  );
}

/** One-line preview of what the case was actually judged on: the captured
 * variable when there is one, else the final answer. Previewing the answer next
 * to an O/X decided from something else reads as a bug. */
export function ScoredPreview({ row, className }: { row: RagasResultRow; className?: string }) {
  if (row.trace_value) {
    return (
      <span className={cn('flex min-w-0 items-baseline gap-1.5 text-xs text-muted', className)}>
        <TraceTag name={row.trace_var_nm} />
        <span className="min-w-0 flex-1 truncate">{oneLine(row.trace_value)}</span>
      </span>
    );
  }
  if (row.answer == null) {
    return row.error_msg
      ? <span className={cn('truncate text-xs text-bad', className)}>{oneLine(row.error_msg)}</span>
      : <PendingHint label="대기 중" className={className} />;
  }
  return <span className={cn('truncate text-xs text-muted', className)}>{row.answer}</span>;
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => { setDone(true); setTimeout(() => setDone(false), 1200); },
          () => {},
        );
      }}
      className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2"
    >
      {done ? '복사됨' : '복사'}
    </button>
  );
}

/** The intermediate variable this case was judged on — the endpoint's response
 * never carried it, so without this block there is no way to see what the O/X
 * was decided from, or to author the expected answer (copy it and edit). */
export function TraceValueBox({ row }: { row: RagasResultRow }) {
  if (!row.trace_value) return null;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
          {row.trace_var_nm || '중간 변수'}
        </p>
        <span className="text-[11px] text-muted">— 채점 대상</span>
        <CopyButton text={row.trace_value} />
      </div>
      <pre className="mt-0.5 max-h-72 overflow-auto rounded-sm border border-line bg-surface-2/50 px-2.5 py-2 text-xs leading-relaxed text-ink">
        {prettyJson(row.trace_value)}
      </pre>
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

/** 정답 일치 verdict: 1 → O, 0 → X (a run-level rate renders as a percentage). */
export function OxBadge({ value, rate }: { value: number | null; rate?: boolean }) {
  if (value == null) return <span className="text-[11px] text-muted">—</span>;
  const ok = rate ? value >= 1 : value >= 0.5;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/25 bg-bad/10 text-bad',
      )}
    >
      <span className="font-mono">{ok ? 'O' : 'X'}</span>
      {rate ? `${Math.round(value * 100)}% 일치` : ok ? '일치' : '불일치'}
    </span>
  );
}

export function ScoreBars({ row }: { row: RagasResultRow }) {
  const shown = scoredMetrics(row);
  if (!shown.length) {
    return row.answer == null && row.error_msg
      ? <span className="text-[11px] text-bad">{row.error_msg}</span>
      : <span className="text-[11px] text-muted">채점 중…</span>;
  }
  return (
    <div className="overflow-hidden rounded-sm border border-line bg-surface p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">평가 결과</p>
      <ul className="flex flex-col gap-2">
        {shown.map((m) => {
          const v = row[m] != null ? Number(row[m]) : null;
          if (m === EXACT_MATCH) {
            return (
              <li key={m} className="flex items-center gap-3">
                <span className="truncate text-[11px] text-muted" title={METRIC_DESCRIPTIONS[m]}>{METRIC_LABELS[m]}</span>
                <OxBadge value={v} />
              </li>
            );
          }
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
    </div>
  );
}

// Answer-centric case view: each case is a collapsible block. The header line is
// the question (plus its average score when collapsed); the body holds ground
// truth, answer, and the per-metric score bars.
export function CaseTable({ detail, bordered, scored, defaultAllOpen = false }: { detail: RagasRunDetail; bordered?: boolean; scored?: boolean; defaultAllOpen?: boolean }) {
  const showScores =
    detail.status !== 'CANCELLED' && (scored ?? (detail.engine !== 'direct' && detail.metrics !== '[]'));
  const ids = detail.results.map((r) => r.ragas_result_id);
  const [opened, setOpened] = useState<Set<number>>(() =>
    defaultAllOpen ? new Set(ids) : new Set()
  );
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
              {isClosed && <ScoredPreview row={r} className="mt-0.5 min-w-0 flex-1" />}
              {isClosed && showScores && (
                exactOnly(r)
                  ? <span className="shrink-0"><OxBadge value={r.exact_match} /></span>
                  : mean != null
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
                <TraceValueBox row={r} />
                <div className={cn('min-w-0', r.trace_value && r.ground_truth && 'sm:col-span-2')}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                    답변{r.trace_value && <span className="ml-1.5 font-normal normal-case tracking-normal">· 채점 대상 아님</span>}
                  </p>
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
