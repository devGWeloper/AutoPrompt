'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  comparablePair,
  structuredMatch,
  type FieldResult,
  type FieldStatus,
  type StructuredMatch,
} from '@/lib/exactMatch';
import { diffWords, type DiffSeg } from '@/lib/textDiff';
import { cn } from '@/lib/cn';
import type { RagasResultRow } from '@/lib/types';
import { AnswerBox, CopyButton, ElapsedTag, OxBadge } from './shared';

/**
 * What was scored, next to what it was supposed to be.
 *
 * Two readings of the same comparison, and the reader picks:
 *
 * · 키별 — the default whenever both sides are JSON. One row per leaf key, so
 *   "왜 불일치인가" is answered by name: this key never came back, this one is a
 *   string where a number was asked for, this one the node invented. The rows
 *   come from `structuredMatch`, which is also what decided the verdict, so the
 *   table can never contradict the badge above it.
 * · 원본 — the two texts aligned, with the parts that have no counterpart on the
 *   other side highlighted. The fallback for prose answers, and the way to read
 *   a value in full.
 *
 * The scored side is labelled, because it is not always the answer: when the run
 * captured an intermediate variable, that is what the verdict was decided from
 * and the final answer is beside the point.
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

/** 키 하나가 어떻게 판정됐는지 — 이름과 색. '추가'만 warn 인 까닭은, 나머지 셋이
 * "기대한 것이 그대로 오지 않았다"인 반면 이것은 "묻지 않은 것이 더 왔다"라서
 * 고칠 곳이 프롬프트가 아니라 기대 정답인 경우가 잦기 때문이다. */
const STATUS: Record<FieldStatus, { label: string; text: string; rail: string }> = {
  match: { label: '일치', text: 'text-muted', rail: 'border-l-transparent' },
  diff: { label: '값 다름', text: 'text-bad', rail: 'border-l-bad-line' },
  type: { label: '타입 다름', text: 'text-bad', rail: 'border-l-bad-line' },
  missing: { label: '누락', text: 'text-bad', rail: 'border-l-bad-line' },
  extra: { label: '추가', text: 'text-warn', rail: 'border-l-warn-line' },
};

const CELL = 'border-b border-line px-3 py-1.5 align-top';

/** 값이 아예 없는 쪽 — 빈 칸으로 두면 '빈 문자열이 왔다'로도 읽힌다. */
function Absent({ children }: { children: string }) {
  return <span className="text-[11px] text-muted-soft">{children}</span>;
}

function FieldRow({ f }: { f: FieldResult }) {
  const s = STATUS[f.status];
  const ok = f.status === 'match';
  return (
    <tr>
      <td className={cn(CELL, 'border-l-2 font-mono text-ink', s.rail)}>
        {f.path || <span className="text-muted">(전체)</span>}
      </td>
      <td className={cn(CELL, 'break-all font-mono', ok ? 'text-muted' : 'text-ok')}>
        {f.expected === null ? <Absent>기대에 없음</Absent> : f.expected}
      </td>
      <td className={cn(CELL, 'break-all font-mono', ok ? 'text-muted' : 'text-bad')}>
        {f.actual === null ? <Absent>응답에 없음</Absent> : f.actual}
      </td>
      <td className={cn(CELL, 'whitespace-nowrap font-medium', s.text)}>{s.label}</td>
    </tr>
  );
}

/** 키 단위 판정표. 기대 정답에 적힌 순서 그대로 읽히고, 어긋난 줄만 왼쪽에 색
 * 레일이 선다 — 키가 스무 개여도 눈이 갈 곳은 그 줄들이다. */
function FieldTable({ m }: { m: StructuredMatch }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 bg-surface-2 text-left text-[10px] uppercase tracking-[0.6px] text-muted">
          <tr>
            <th className="border-b border-line px-3 py-1.5 font-semibold">키</th>
            <th className="border-b border-line px-3 py-1.5 font-semibold">기대값</th>
            <th className="border-b border-line px-3 py-1.5 font-semibold">실제값</th>
            <th className="w-px border-b border-line px-3 py-1.5 font-semibold">결과</th>
          </tr>
        </thead>
        <tbody className="[&>tr:hover]:bg-surface-2/60 [&>tr:last-child>td]:border-b-0">
          {m.fields.map((f) => (
            <FieldRow key={f.path + '·' + f.status} f={f} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 표 위 한 줄 요약: 몇 개 중 몇 개가 맞았고, 틀린 것은 어떤 종류인지. 일치/불일치
 * 배지만으로는 "키 하나 때문인지 전부 어긋났는지"를 알 수 없다. */
function FieldSummary({ m }: { m: StructuredMatch }) {
  const kinds: FieldStatus[] = ['diff', 'type', 'missing', 'extra'];
  const counts = kinds
    .map((k) => [k, m.fields.filter((f) => f.status === k).length] as const)
    .filter(([, n]) => n > 0);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
      <span className="font-mono tabular-nums">
        키 <span className="font-semibold text-ink">{m.matched}</span>/{m.total}
      </span>
      {counts.map(([k, n]) => (
        <span key={k} className={STATUS[k].text}>
          {STATUS[k].label} {n}
        </span>
      ))}
    </span>
  );
}

/** 같은 비교를 읽는 두 가지 방법 사이의 토글. */
function ViewToggle({ raw, onRaw }: { raw: boolean; onRaw: (v: boolean) => void }) {
  const opts: [string, boolean][] = [['키별', false], ['원본', true]];
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-sm border border-line">
      {opts.map(([label, v]) => (
        <button
          key={label}
          type="button"
          onClick={() => onRaw(v)}
          className={cn(
            'px-1.5 py-0.5 text-[10px] font-medium transition-colors',
            raw === v ? 'bg-surface text-ink' : 'text-muted hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

export function MatchDiff({ row }: { row: RagasResultRow }) {
  const scoredRaw = row.trace_value ?? row.answer ?? '';
  const expectedRaw = row.ground_truth ?? '';
  // A traced variable is compared whole: its own `body` key is data, not an
  // envelope, so it must not be unwrapped (see MatchOpts).
  const unwrapBody = !row.trace_value;
  const fields = useMemo(
    () => structuredMatch(scoredRaw, expectedRaw, { unwrapBody }),
    [scoredRaw, expectedRaw, unwrapBody],
  );
  const pair = useMemo(
    () => comparablePair(scoredRaw, expectedRaw, { unwrapBody }),
    [scoredRaw, expectedRaw, unwrapBody],
  );
  const diff = useMemo(() => diffWords(pair.left, pair.right), [pair.left, pair.right]);
  const [raw, setRaw] = useState(false);

  return (
    <div className="overflow-hidden rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface-2 px-3 py-1.5">
        <span className="eyebrow">채점 대상 · 기대 정답</span>
        {row.exact_match != null && <OxBadge value={row.exact_match} />}
        {fields && <FieldSummary m={fields} />}
        <span className="ml-auto flex items-center gap-2">
          {fields && <ViewToggle raw={raw} onRaw={setRaw} />}
          <ElapsedTag ms={row.elapsed_ms} ttft={row.ttft_ms} />
        </span>
      </div>
      {fields && !raw ? (
        <FieldTable m={fields} />
      ) : (
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
      )}
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

/** 어긋난 키 이름만 한 줄로. A/B 비교에는 판정표를 두 벌 놓을 자리가 없어서,
 * 어느 키가 갈렸는지까지만 각 사이드 위에 적는다. 맞은 실행에서는 아무것도
 * 그리지 않는다 — 빈 줄이 곧 '어긋난 키 없음'이다. */
export function FieldDiffLine({
  text, expected, unwrapBody, className,
}: {
  text: string | null | undefined;
  expected: string | null | undefined;
  unwrapBody?: boolean;
  className?: string;
}) {
  const m = useMemo(
    () => structuredMatch(text ?? '', expected ?? '', { unwrapBody }),
    [text, expected, unwrapBody],
  );
  if (!m || m.ok) return null;
  const bad = m.fields.filter((f) => f.status !== 'match');
  return (
    <span className={cn('flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px]', className)}>
      {bad.slice(0, 6).map((f) => (
        <span
          key={f.path + '·' + f.status}
          title={STATUS[f.status].label}
          className={cn(
            'rounded-sm border px-1 py-px font-mono',
            f.status === 'extra'
              ? 'border-warn-line bg-warn-soft text-warn'
              : 'border-bad-line bg-bad-soft text-bad',
          )}
        >
          {f.path || '(전체)'}
        </span>
      ))}
      {bad.length > 6 && <span className="text-muted">외 {bad.length - 6}</span>}
    </span>
  );
}

export default MatchDiff;
