'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Select } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { parseModelSnapshot } from '@/lib/modelSnapshot';
import {
  ALL_METRICS,
  EXACT_MATCH,
  RAGAS_METRICS,
  METRIC_LABELS,
  type RagasMetric,
  type Dataset,
  type DatasetCategory,
  type Endpoint,
  type LlmModel,
  type FlowCurrent,
  type FlowNode,
  type PromptVersionSummary,
  type RagasResultRow,
  type RagasRunDetail,
} from '@/lib/types';
import { MatchDiff, PaneLabel } from './MatchDiff';

// ---- formatting ------------------------------------------------------------

/** The server's `{detail}` is already a sentence written for this screen — show
 * it as-is. JSON.stringify would wrap it in quotes and escape it into a log line;
 * String(e) would prefix the class name. Only a non-string detail gets encoded. */
export const errText = (e: unknown) => {
  if (e instanceof ApiError) return typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
  return e instanceof Error ? e.message || String(e) : String(e);
};
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

/**
 * Mean of the available RAGAS metric scores — 정답 일치 is deliberately excluded.
 * It is a 0/1 verdict, not a graded score: averaging it in makes O + faithfulness
 * 0.6 read as 0.800, which is neither the match result nor the RAGAS quality.
 * The two are shown side by side instead (`OxBadge` + this mean).
 * Accepts anything carrying the metric fields — run details, summaries, or one case.
 */
export function ragasMean(d: Scored | undefined): number | null {
  if (!d) return null;
  const vs = RAGAS_METRICS.map((m) => d[m]).filter((v): v is number => v != null);
  return vs.length ? vs.reduce((s, v) => s + Number(v), 0) / vs.length : null;
}

export const runMean = ragasMean;
export const caseMean = ragasMean;

/** Metrics that actually carry a score — the only ones worth rendering. */
export function scoredMetrics(d: Scored): RagasMetric[] {
  return ALL_METRICS.filter((m) => d[m] != null);
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

/** '채점' master switch, shared by every run mode. 라벨은 바로 앞 InlineField 가
 * 이미 달고 있어서 스위치는 상태만 보인다. */
export function ScoreToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      aria-label="채점"
      className="group inline-flex items-center whitespace-nowrap"
    >
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
          on ? 'border-primary bg-primary' : 'border-line-strong bg-surface-3 group-hover:bg-line',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(8,8,8,0.35)] transition-transform',
            on && 'translate-x-3',
          )}
        />
      </span>
    </button>
  );
}

/**
 * 하나의 지표 선택. 버튼이 아니라 체크박스인 이유는 이게 '누르는 동작'이 아니라
 * '고르는 목록'이기 때문이다 — 눌린 버튼과 안 눌린 버튼을 색으로 구별하는 대신,
 * 체크 표시가 무엇이 켜져 있는지 한눈에 답한다.
 */
function Check({
  label, checked, indeterminate, onChange, strong,
}: {
  label: string;
  checked: boolean;
  /** RAGAS 묶음이 일부만 선택된 상태. */
  indeterminate?: boolean;
  onChange: () => void;
  strong?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // indeterminate 는 속성이 아니라 프로퍼티라 JSX 로는 설정할 수 없다.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label
      className="inline-flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap"
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
      />
      <span
        className={cn(
          'transition-colors',
          strong ? 'text-xs font-semibold' : 'text-[11px] font-medium',
          checked || indeterminate ? 'text-ink' : 'text-muted',
        )}
      >
        {label}
      </span>
    </label>
  );
}

/**
 * Evaluation-option picker: two groups — 정답 일치 (no LLM) and RAGAS. Turning
 * RAGAS on selects all five metrics and reveals them for individual picking;
 * turning it off (or deselecting all five) hides them again.
 *
 * 채점 스위치 바로 옆, 실행 조건 줄에 그대로 선다 — 켠 다음 무엇을 잴지가 이어지는
 * 한 문장이라 떨어뜨려 놓으면 스위치만 켜고 지나치게 된다. RAGAS 상자는 다섯 중
 * 일부만 켜져 있으면 indeterminate 라, 요약과 실제 선택이 어긋나 보이지 않는다.
 */
export function EvalOptions({ metrics, setMetrics }: { metrics: string[]; setMetrics: (f: (cur: string[]) => string[]) => void }) {
  const exactOn = metrics.includes(EXACT_MATCH);
  const chosen = RAGAS_METRICS.filter((m) => metrics.includes(m));
  const allRagas = chosen.length === RAGAS_METRICS.length;
  const ragasOn = chosen.length > 0;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2">
      <Check
        strong
        label={METRIC_LABELS[EXACT_MATCH]}
        checked={exactOn}
        onChange={() => setMetrics((cur) => (exactOn ? cur.filter((x) => x !== EXACT_MATCH) : [...cur, EXACT_MATCH]))}
      />
      <InlineDivider />
      <Check
        strong
        label="RAGAS"
        checked={allRagas}
        indeterminate={ragasOn && !allRagas}
        onChange={() =>
          setMetrics((cur) =>
            ragasOn
              ? cur.filter((x) => !RAGAS_METRICS.includes(x as (typeof RAGAS_METRICS)[number]))
              : [...cur, ...RAGAS_METRICS],
          )
        }
      />
      {ragasOn && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l border-line pl-3">
          {RAGAS_METRICS.map((m) => (
            <Check
              key={m}
              label={METRIC_LABELS[m]}
              checked={metrics.includes(m)}
              onChange={() => setMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
            />
          ))}
        </span>
      )}
    </div>
  );
}

/** A/B 사이드 이름: 버전을 고른 실행이면 그 버전, 아니면 바꾼 것이 없다는 뜻이라
 * 대상 토글과 같은 이름으로 적는다. */
export const sideLabel = (label: string) => (label ? `v${label}` : 'Default');

/** 이 실행이 무엇을 바꿔서 돌았는지 — 실행 폼의 대상 토글이 쓰는 이름 그대로.
 * 프롬프트 버전을 올린 실행은 노드·버전으로 따로 적히므로 여기서 가르는 것은
 * 나머지 둘이다: 모델을 고정했으면 Model, 아무것도 바꾸지 않았으면 Default. */
export function runTargetLabel(r: { model_snapshot: string | null }): 'Model' | 'Default' {
  return r.model_snapshot ? 'Model' : 'Default';
}

/** 같은 이름에 무엇을 바꿨는지까지 붙인, 목록에 적히는 제목. 대상이 Model 인
 * 실행들은 이름만으로는 서로 구별되지 않는데, 그 실행에서 유일하게 다른 값이
 * 모델명이라 그것이 곧 제목의 나머지 절반이 된다. 역할이 여럿이면 첫 모델과
 * 나머지 개수까지만 — 전체 조합은 아래 서브라인이 이미 적고 있다. */
export function runTargetTitle(r: { model_snapshot: string | null }): string {
  const base = runTargetLabel(r);
  if (base !== 'Model') return base;
  const parsed = parseModelSnapshot(r.model_snapshot);
  const names = Array.from(
    new Set(Object.values(parsed ?? {}).map((e) => e.model).filter((m): m is string => !!m)),
  );
  if (!names.length) return base;
  return `Model · ${names[0]}${names.length > 1 ? ` 외 ${names.length - 1}` : ''}`;
}

// ---- run progress ----------------------------------------------------------

/** How far a live run has got, counted from the rows themselves. Answers land in
 * phase 1 and RAGAS scores in phase 2, so they advance one after the other. */
export function runProgress(rows: RagasResultRow[], total: number, metrics?: RagasMetric[] | null) {
  const answered = rows.filter((r) => r.answer != null || r.error_msg != null).length;
  // 정답 일치 is decided during phase 1, so counting it here would show scoring
  // as finished before the judge LLM has been called even once.
  const ragasDone = rows.filter((r) => RAGAS_METRICS.some((m) => r[m] != null) || (r.answer != null && r.error_msg != null)).length;
  const hasRagas = metrics ? metrics.some((m) => m !== EXACT_MATCH) : false;
  return { answered, ragasDone, hasRagas, total };
}

function Bar({ done, total, tone }: { done: number; total: number; tone: 'accent' | 'muted' }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <span className="relative block h-1 w-full overflow-hidden rounded-full bg-surface-3">
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-300', tone === 'accent' ? 'bg-accent' : 'bg-muted/50')}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * Two-phase progress for a running evaluation. RAGAS scoring can take minutes
 * with no visible change — every row already shows its answer by then — so the
 * scoring phase gets its own labelled bar rather than sharing one with answers.
 */
export function RunProgress({
  rows, total, scoreOn, metrics, className,
}: {
  rows: RagasResultRow[];
  total: number;
  scoreOn: boolean;
  metrics?: RagasMetric[] | null;
  className?: string;
}) {
  const { answered, ragasDone, hasRagas } = runProgress(rows, total, metrics);
  const answering = total === 0 || answered < total;
  const scoring = !answering && scoreOn && hasRagas && ragasDone < total;
  const n = total || '…';
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2 text-xs">
        {(answering || scoring) && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
        <span className={cn('font-medium', answering ? 'text-ink' : 'text-muted')}>
          답변 {answered}/{n}
        </span>
        {scoreOn && hasRagas && (
          <>
            <span className="text-muted/50">·</span>
            <span className={cn('font-medium', scoring ? 'text-ink' : 'text-muted')}>
              RAGAS 채점 {ragasDone}/{n}
            </span>
          </>
        )}
      </div>
      <div className={cn('grid gap-1', scoreOn && hasRagas ? 'grid-cols-2' : 'grid-cols-1')}>
        <Bar done={answered} total={total} tone={answering ? 'accent' : 'muted'} />
        {scoreOn && hasRagas && <Bar done={ragasDone} total={total} tone={scoring ? 'accent' : 'muted'} />}
      </div>
    </div>
  );
}

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

/**
 * One dataset's folders, with how many cases each holds. Fetched per selection
 * rather than carried on the dataset list: it is only ever needed for the one
 * dataset in front of you, and it has to be right at the moment a run starts.
 *
 * `reload` is what the dataset screen calls after making, renaming or removing a
 * folder — the same list drives the sidebar and the run picker.
 */
export function useDatasetCategories(datasetId: number | null) {
  const [cats, setCats] = useState<DatasetCategory[]>([]);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    if (datasetId == null) { setCats([]); return; }
    let alive = true;
    const done = (next: DatasetCategory[]) => { if (alive) setCats(next); };
    api.get<DatasetCategory[]>(`/datasets/${datasetId}/case-types`).then(done).catch(() => done([]));
    return () => { alive = false; };
  }, [datasetId, seq]);
  const reload = useCallback(() => setSeq((n) => n + 1), []);
  return { cats, setCats, reload };
}

/** TYPE_CD's column default is what the UI calls 폴더 없음. */
export const UNFILED = 'NORMAL';
export const folderLabel = (t: string) => (t === UNFILED ? '폴더 없음' : t);

/** Narrow a run to one folder of the chosen dataset. null = the whole dataset.
 *
 * Absent while the dataset has only one group: a picker whose choices are 전체
 * and the single group it contains is two ways to say the same run. */
export function CategorySelect({
  cats, value, onChange,
}: { cats: DatasetCategory[]; value: string | null; onChange: (v: string | null) => void }) {
  if (cats.length < 2) return null;
  const total = cats.reduce((n, c) => n + c.case_count, 0);
  return (
    <Select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-40"
      title="이 폴더의 케이스만 실행합니다"
    >
      <option value="">전체 ({total})</option>
      {cats.map((c) => (
        <option key={c.type_cd} value={c.type_cd} disabled={c.case_count === 0}>
          {folderLabel(c.type_cd)} ({c.case_count})
        </option>
      ))}
    </Select>
  );
}

export function VersionSelect({
  versions, value, onChange, placeholder, className,
}: { versions: PromptVersionSummary[]; value: number | null; onChange: (id: number) => void; placeholder: string; className?: string }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className={cn('w-36', className)}>
      <option value="" disabled>{placeholder}</option>
      {versions.map((v) => (
        <option key={v.prompt_id} value={v.prompt_id}>v{v.version_no}</option>
      ))}
    </Select>
  );
}

/**
 * 프롬프트 버전을 대상으로 한 실행이 현재 사용할 수 없는 상태여서, Single ·
 * Compare 양쪽의 "프롬프트 버전" 대상을 임시로 막아둔다. 다시 열 때는 이 값만
 * true 로 되돌리면 되고, 그 아래 동작 코드는 손대지 않았다.
 */
export const PROMPT_TARGET_ENABLED = false;

export function SegToggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; title?: string; disabled?: boolean }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          disabled={o.disabled}
          title={o.title}
          className={cn(
            'rounded-sm px-3.5 py-1.5 text-sm font-medium transition-colors',
            value === o.id ? 'bg-primary text-primary-fg' : 'text-muted hover:text-ink',
            // Not `disabled:opacity-50` alone — the point is that it stays
            // readable as a real option that is simply out of service.
            o.disabled && 'cursor-not-allowed text-muted/50 hover:text-muted/50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const dot =
    status === 'done' ? 'bg-ok-vivid'
    : status === 'failed' ? 'bg-bad-vivid'
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

// ---- icons -----------------------------------------------------------------

export function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.5v7m0 0L5.25 6.75M8 9.5l2.75-2.75M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.75 4.25h10.5M6.5 2.5h3M5.5 4.5l.4 8a1 1 0 0 0 1 .95h2.2a1 1 0 0 0 1-.95l.4-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M11.1 2.9a1.35 1.35 0 0 1 1.9 1.9l-6.6 6.6-2.5.6.6-2.5 6.6-6.6ZM10 4l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Arm-then-confirm state for a destructive action: the first click arms it, a
 * second within `ms` commits, and walking away disarms. Cheaper than a modal and
 * still hard to trigger by accident. */
export function useArmed(ms = 4000) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return [armed, setArmed] as const;
}

export function ErrBox({ msg }: { msg: string }) {
  return <div className="rounded-sm border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad">{msg}</div>;
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
    <div className="min-w-0 overflow-hidden rounded-sm border border-line bg-surface">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
        <PaneLabel tone="left">채점 대상</PaneLabel>
        <span className="truncate rounded-sm border border-line px-1 py-px font-mono text-[10px] text-muted">
          {row.trace_var_nm || 'trace'}
        </span>
        <span className="ml-auto"><CopyButton text={row.trace_value} /></span>
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-ink">
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
/** 글자를 끌어 고른 뒤 손을 떼면 브라우저는 그 동작도 클릭으로 센다 — 그대로
 * 두면 질문을 복사하려던 드래그가 방금 펼친 케이스를 도로 접는다. 고른 글자가
 * 남아 있는 클릭은 접기/펴기로 치지 않는다. */
export function hasTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}

/** 케이스 블록의 머리 줄. `<button>` 이 아니라 role=button 인 div 인 까닭은
 * 브라우저가 버튼 안의 글자를 드래그로 고르지 못하게 막기 때문이다 — 여기 실린
 * 질문은 읽는 것만큼이나 복사해 가는 대상이다. 키보드 조작은 Enter/Space 로
 * 그대로 남긴다. */
export function DisclosureHeader({
  open, onToggle, children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => { if (!hasTextSelection()) onToggle(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
      }}
      className={cn(
        'flex w-full cursor-pointer items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/60',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
      )}
    >
      {children}
    </div>
  );
}

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
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-2 py-0.5 text-[11px] font-semibold',
        ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/25 bg-bad/10 text-bad',
      )}
    >
      <span className="font-mono">{ok ? 'O' : 'X'}</span>
      {rate ? `${Math.round(value * 100)}% 일치` : ok ? '일치' : '불일치'}
    </span>
  );
}

/** ms → seconds, always. Minutes are never used: a 92초 call sits next to the
 * 90초 timeout on the same scale, which '1분 32초' hides. Tenths stay because
 * the gap between 2.1초 and 2.9초 is the point when comparing endpoints. */
export function fmtElapsed(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  return `${(ms / 1000).toFixed(1)}초`;
}

/** How long the endpoint took to answer this case. Deliberately quiet — it is
 * context for the answer, not a verdict, so it never competes with the score. */
export function ElapsedTag({ ms, className }: { ms: number | null | undefined; className?: string }) {
  const text = fmtElapsed(ms);
  if (text === null) return null;
  return (
    <span
      className={cn('shrink-0 font-mono text-[11px] tabular-nums text-muted', className)}
    >
      {text}
    </span>
  );
}

export function ScoreBars({ row, cancelled }: { row: RagasResultRow; cancelled?: boolean }) {
  const shown = scoredMetrics(row);
  if (!shown.length) {
    // A stopped run never reaches this case's scoring, so '채점 중…' would wait
    // for something that is never coming.
    if (cancelled && row.answer != null && !row.error_msg) {
      return <span className="text-[11px] text-muted">실행 취소 — 채점하지 않음</span>;
    }
    // ERROR_CTN carries both kinds of failure, told apart by whether the answer
    // arrived: without one the call itself died (and AnswerBox already says so);
    // with one, the message is the scorer's. Anything else is still in flight —
    // but a failed scorer is NOT, so it must never sit on '채점 중…' forever.
    if (row.answer == null) {
      return <span className="text-[11px] text-muted">{row.error_msg ? '답변 실패 — 채점하지 않음' : '채점 중…'}</span>;
    }
    return row.error_msg
      ? <span className="text-[11px] text-bad">채점 실패 — {row.error_msg}</span>
      : <span className="text-[11px] text-muted">채점 중…</span>;
  }
  return (
    <div className="overflow-hidden rounded-sm border border-line bg-surface p-3">
      <p className="mb-2 eyebrow">평가 결과</p>
      <ul className="flex flex-col gap-2">
        {shown.map((m) => {
          const v = row[m] != null ? Number(row[m]) : null;
          if (m === EXACT_MATCH) {
            return (
              <li key={m} className="flex items-center gap-3">
                <span className="truncate text-[11px] text-muted">{METRIC_LABELS[m]}</span>
                <OxBadge value={v} />
              </li>
            );
          }
          const pct = v != null ? Math.max(0, Math.min(1, v)) * 100 : 0;
          return (
            <li key={m} className="grid grid-cols-[minmax(92px,auto)_1fr_auto] items-center gap-3">
              <span className="truncate text-[11px] text-muted">{METRIC_LABELS[m]}</span>
              <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct + '%' }} />
              </div>
              <span className={'w-12 shrink-0 text-right font-mono text-xs tabular-nums ' + (v != null ? 'text-ink' : 'text-muted')}>{fmt3(v)}</span>
            </li>
          );
        })}
      </ul>
      {/* Selecting 정답 일치 + RAGAS together and having only the first succeed
          leaves a scored row that is quietly missing every LLM metric. The bars
          above can't show that, so the reason goes underneath them. */}
      {row.answer != null && row.error_msg && (
        <p className="mt-2.5 border-t border-line pt-2.5 text-[11px] text-bad">채점 실패 — {row.error_msg}</p>
      )}
    </div>
  );
}

// Answer-centric case view: each case is a collapsible block. The header line is
// the question (plus its average score when collapsed); the body holds ground
// truth, answer, and the per-metric score bars.
export function CaseTable({ detail, bordered, scored, defaultAllOpen = false }: { detail: RagasRunDetail; bordered?: boolean; scored?: boolean; defaultAllOpen?: boolean }) {
  // A cancelled run keeps whatever it scored before the stop, so its cases are
  // shown with scores like any other run — the ones that never got there say so.
  const cancelled = detail.status === 'CANCELLED';
  const showScores = scored ?? (detail.engine !== 'direct' && detail.metrics !== '[]');
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
            <DisclosureHeader open={!isClosed} onToggle={() => toggle(r.ragas_result_id)}>
              <Chevron open={!isClosed} className="mt-1" />
              <span className={cn('min-w-0 flex-1 text-sm text-ink', isClosed ? 'truncate' : 'whitespace-pre-wrap break-words font-medium')}>
                {r.question ?? '—'}
              </span>
              {/* 펼친 케이스의 질문은 그대로 다시 쓰이는 문장이다 — 끌어서 고를
                  수도 있고, 긴 질문은 이 버튼 하나로 통째로 가져간다. */}
              {!isClosed && r.question && (
                <span className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <CopyButton text={r.question} />
                </span>
              )}
              {isClosed && <ScoredPreview row={r} className="mt-0.5 min-w-0 flex-1" />}
              {isClosed && <ElapsedTag ms={r.elapsed_ms} className="mt-0.5" />}
              {isClosed && showScores && (
                <span className="flex shrink-0 items-center gap-2">
                  {/* O/X and the RAGAS mean stand on their own — a verdict and a
                      graded score answer different questions, so neither is
                      folded into the other. Both can be present at once. */}
                  {r.exact_match != null && <OxBadge value={r.exact_match} />}
                  {mean != null && (
                    <span className="font-mono text-xs tabular-nums text-muted">
                      RAGAS <span className="font-semibold text-ink">{fmt3(mean)}</span>
                    </span>
                  )}
                  {r.exact_match == null && mean == null && (
                    r.error_msg
                      ? <span className="text-[11px] text-bad" title={r.error_msg}>오류</span>
                      : <span className="text-[11px] text-muted">{cancelled ? '채점 안 함' : '채점 중…'}</span>
                  )}
                  {/* A row that scored *something* can still have a failed metric
                      behind it — the badge above would otherwise read as success. */}
                  {(r.exact_match != null || mean != null) && r.answer != null && r.error_msg && (
                    <span className="text-[11px] text-bad" title={r.error_msg}>일부 실패</span>
                  )}
                </span>
              )}
            </DisclosureHeader>
            {!isClosed && (
              <div className="space-y-3 px-4 pb-3.5 pl-10">
                {/* 기대 정답이 있으면 채점 대상 바로 옆에 놓고 다른 곳만 칠한다 —
                    O/X 를 눈으로 다시 검산하지 않아도 된다. 정답이 없는 실행은
                    비교할 짝이 없으니 채점 대상만 보여준다. */}
                {r.ground_truth ? <MatchDiff row={r} /> : <TraceValueBox row={r} />}
                {/* 답변이 곧 채점 대상이면 위 왼쪽 칸이 이미 그것이다. 중간 변수를
                    채점했거나 호출이 실패했을 때만 따로 편다. */}
                {(!r.ground_truth || r.trace_value || !!r.error_msg) && (
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="eyebrow">답변</p>
                      <ElapsedTag ms={r.elapsed_ms} />
                    </div>
                    <div className="mt-0.5"><AnswerBox text={r.answer} error={r.error_msg} /></div>
                  </div>
                )}
                {showScores && <ScoreBars row={r} cancelled={cancelled} />}
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

// ---- endpoint registry -----------------------------------------------------

/**
 * The APIs a run may call, as registered on the settings page. One list for the
 * whole app: Single and Compare both stay mounted, so a per-hook copy would let
 * one tab keep offering an endpoint the other one just removed.
 */
let endpointCache: Endpoint[] | null = null;
const endpointSubs = new Set<(next: Endpoint[]) => void>();

function publishEndpoints(next: Endpoint[]): void {
  endpointCache = next;
  for (const fn of endpointSubs) fn(next);
}

export function useEndpoints(): Endpoint[] {
  const [list, setList] = useState<Endpoint[]>(endpointCache ?? []);
  useEffect(() => {
    endpointSubs.add(setList);
    if (endpointCache === null) {
      api.get<Endpoint[]>('/endpoints?selectable=1').then(publishEndpoints).catch(() => publishEndpoints([]));
    } else {
      setList(endpointCache);
    }
    return () => {
      endpointSubs.delete(setList);
    };
  }, []);
  return list;
}



/** Nothing to show yet. An outline mark and the action's own name — the form
 * above already says what the action does, so this does not repeat it. */
export function EmptyState({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
      <span aria-hidden className="text-muted-soft">
        {icon ?? (
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="6.5" width="23" height="19" rx="2.5" />
            <path d="M4.5 12h23M11 12v13.5" />
          </svg>
        )}
      </span>
      <span className="text-body-sm text-muted">{label}</span>
    </div>
  );
}

/** The model names a role may be set to, as registered on the settings page.
 * Shared like the endpoint list, and for the same reason. */
let llmCache: LlmModel[] | null = null;
const llmSubs = new Set<(next: LlmModel[]) => void>();

function publishLlms(next: LlmModel[]): void {
  llmCache = next;
  for (const fn of llmSubs) fn(next);
}

export function useLlmModels(): LlmModel[] {
  const [list, setList] = useState<LlmModel[]>(llmCache ?? []);
  useEffect(() => {
    llmSubs.add(setList);
    if (llmCache === null) {
      api.get<LlmModel[]>('/llms').then(publishLlms).catch(() => publishLlms([]));
    } else {
      setList(llmCache);
    }
    return () => {
      llmSubs.delete(setList);
    };
  }, []);
  return list;
}

/** Link to where a missing prerequisite is registered. Shown in place of a
 * control that has nothing to offer yet, so the empty state is the next step. */
export function SettingsLink({ label }: { label: string }) {
  return (
    <a
      href="/settings"
      className="inline-flex items-center gap-1 text-caption text-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
    >
      {label} →
    </a>
  );
}

/** Pick the API this run calls. The list carries names only — the address is
 * settings' business, and it made every row long enough to hide the name. It
 * stays reachable as the control's tooltip. */
export function EndpointSelect({
  endpoints,
  value,
  onChange,
  className,
}: {
  endpoints: Endpoint[];
  value: number | null;
  onChange: (id: number) => void;
  className?: string;
}) {
  if (!endpoints.length) return <SettingsLink label="설정에서 API 등록" />;
  const picked = endpoints.find((e) => e.endpoint_id === value);
  return (
    <Select
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      title={picked?.endpoint_url}
      className={cn("h-9 w-48 text-xs", className)}
    >
      <option value="" disabled>
        API 선택
      </option>
      {endpoints.map((e) => (
        <option key={e.endpoint_id} value={e.endpoint_id}>
          {e.endpoint_nm}
        </option>
      ))}
    </Select>
  );
}

/** One setting on a shared line: a small label, then its controls. Replaces the
 * label-column rows so a whole run's settings fit in two lines. */
export function InlineField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      <span className="eyebrow shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** Hairline between two inline settings on the same line. */
export function InlineDivider() {
  return <span aria-hidden className="h-5 w-px shrink-0 bg-line" />;
}

/** What a call falls back to when the run form leaves a box empty — read from
 * the server's config so the form can show the value instead of describing it. */
export interface AgentDefaults {
  runMode: string;
  userId: string;
  timeoutSec: number;
}

let agentDefaults: AgentDefaults | null = null;
const agentDefaultSubs = new Set<(next: AgentDefaults | null) => void>();

export function useAgentDefaults(): AgentDefaults | null {
  const [d, setD] = useState<AgentDefaults | null>(agentDefaults);
  useEffect(() => {
    agentDefaultSubs.add(setD);
    if (agentDefaults === null) {
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { agent?: AgentDefaults } | null) => {
          agentDefaults = j?.agent ?? null;
          for (const fn of agentDefaultSubs) fn(agentDefaults);
        })
        .catch(() => {});
    }
    return () => {
      agentDefaultSubs.delete(setD);
    };
  }, []);
  return d;
}

/**
 * 직접 입력 칸이 처음 들고 있는 메시지.
 *
 * 폼이 채우는 건 요청 body 의 `message` 하나뿐이고 나머지 키는 서버가 붙인다
 * (`lib/services/externalAgent.ts` 의 buildPayload). 그 형식을 적어 두는 대신
 * 실제로 보낼 수 있는 한 줄을 넣어 둔다 — 그대로 눌러도 호출이 되고, 무엇을
 * 적는 자리인지도 같이 답한다.
 */
export const SAMPLE_MESSAGE = '!@#ActionNode#@! 5EASJ50_C AQ 취소';

/**
 * Settings changed — pull the shared lists again so a run screen that is already
 * mounted offers what was just registered. The caches above live for the life of
 * the tab, so without this a newly added model only appears after a full reload.
 */
export function refreshEndpoints(): void {
  endpointCache = null;
  api
    .get<Endpoint[]>('/endpoints?selectable=1')
    .then(publishEndpoints)
    .catch(() => publishEndpoints([]));
}

/** The settings page already holds the fresh list, so it is published directly
 * rather than re-fetched. */
export function setLlmCatalog(next: LlmModel[]): void {
  publishLlms(next);
}
