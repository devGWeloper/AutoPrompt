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
import { AnswerBox, CopyButton, ElapsedTag, OxBadge, TraceTag } from './shared';

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

/** 판정 하나가 입는 옷. 색은 세 군데에 같은 톤으로 나뉘어 나온다 — 행 왼쪽 레일,
 * 어긋난 값 칸의 면, 결과 칩 — 그래서 한 줄을 읽는 데 세 번 판단할 필요가 없다. */
interface StatusStyle {
  label: string;
  /** 요약 줄처럼 면 없이 이름만 놓는 자리의 글자색. */
  text: string;
  /** 결과 칸의 상태 칩. 일치는 테두리 없이 조용히 — 스무 줄이 전부 알약이면
   * 어긋난 줄이 도리어 묻힌다. */
  chip: string;
  /** 행 왼쪽 3px 톤 레일 (선택 행·KPI 카드와 같은 장치). */
  rail: string;
  /** 두 값 칸의 면. 어긋난 줄에서만 칠하고, 값이 없는 쪽은 칠하지 않는다. */
  expected: string;
  actual: string;
}

const QUIET = 'text-muted';
const BAD = {
  text: 'text-bad',
  chip: 'border border-bad-line bg-bad-soft text-bad',
  rail: 'border-l-bad-vivid',
  expected: 'bg-ok-soft text-ok',
  actual: 'bg-bad-soft text-bad',
};

const STATUS: Record<FieldStatus, StatusStyle> = {
  match: { label: '일치', text: QUIET, chip: QUIET, rail: 'border-l-transparent', expected: QUIET, actual: QUIET },
  diff: { label: '값 다름', ...BAD },
  type: { label: '타입 다름', ...BAD },
  missing: { label: '누락', ...BAD },
  // '추가'만 warn 인 까닭은, 나머지 셋이 "기대한 것이 그대로 오지 않았다"인 반면
  // 이것은 "묻지 않은 것이 더 왔다"라서 고칠 곳이 프롬프트가 아니라 기대 정답인
  // 경우가 잦기 때문이다. 기대값 칸은 칠하지 않는다 — 거기엔 아무것도 없다.
  extra: {
    label: '추가',
    text: 'text-warn',
    chip: 'border border-warn-line bg-warn-soft text-warn',
    rail: 'border-l-warn-vivid',
    expected: QUIET,
    actual: 'bg-warn-soft text-warn',
  },
};

const CELL = 'border-b border-line px-3 py-2 align-top';
/** 열 사이 세로 헤어라인. 값이 두 칸에 걸쳐 읽히는 표라 가로줄만으로는 어느
 * 칸까지가 기대값인지 눈이 자꾸 놓친다. */
const COL = 'border-r border-line';

/** 값이 아예 없는 쪽 — 빈 칸으로 두면 '빈 문자열이 왔다'로도 읽힌다. */
function Absent({ children }: { children: string }) {
  return <span className="font-sans text-[11px] opacity-70">{children}</span>;
}

function FieldRow({ f }: { f: FieldResult }) {
  const s = STATUS[f.status];
  return (
    <tr className="transition-colors hover:bg-surface-2/70">
      <td className={cn(CELL, COL, 'border-l-[3px] font-mono text-ink', s.rail)}>
        {f.path || <span className="text-muted">(전체)</span>}
      </td>
      <td className={cn(CELL, COL, 'break-words font-mono', s.expected)}>
        {f.expected === null ? <Absent>기대에 없음</Absent> : f.expected}
      </td>
      <td className={cn(CELL, COL, 'break-words font-mono', s.actual)}>
        {f.actual === null ? <Absent>응답에 없음</Absent> : f.actual}
      </td>
      <td className={cn(CELL, 'whitespace-nowrap')}>
        <span className={cn('inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold', s.chip)}>
          {s.label}
        </span>
      </td>
    </tr>
  );
}

/** 키 단위 판정표. 기대 정답에 적힌 순서 그대로 읽히고, 어긋난 줄만 색을 갖는다
 * — 왼쪽 톤 레일과 어긋난 값 칸의 면, 그리고 결과 칩. 키가 스무 개여도 눈이 갈
 * 곳은 그 줄들이다.
 *
 * 열 너비는 고정 비율이다. 자동 폭은 값 하나가 길어질 때마다 열이 통째로 밀려,
 * 위아래 줄의 기대값·실제값이 서로 어긋난 자리에 서게 된다 — 나란히 읽으라고
 * 만든 표에서 그것만은 일어나면 안 된다. */
function FieldTable({ m }: { m: StructuredMatch }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-0 text-xs">
        <colgroup>
          <col style={{ width: '24%' }} />
          <col style={{ width: '30%' }} />
          <col style={{ width: '30%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[10px] uppercase tracking-[0.6px] text-muted">
          <tr>
            <th className={cn('border-b border-line px-3 py-2 font-semibold', COL)}>키</th>
            <th className={cn('border-b border-line px-3 py-2 font-semibold', COL)}>기대값</th>
            <th className={cn('border-b border-line px-3 py-2 font-semibold', COL)}>실제값</th>
            <th className="border-b border-line px-3 py-2 font-semibold">결과</th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
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
        키 <span className="font-semibold text-ink">{m.matched}</span>
        <span className="text-muted-soft">/{m.total}</span>
      </span>
      {counts.length > 0 && <span aria-hidden className="h-2.5 w-px self-center bg-line-strong" />}
      {counts.map(([k, n]) => (
        <span key={k} className={cn('font-medium', STATUS[k].text)}>
          {STATUS[k].label} <span className="font-mono tabular-nums">{n}</span>
        </span>
      ))}
    </span>
  );
}

/** 같은 비교를 읽는 두 가지 방법 사이의 토글 — 사이드바·상단 탭과 같은 세그먼트
 * 장치를 그대로 줄여 쓴다. */
export function ViewToggle({ raw, onRaw }: { raw: boolean; onRaw: (v: boolean) => void }) {
  const opts: [string, boolean][] = [['키별', false], ['원본', true]];
  return (
    <span className="inline-flex shrink-0 items-stretch gap-0.5 rounded-md border border-line bg-surface-3 p-0.5">
      {opts.map(([label, v]) => (
        <button
          key={label}
          type="button"
          onClick={() => onRaw(v)}
          aria-pressed={raw === v}
          className={cn(
            'rounded-sm px-2 py-0.5 text-[11px] font-semibold transition',
            raw === v ? 'bg-surface text-accent shadow-seg' : 'text-muted hover:text-ink',
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
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-surface-2 px-3 py-2">
        <span className="eyebrow">채점 대상 · 기대 정답</span>
        {/* 키별 표에는 변수 이름을 적을 자리가 없다 — 무엇을 채점했는지는 어느
            보기에서든 이 줄이 말한다. */}
        {row.trace_value && <TraceTag name={row.trace_var_nm} />}
        {(row.exact_match != null || fields) && (
          <span aria-hidden className="h-3 w-px self-center bg-line-strong" />
        )}
        {row.exact_match != null && <OxBadge value={row.exact_match} />}
        {fields && <FieldSummary m={fields} />}
        <span className="ml-auto flex items-center gap-2">
          {fields && <ViewToggle raw={raw} onRaw={setRaw} />}
          <ElapsedTag ms={row.elapsed_ms} />
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

/** 이 짝을 키별 판정표로 읽을 수 있나 — 한쪽이라도 구조가 잡히면 표가 선다.
 * 표가 서면 화면에서 물러나는 것들이 있어(기대 정답 상자, 사이드별 어긋난 키 줄)
 * 그리기 전에 물어볼 수 있어야 한다. */
export function canCompareFields(
  aText: string | null | undefined,
  bText: string | null | undefined,
  expected: string | null | undefined,
  unwrapA?: boolean,
  unwrapB?: boolean,
): boolean {
  return (
    !!structuredMatch(aText ?? '', expected ?? '', { unwrapBody: unwrapA }) ||
    !!structuredMatch(bText ?? '', expected ?? '', { unwrapBody: unwrapB })
  );
}

/** 한 키에 대한 A·B 두 판정. 어느 쪽도 그 키를 다루지 않았으면 그 칸은 비운다. */
interface PairRow {
  path: string;
  expected: string | null;
  a?: FieldResult;
  b?: FieldResult;
}

/** 한 사이드의 값 칸: 값 + (어긋났을 때만) 무엇이 어긋났는지. */
function PairCell({ f, last }: { f?: FieldResult; last?: boolean }) {
  if (!f) {
    return <td className={cn(CELL, !last && COL, 'text-muted-soft')}>—</td>;
  }
  const s = STATUS[f.status];
  return (
    <td className={cn(CELL, !last && COL, 'break-words font-mono', s.actual)}>
      {f.actual === null ? <Absent>응답에 없음</Absent> : f.actual}
      {f.status !== 'match' && (
        <span className={cn('ml-1.5 whitespace-nowrap rounded-full px-1 py-px align-middle text-[10px] font-semibold', s.chip)}>
          {s.label}
        </span>
      )}
    </td>
  );
}

/**
 * A/B 한 케이스의 키별 판정 — 한 표에 네 칸(키 · 기대값 · A · B).
 *
 * 사이드마다 표를 한 벌씩 놓는 대신 하나로 합친 까닭은, 비교에서 읽고 싶은 것이
 * "A 가 맞았나"가 아니라 "어느 키에서 둘이 갈렸나"이기 때문이다 — 같은 줄에
 * 나란히 놓여야 그게 한눈에 보인다. 기대값은 두 사이드가 같은 것을 보므로 한 번만
 * 적는다(그래서 이 표가 뜨면 위의 기대 정답 상자는 하지 않을 말을 반복하지 않게
 * 물러난다).
 *
 * 두 사이드 모두 JSON 이 아니면 null — 그때는 예전처럼 원문 diff 가 답한다.
 */
export function FieldCompareTable({
  aText, bText, expected, unwrapA, unwrapB, nameA, nameB, className, trailing,
}: {
  aText: string | null | undefined;
  bText: string | null | undefined;
  expected: string | null | undefined;
  unwrapA?: boolean;
  unwrapB?: boolean;
  nameA: string;
  nameB: string;
  className?: string;
  /** 머리줄 오른쪽 끝에 얹을 것 — 보기 전환 토글이 여기 선다. */
  trailing?: ReactNode;
}) {
  const rows = useMemo<PairRow[] | null>(() => {
    const ma = structuredMatch(aText ?? '', expected ?? '', { unwrapBody: unwrapA });
    const mb = structuredMatch(bText ?? '', expected ?? '', { unwrapBody: unwrapB });
    if (!ma && !mb) return null;
    // A 가 본 순서를 그대로 따르고, A 에 없던 키만 뒤에 붙인다 — 기대 정답에 적힌
    // 차례가 곧 A 의 차례라, 두 사이드를 합쳐도 읽는 순서가 바뀌지 않는다.
    const byPath = new Map<string, PairRow>();
    const put = (f: FieldResult, side: 'a' | 'b') => {
      const cur = byPath.get(f.path) ?? { path: f.path, expected: f.expected };
      if (cur.expected === null && f.expected !== null) cur.expected = f.expected;
      cur[side] = f;
      byPath.set(f.path, cur);
    };
    ma?.fields.forEach((f) => put(f, 'a'));
    mb?.fields.forEach((f) => put(f, 'b'));
    return [...byPath.values()];
  }, [aText, bText, expected, unwrapA, unwrapB]);

  if (!rows) return null;
  const split = rows.filter((r) => (r.a?.status ?? 'match') !== (r.b?.status ?? 'match')).length;

  return (
    <div className={cn('overflow-hidden rounded-md border border-line bg-surface', className)}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-surface-2 px-3 py-2">
        <span className="eyebrow">키별 판정</span>
        <span className="text-[11px] text-muted">
          키 <span className="font-mono font-semibold text-ink">{rows.length}</span>
        </span>
        {/* 갈린 키가 이 표의 요점이다 — 없으면 없다고 먼저 말한다. */}
        <span aria-hidden className="h-3 w-px self-center bg-line-strong" />
        <span className={cn('text-[11px] font-medium', split > 0 ? 'text-bad' : 'text-muted')}>
          {split > 0 ? `A·B 갈림 ${split}` : 'A·B 동일'}
        </span>
        {trailing && <span className="ml-auto">{trailing}</span>}
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full min-w-[620px] table-fixed border-separate border-spacing-0 text-xs">
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '26%' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[10px] uppercase tracking-[0.6px] text-muted">
            <tr>
              <th className={cn('border-b border-line px-3 py-2 font-semibold', COL)}>키</th>
              <th className={cn('border-b border-line px-3 py-2 font-semibold', COL)}>기대값</th>
              <th className={cn('truncate border-b border-line px-3 py-2 font-semibold', COL)}>A · {nameA}</th>
              <th className="truncate border-b border-line px-3 py-2 font-semibold">B · {nameB}</th>
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {rows.map((r) => {
              // 레일은 '이 줄에 볼 것이 있나'만 말한다 — 한쪽이라도 어긋났으면 선다.
              const bad = [r.a, r.b].some((f) => f && f.status !== 'match');
              const warnOnly = [r.a, r.b].every((f) => !f || f.status === 'match' || f.status === 'extra');
              return (
                <tr key={r.path} className="transition-colors hover:bg-surface-2/70">
                  <td
                    className={cn(
                      CELL, COL, 'border-l-[3px] font-mono text-ink',
                      !bad ? 'border-l-transparent' : warnOnly ? 'border-l-warn-vivid' : 'border-l-bad-vivid',
                    )}
                  >
                    {r.path || <span className="text-muted">(전체)</span>}
                  </td>
                  <td className={cn(CELL, COL, 'break-words font-mono', bad ? 'text-ok' : 'text-muted')}>
                    {r.expected === null ? <Absent>기대에 없음</Absent> : r.expected}
                  </td>
                  <PairCell f={r.a} />
                  <PairCell f={r.b} last />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MatchDiff;
