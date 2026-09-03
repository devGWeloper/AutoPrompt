'use client';

import { useMemo, type ReactNode } from 'react';
import { comparablePair } from '@/lib/exactMatch';
import { diffWords, type DiffSeg } from '@/lib/textDiff';
import { cn } from '@/lib/cn';
import type { RagasResultRow } from '@/lib/types';
import { AnswerBox, CopyButton, ElapsedTag, OxBadge } from './shared';

/**
 * What was scored, next to what it was supposed to be.
 *
 * The two texts sit in one bordered block, aligned, with the parts that have no
 * counterpart on the other side highlighted — so 일치/불일치 is something the
 * screen shows rather than something the reader has to check word by word. Both
 * panes are the form the verdict came from (see `comparablePair`), which is why
 * an O never carries a highlight.
 *
 * The scored side is labelled, because it is not always the answer: when the run
 * captured an intermediate variable, that is what the O/X was decided from and
 * the final answer is beside the point.
 */

/** The pane's text, with unmatched runs marked. */
function DiffText({ segs, tone, mono }: { segs: DiffSeg[]; tone: 'left' | 'right'; mono?: boolean }) {
  return (
    <div
      className={cn(
        'max-h-72 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-ink',
        mono ? 'font-mono text-xs' : 'text-sm',
      )}
    >
      {segs.map((s, i) =>
        s.same ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark
            key={i}
            className={cn(
              'rounded-[2px] px-px',
              tone === 'left' ? 'bg-bad-soft text-bad' : 'bg-ok-soft text-ok',
            )}
          >
            {s.text}
          </mark>
        ),
      )}
    </div>
  );
}

/** The chip that names a pane. 'left' is the side under judgement — it is the
 * one the reader has to find first, so it is the only one that carries colour. */
export function PaneLabel({ children, tone }: { children: string; tone: 'left' | 'right' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.6px]',
        tone === 'left' ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface-2 text-muted',
      )}
    >
      {children}
    </span>
  );
}

function Pane({
  label, tag, raw, segs, tone, mono, empty,
}: {
  label: string;
  tag?: string | null;
  raw: string;
  segs: DiffSeg[];
  tone: 'left' | 'right';
  mono?: boolean;
  /** Shown in place of the text while there is none — a live run reaches this
   * pane before its answer does, and an empty box reads as a broken one. */
  empty?: ReactNode;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <PaneLabel tone={tone}>{label}</PaneLabel>
        {tag && (
          <span className="truncate rounded-sm border border-line px-1 py-px font-mono text-[10px] text-muted">
            {tag}
          </span>
        )}
        <span className="ml-auto">{raw && <CopyButton text={raw} />}</span>
      </div>
      {raw === '' && empty ? empty : <DiffText segs={segs} tone={tone} mono={mono} />}
    </div>
  );
}

export function MatchDiff({ row }: { row: RagasResultRow }) {
  const scoredRaw = row.trace_value ?? row.answer ?? '';
  const expectedRaw = row.ground_truth ?? '';
  const pair = useMemo(
    // A traced variable is compared whole: its own `body` key is data, not an
    // envelope, so it must not be unwrapped (see MatchOpts).
    () => comparablePair(scoredRaw, expectedRaw, { unwrapBody: !row.trace_value }),
    [scoredRaw, expectedRaw, row.trace_value],
  );
  const diff = useMemo(() => diffWords(pair.left, pair.right), [pair.left, pair.right]);

  return (
    <div className="overflow-hidden rounded-sm border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
        <span className="eyebrow">채점 대상 · 기대 정답</span>
        {row.exact_match != null && <OxBadge value={row.exact_match} />}
        <span className="ml-auto"><ElapsedTag ms={row.elapsed_ms} ttft={row.ttft_ms} /></span>
      </div>
      <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <Pane
          label={row.trace_value ? '채점 대상' : '답변'}
          tag={row.trace_value ? row.trace_var_nm || 'trace' : null}
          raw={scoredRaw}
          segs={diff.left}
          tone="left"
          mono={pair.json}
          empty={<AnswerBox text={row.answer} error={row.error_msg} />}
        />
        <Pane label="기대 정답" raw={expectedRaw} segs={diff.right} tone="right" mono={pair.json} />
      </div>
    </div>
  );
}

/** One side of an A/B case against the shared ground truth. Same highlighting,
 * without the second pane — the expected answer is above the pair, not repeated
 * under each side. */
export function DiffAgainst({
  text, expected, unwrapBody, className,
}: {
  text: string | null | undefined;
  expected: string | null | undefined;
  unwrapBody?: boolean;
  className?: string;
}) {
  const pair = useMemo(() => comparablePair(text ?? '', expected ?? '', { unwrapBody }), [text, expected, unwrapBody]);
  const diff = useMemo(() => diffWords(pair.left, pair.right), [pair.left, pair.right]);
  return (
    <div className={className}>
      <DiffText segs={diff.left} tone="left" mono={pair.json} />
    </div>
  );
}

export default MatchDiff;
