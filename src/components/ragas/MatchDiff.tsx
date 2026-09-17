'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  comparablePair,
  structuredMatch,
  type FieldResult,
  type FieldStatus,
  type StructuredMatch,
} from '@/lib/exactMatch';
import { buildFieldTree, flattenTree, worstStatus, type Pathed, type TreeRow } from '@/lib/fieldTree';
import { byImportance, FAIL_WEIGHT, TIER_ORDER, tierOf, type Tier } from '@/lib/fieldOrder';
import { diffWords, type DiffPair, type DiffSeg } from '@/lib/textDiff';
import { cn } from '@/lib/cn';
import type { RagasResultRow } from '@/lib/types';
import { AnswerBox, Chevron, CopyButton, OxBadge, TraceTag } from './shared';

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
 *
 * The key table is built for a payload with more keys than fit on a screen,
 * which is what this screen actually sees. Four things follow from that: the
 * counts in the header ARE the filter (a twenty-key payload opens on its
 * failures rather than on eighteen rows of 일치), keys nest as the tree they
 * came from and a branch folds shut, a differing value marks the words that
 * differ instead of reddening the whole cell, and a value too long for two lines
 * stays clamped until asked for. None of it touches the verdict.
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

// ---------------------------------------------------------------------------
// 판정 하나가 입는 옷
// ---------------------------------------------------------------------------

/** 색은 세 군데에 같은 톤으로 나뉘어 나온다 — 행 왼쪽 레일, 어긋난 값, 결과 칩 —
 * 그래서 한 줄을 읽는 데 세 번 판단할 필요가 없다. */
interface StatusStyle {
  label: string;
  /** 면 없이 이름만 놓는 자리의 글자색. */
  text: string;
  /** 결과 칸의 상태 칩. 일치는 테두리 없이 조용히 — 스무 줄이 전부 알약이면
   * 어긋난 줄이 도리어 묻힌다. */
  chip: string;
  /** 행 왼쪽 3px 톤 레일 (선택 행·KPI 카드와 같은 장치). */
  rail: string;
  /** 두 값 칸의 면. 낱말 단위로 칠할 수 없을 때 되돌아갈 자리다 — '값 다름'은
   * 보통 어긋난 낱말에만 색이 가고 칸 자체는 칠하지 않는다. */
  expected: string;
  actual: string;
}

const QUIET = 'text-muted';
const BAD_CHIP = 'border border-bad-line bg-bad-soft text-bad';
// 기대값 칸은 어느 상태에서도 칠하지 않는다 — 초록 면은 '맞았다'로 읽혀, 누락·타입
// 다름 줄에서 뜻이 거꾸로 선다. 틀린 것은 실제값 쪽이다.
const BAD_FILL = { expected: '', actual: 'bg-bad-soft text-bad' };

const STATUS: Record<FieldStatus, StatusStyle> = {
  match: { label: '일치', text: QUIET, chip: QUIET, rail: 'border-l-transparent', expected: '', actual: '' },
  diff: { label: '값 다름', text: 'text-bad', chip: BAD_CHIP, rail: 'border-l-bad-vivid', ...BAD_FILL },
  type: { label: '타입 다름', text: 'text-bad', chip: BAD_CHIP, rail: 'border-l-bad-vivid', ...BAD_FILL },
  // 기대값만 있는 줄이라 실제값 칸은 칠하지 않는다 — 거기엔 아무것도 없다.
  missing: { label: '누락', text: 'text-bad', chip: BAD_CHIP, rail: 'border-l-bad-vivid', expected: '', actual: '' },
  // '추가'만 warn 인 까닭은, 나머지 셋이 "기대한 것이 그대로 오지 않았다"인 반면
  // 이것은 "묻지 않은 것이 더 왔다"라서 고칠 곳이 프롬프트가 아니라 기대 정답인
  // 경우가 잦기 때문이다.
  extra: {
    label: '추가',
    text: 'text-warn',
    chip: 'border border-warn-line bg-warn-soft text-warn',
    rail: 'border-l-warn-vivid',
    expected: '',
    actual: 'bg-warn-soft text-warn',
  },
};

/** 어긋난 낱말에 얹는 색. 실제값 칸은 이미 soft 면이 깔려 있어 soft2 로는 면과
 * 구분이 안 된다 — 테두리 톤(line)까지 올리고 굵게 둔다. 기대값 쪽은 면이 없으니
 * 같은 톤이라도 충분히 선다. */
const MARK: Record<'ok' | 'bad' | 'warn', string> = {
  ok: 'bg-ok-line font-semibold text-ok',
  bad: 'bg-bad-line font-semibold text-bad',
  warn: 'bg-warn-line font-semibold text-warn',
};

/** 접힌 가지가 무엇을 감추고 있는지 고를 때의 순서 — 누락이 가장 무겁고 '추가'가
 * 가장 가볍다. */
const RANK: Record<FieldStatus, number> = { match: 0, extra: 1, diff: 2, type: 3, missing: 4 };
const rankOf = (s: FieldStatus) => RANK[s];

const FAIL_KINDS: FieldStatus[] = ['diff', 'type', 'missing', 'extra'];

const CELL = 'border-b border-line px-3 py-1.5 align-top';
/** 열 사이 세로 헤어라인. 값이 두 칸에 걸쳐 읽히는 표라 가로줄만으로는 어느
 * 칸까지가 기대값인지 눈이 자꾸 놓친다. */
const COL = 'border-r border-line';

/** 이 길이를 넘는 값은 두 줄로 접어 둔다. 한 줄이 화면을 다 먹으면 위아래를
 * 나란히 읽으라고 만든 표가 아니게 된다. */
const LONG = 160;
/** 이보다 긴 짝은 낱말 맞추기를 포기하고 칸을 통째로 칠한다. */
const MARKABLE = 600;

/** 값이 아예 없는 쪽 — 빈 칸으로 두면 '빈 문자열이 왔다'로도 읽힌다. */
function Absent({ children }: { children: string }) {
  return <span className="font-sans text-xs text-muted">{children}</span>;
}

/** 값·키를 집어가는 자리. 줄에 손을 올리기 전에는 보이지 않는다 — 표의 모든 칸이
 * 아이콘을 하나씩 달고 있으면 정작 값이 눈에 안 들어온다. */
function IconCopy({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="복사"
      aria-label="복사"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(
          () => { setDone(true); setTimeout(() => setDone(false), 1000); },
          () => {},
        );
      }}
      className={cn(
        'rounded-xs border border-line bg-surface p-0.5 text-muted transition hover:bg-surface-2 hover:text-ink',
        done && 'text-ok',
        className,
      )}
    >
      {done ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="5.8" y="5.8" width="7.4" height="7.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.4 3.4H3.9a1.1 1.1 0 00-1.1 1.1v6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}


// ---------------------------------------------------------------------------
// 보기 조작 — 정렬 하나, 끄고 켜는 버튼 둘
// ---------------------------------------------------------------------------

/** 오류 먼저(기본) — 무엇 때문에 X 인지부터. 원래 순서 — 기대 정답에 적힌 차례와
 * 구조 그대로, 트리로. 앞의 것이 읽는 순서고 뒤의 것이 쓰인 순서다. */
type SortMode = 'importance' | 'written';

/** 끄고 켜는 버튼. 체크 모양인 까닭은 둘이 서로를 끄지 않기 때문이다 — 하나만
 * 고르는 장치(세그먼트)는 이미 바로 옆 정렬이 쓰고 있다. 버튼에 붙은 수는 이
 * 버튼이 다루는 줄이 몇 개인지를 누르기 전에 말하고, 0 이면 누를 것이 없다. */
function ToggleButton({
  on, onClick, label, count,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  const disabled = count === 0 && !on;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-medium transition disabled:cursor-default disabled:opacity-40',
        on
          ? 'border-accent-line bg-accent-soft text-accent'
          : 'border-line-strong bg-surface text-body enabled:hover:bg-surface-2 enabled:hover:text-ink',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-3 w-3 items-center justify-center rounded-[3px] border',
          on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong bg-surface',
        )}
      >
        {on && (
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
      <span className="font-mono tabular-nums">{count}</span>
    </button>
  );
}

function SortToggle({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  const opts: [SortMode, string][] = [['importance', '오류 먼저'], ['written', '원래 순서']];
  return (
    <span className="inline-flex shrink-0 items-stretch gap-0.5 rounded-md border border-line bg-surface-3 p-0.5">
      {opts.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            'rounded-sm px-2 py-0.5 text-xs font-semibold transition',
            value === v ? 'bg-surface text-accent shadow-seg' : 'text-muted hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

/** 표 바로 위 조작 줄. 왼쪽은 무엇을 남길지(버튼 둘), 오른쪽은 어떻게 늘어놓을지
 * (검색·정렬). 걸러낸 줄 수도 여기서 말한다 — 표가 짧아진 이유가 버튼인지 실제로
 * 키가 그것뿐인지 헷갈리면 안 된다. */
function TableToolbar({
  badOnly, onBadOnly, badCount, hideBlank, onHideBlank, blankCount, hidden,
  sort, onSort, q, onQ, groups, allCollapsed, onToggleAll, lead, trailing, compact,
}: {
  badOnly: boolean;
  onBadOnly: (v: boolean) => void;
  badCount: number;
  hideBlank: boolean;
  onHideBlank: (v: boolean) => void;
  blankCount: number;
  hidden: number;
  sort: SortMode;
  onSort: (v: SortMode) => void;
  q: string;
  onQ: (v: string) => void;
  groups: number;
  allCollapsed: boolean;
  onToggleAll: () => void;
  /** 표 위 막대는 하나뿐이다 — 패널 제목과 판정 요약이 여기 함께 선다. */
  lead?: ReactNode;
  trailing?: ReactNode;
  /** 줄 몇 개짜리 표 — 거르고 정렬할 것이 없으니 조작은 접고 제목만 남는다. */
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
      {lead}
      {!compact && (
        <>
          <ToggleButton on={badOnly} onClick={() => onBadOnly(!badOnly)} label="오류만 보기" count={badCount} />
          <ToggleButton on={hideBlank} onClick={() => onHideBlank(!hideBlank)} label="빈 값 숨기기" count={blankCount} />
          {hidden > 0 && (
            <span className="text-xs text-muted">
              <span className="font-mono tabular-nums">{hidden}</span>개 숨김
            </span>
          )}
        </>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {!compact && (
          <>
        {groups > 1 && (
          <button
            type="button"
            onClick={onToggleAll}
            className="h-7 rounded-sm border border-line px-2.5 text-xs text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            {allCollapsed ? '모두 펼치기' : '모두 접기'}
          </button>
        )}
        <span className="relative">
          <input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="키 검색"
            spellCheck={false}
            className="h-7 w-40 rounded-sm border border-line bg-surface-2 pl-2 pr-5 font-mono text-xs text-ink outline-none transition placeholder:font-sans placeholder:text-muted-soft focus:border-accent-line focus:bg-surface focus:shadow-ring"
          />
          {q && (
            <button
              type="button"
              onClick={() => onQ('')}
              aria-label="검색 지우기"
              className="absolute right-1 top-1/2 -translate-y-1/2 px-0.5 text-[11px] leading-none text-muted hover:text-ink"
            >
              ×
            </button>
          )}
        </span>
        <SortToggle value={sort} onChange={onSort} />
          </>
        )}
        {trailing}
      </span>
    </div>
  );
}

/** 걸러낸 뒤 아무 줄도 남지 않았을 때. 빈 표는 '비교할 것이 없다'로도 읽힌다. */
function NoRows({ children }: { children: string }) {
  return <div className="px-3 py-6 text-center text-xs text-muted">{children}</div>;
}

/** 이만큼은 돼야 조작 줄과 층 머리가 제 몫을 한다. 키 서너 개짜리 표에 버튼 둘과
 * 머리 셋을 얹으면 조작이 내용보다 커진다 — 그런 표는 정렬만 해서 그대로 보인다. */
const ROOMY = 6;

// ---------------------------------------------------------------------------
// 표의 모양 — 부모 객체별 묶음, 값은 한 칸
// ---------------------------------------------------------------------------

/**
 * 키 경로를 줄마다 통째로 적으면(`result.items[0].name`) 같은 앞마디가 스무 번
 * 되풀이되고, 정작 달라지는 끝마디가 묻힌다. 그래서 줄은 부모 객체 아래에 묶이고
 * 키 칸에는 끝마디만 선다 — 부모 경로는 묶음 머리줄에 한 번.
 *
 * 기대값과 실제값은 나란한 두 칸이다 — 한 칸에 `기대 → 실제` 로 붙였더니 서로
 * 견주는 표로 읽히지 않았다. 대신 맞은 실제값 칸은 값을 되풀이하지 않고 `=` 하나만
 * 두고, 틀린 칸에만 면을 깐다. 세로로 훑으면 색 있는 칸이 곧 틀린 자리고, 판정은
 * 오른쪽 끝 좁은 칸에 모인다.
 */

/** `items[0].name` → 부모 `items[0]` · 끝마디 `name`. */
function splitPath(segs: string[]): { parent: string; leaf: string } {
  const parent = segs
    .slice(0, -1)
    .reduce((p, s) => (!p ? s : s.startsWith('[') ? p + s : `${p}.${s}`), '');
  return { parent, leaf: segs[segs.length - 1] ?? '' };
}

interface KeyGroup<T> {
  parent: string;
  items: T[];
}

/** 부모 객체별 묶음. 원래 순서면 묶음도 줄도 나온 차례대로. 오류 먼저면 묶음 안의
 * 줄을 중요도로 세우고, 묶음은 맨 앞 줄이 가장 무거운 것부터 선다. */
function groupByParent<T extends Pathed>(
  items: T[],
  importance: boolean,
  tierFn: (t: T) => Tier,
  weightFn: (t: T) => number,
): KeyGroup<T>[] {
  const byParent = new Map<string, T[]>();
  for (const it of items) {
    const { parent } = splitPath(it.segs);
    const cur = byParent.get(parent);
    if (cur) cur.push(it);
    else byParent.set(parent, [it]);
  }
  const groups = [...byParent].map(([parent, rows]) => ({
    parent,
    items: importance ? byImportance(rows, tierFn, weightFn) : rows,
  }));
  if (!importance) return groups;
  return groups
    .map((g, i) => ({ g, i, t: TIER_ORDER.indexOf(tierFn(g.items[0])), w: weightFn(g.items[0]) }))
    .sort((a, b) => a.t - b.t || b.w - a.w || a.i - b.i)
    .map((x) => x.g);
}

/** 한글·한자는 라틴 글자의 두 배 가까이 넓다. */
function visualLen(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) >= 0x1100 ? 1.8 : 1;
  return n;
}

/** 키 칸 폭(rem). 끝마디만 서므로 가장 긴 끝마디에 맞추고, 상한을 넘으면 감긴다.
 * 모노 글자 폭 + 칸 여백 + 레일·복사 아이콘 + 묶음 들여쓰기, 그리고 어긋난 줄이
 * 있으면 그 옆에 서는 상태 칩('값 다름'·'타입 다름')의 자리까지. 칩 자리를 빼고
 * 재면 좁아진 칸에서 키 이름이 한 글자씩 세로로 쪼개진다. */
function keyColRem(labels: string[], chipRem = 0): number {
  const ch = Math.min(28, Math.max(6, ...labels.map(visualLen)));
  return ch * 0.5 + 1.6 + 1.5 + 0.75 + chipRem;
}

/** 묶음 머리줄 — 부모 경로 한 번, 키 수, 그 아래 오류. 눌러서 접는다. */
function ParentRow({
  parent, count, cols, collapsed, onToggle, children,
}: {
  parent: string;
  count: number;
  cols: number;
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <tr className="cursor-pointer" onClick={onToggle}>
      <td colSpan={cols} className="border-b border-line bg-surface-2 px-3 py-1 transition-colors hover:bg-surface-3">
        <span className="flex flex-wrap items-center gap-x-2.5 text-xs">
          <Chevron open={!collapsed} />
          <span className="break-all font-mono font-semibold text-ink">{parent || '(최상위)'}</span>
          <span className="text-muted">
            <span className="font-mono tabular-nums">{count}</span>개
          </span>
          {children}
        </span>
      </td>
    </tr>
  );
}

type Tone = 'plain' | 'bad' | 'warn';
const TONE_TEXT: Record<Tone, string> = { plain: 'text-ink', bad: 'text-bad', warn: 'text-warn' };

/** 값 한 토막. 틀린 쪽은 글자색으로, 어긋난 낱말은 그 위에 한 번 더 칠한다. */
function Val({
  text, segs, tone, absent, dim, typeTag, clamp,
}: {
  text: string | null;
  segs: DiffSeg[] | null;
  tone: Tone;
  absent: string;
  dim?: boolean;
  /** 타입 다름 줄 — 값 앞에 JSON 타입 이름을 단다. */
  typeTag?: boolean;
  clamp?: boolean;
}) {
  if (text === null) return <Absent>{absent}</Absent>;
  // 빈 문자열은 글자 없이 그리면 칸이 깨진 것처럼 보인다.
  if (text.trim() === '') return <span className="text-muted">&quot;&quot;</span>;
  return (
    <span className={cn('min-w-0 break-words', dim ? 'text-muted' : TONE_TEXT[tone], clamp && 'line-clamp-3')}>
      {typeTag && <span className="mr-1 font-mono text-[11px] font-semibold text-muted">{jsonTypeOf(text)}</span>}
      {segs
        ? segs.map((s, i) =>
            s.same ? (
              <span key={i}>{s.text}</span>
            ) : (
              <mark key={i} className={cn('rounded-[2px] px-px', MARK[tone === 'plain' ? 'ok' : tone])}>
                {s.text}
              </mark>
            ),
          )
        : text}
    </span>
  );
}

/** 기대값과 같은 칸 — 값을 되풀이하지 않고 `=` 하나. 같은 글자를 두 칸에 두 번
 * 쓰면 틀린 칸이 도리어 묻힌다. */
function SameMark() {
  return (
    <span className="select-none font-mono text-muted-soft" title="기대값과 같음">
      =
    </span>
  );
}

/** 틀린 실제값 칸의 면. 누락도 빈 칸이 아니라 틀린 칸이라 같은 면을 깐다. */
const missFill = (s: FieldStatus) => (s === 'missing' ? 'bg-bad-soft' : STATUS[s].actual);

/** 맞은 줄의 값 하나. 펼치면 객체·배열은 들여쓴 모양으로. */
function SameValue({
  text, dim, clamp, expanded,
}: { text: string | null; dim?: boolean; clamp: boolean; expanded: boolean }) {
  if (text === null) return <Absent>—</Absent>;
  const pretty = expanded ? prettyValue(text) : null;
  if (pretty) {
    return <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">{pretty}</pre>;
  }
  return <Val text={text} segs={null} tone="plain" absent="" dim={dim} clamp={clamp} />;
}

/** 값 칸 — 긴 값 접기/펴기와 복사를 줄마다 한 번만. */
function ValueTd({
  long, expanded, onToggle, copy, className, children,
}: {
  long: boolean;
  expanded: boolean;
  onToggle: () => void;
  copy: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td className={cn(CELL, COL, 'group/v relative tabular-nums', className)}>
      {children}
      {long && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="mt-1 block font-sans text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
        >
          {expanded ? '접기' : '더 보기'}
        </button>
      )}
      {copy && <IconCopy text={copy} className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/v:opacity-100" />}
    </td>
  );
}

const isLong = (...texts: (string | null | undefined)[]) => texts.some((t) => (t?.length ?? 0) > LONG);

const TH = 'border-b border-line px-3 py-1.5 font-semibold';

// ---------------------------------------------------------------------------
// 표의 부품 — 단일 표와 A/B 표가 같은 것을 쓴다
// ---------------------------------------------------------------------------

/** 키 칸이 받는 모양. 평면 보기는 앞마디(prefix)를 흐리게 붙이고, 트리 보기는
 * 깊이만큼 들여쓴다. */
interface KeyView {
  label: string;
  prefix?: string;
  depth?: number;
  gutter?: boolean;
}

function KeyCell({
  path, label, prefix, depth = 0, gutter, rail, dim, lead, children,
}: KeyView & {
  path: string;
  rail: string;
  /** 값 없는 줄은 키 이름까지 한 발 물러난다. */
  dim?: boolean;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <td className={cn(CELL, COL, 'border-l-[3px] font-mono', dim ? 'text-body' : 'text-ink', rail !== 'border-l-transparent' && 'font-semibold', rail)}>
      <span className="flex items-baseline gap-1" style={depth ? { paddingLeft: depth * 12 } : undefined}>
        {gutter && <span className="w-3.5 shrink-0 self-center">{lead}</span>}
        <span className="min-w-0 break-words" title={path || undefined}>
          {prefix && <span className="font-normal text-muted">{prefix}</span>}
          {label || <span className="text-muted">(전체)</span>}
        </span>
        {children}
        {path && (
          <IconCopy text={path} className="ml-auto shrink-0 self-start opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </span>
    </td>
  );
}

/** JSON 타입 이름 — '타입 다름' 줄에서만 값 위에 붙는다. 표시 문자열에서 거꾸로
 * 읽어도 되는 까닭은, 그 줄만은 문자열이 따옴표를 단 채로 오기 때문이다
 * (`leafText(v, quoted)`). 이 이름이 없으면 `200` 과 `"200"` 을 두고 무엇이
 * 다른지 사람이 알아채야 한다. */
function jsonTypeOf(text: string): string {
  const s = text.trim();
  if (s.startsWith('"')) return 'string';
  if (s.startsWith('{')) return 'object';
  if (s.startsWith('[')) return 'array';
  if (s === 'null') return 'null';
  if (s === 'true' || s === 'false') return 'boolean';
  return s !== '' && !Number.isNaN(Number(s)) ? 'number' : 'string';
}

/** 펼친 객체·배열은 한 줄 JSON 대신 들여쓴 모양으로. 접힌 두 줄에서는 짧은 쪽이
 * 낫고, 다 펼쳐 읽을 때는 구조가 보이는 쪽이 낫다. */
function prettyValue(text: string): string | null {
  const s = text.trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return null;
  }
}

function ValueCell({
  text, absentLabel, segs, tone, fill, dim, typeTag, same, span, expanded, onToggle, last,
}: {
  text: string | null;
  absentLabel: string;
  /** 낱말 단위 표시. null 이면 칸을 통째로 칠한다. */
  segs: DiffSeg[] | null;
  tone: 'ok' | 'bad' | 'warn';
  fill: string;
  dim?: boolean;
  /** 값 위에 JSON 타입 이름을 단다 — 타입 다름 줄. */
  typeTag?: boolean;
  /** 기대값·실제값이 같아 한 칸으로 합친 자리. 앞에 `=` 하나로 그 사실을 적는다 —
   * 빈 칸이 옆에 없으니 '기대값이 비었다'로 읽힐 걱정은 없지만, 두 열 머리 아래
   * 값이 하나뿐인 이유는 보여야 한다. */
  same?: boolean;
  span?: number;
  expanded: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  const edge = cn(CELL, !last && COL);
  const eq = same && (
    <span className="mr-1.5 select-none text-muted" title="기대값과 실제값이 같음">=</span>
  );
  if (text === null) {
    return (
      <td colSpan={span} className={edge}>
        <Absent>{absentLabel}</Absent>
      </td>
    );
  }
  // 빈 문자열은 글자 없이 그리면 칸이 깨진 것처럼 보인다 — 빈 값이라고 적는다.
  if (text.trim() === '') {
    return (
      <td colSpan={span} className={cn(edge, fill)}>
        {eq}
        <span className="text-muted">&quot;&quot;</span>
      </td>
    );
  }
  const long = text.length > LONG;
  const pretty = expanded && !segs ? prettyValue(text) : null;
  return (
    <td colSpan={span} className={cn(edge, 'group/v relative break-words tabular-nums', fill, dim && 'text-muted')}>
      {typeTag && (
        <span className="mb-0.5 block font-mono text-[11px] font-semibold">
          {jsonTypeOf(text)}
        </span>
      )}
      {pretty ? (
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed">{pretty}</pre>
      ) : (
      <div className={cn(!expanded && long && 'line-clamp-3')}>
        {eq}
        {segs
          ? segs.map((s, i) =>
              s.same ? (
                <span key={i}>{s.text}</span>
              ) : (
                <mark key={i} className={cn('rounded-[2px] px-px', MARK[tone])}>
                  {s.text}
                </mark>
              ),
            )
          : text}
      </div>
      )}
      {long && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="mt-1 font-sans text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
        >
          {expanded ? '접기' : `더 보기 · ${text.length}자`}
        </button>
      )}
      <IconCopy text={text} className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/v:opacity-100" />
    </td>
  );
}

function countBad<T extends Pathed>(row: TreeRow<T>, statusOf: (item: T) => FieldStatus): number {
  let n = 0;
  const visit = (r: TreeRow<T>) => {
    if (r.item && statusOf(r.item) !== 'match') n++;
    r.children.forEach(visit);
  };
  visit(row);
  return n;
}

/** 트리 보기에서 접었다 펴는 가지 줄. 접혀 있어도 아래에 무엇이 있는지는 말한다 —
 * 조용한 가지는 그 아래 실패가 없는 것으로 읽힌다. */
function GroupRow<T extends Pathed>({
  row, span, collapsed, onToggle, statusOf,
}: {
  row: TreeRow<T>;
  /** 키 칸을 뺀 나머지 열 수 — 요약이 그 폭 전체에 걸친다. */
  span: number;
  collapsed: boolean;
  onToggle: () => void;
  statusOf: (item: T) => FieldStatus;
}) {
  const worst = worstStatus(row, statusOf, rankOf);
  const bad = countBad(row, statusOf);
  const s = STATUS[worst];
  return (
    <tr className="group cursor-pointer bg-surface-2 transition-colors hover:bg-surface-3" onClick={onToggle}>
      <KeyCell
        path={row.path}
        label={row.label}
        depth={row.depth}
        gutter
        rail={worst === 'match' ? 'border-l-transparent' : s.rail}
        lead={<Chevron open={!collapsed} />}
      />
      <td className={CELL} colSpan={span}>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>
            하위 <span className="font-mono tabular-nums">{row.leaves}</span>개
          </span>
          {bad > 0 && (
            <span className={cn('font-medium', s.text)}>
              오류 <span className="font-mono tabular-nums">{bad}</span>
            </span>
          )}
          {/* 접힌 가지는 그 아래 가장 무거운 실패의 이름을 단다. */}
          {collapsed && bad > 0 && (
            <span className={cn('rounded-full px-1.5 py-px text-[11px] font-semibold', s.chip)}>{s.label}</span>
          )}
        </span>
      </td>
    </tr>
  );
}

/** 가지 줄의 경로 모음 — '모두 접기'가 무엇을 접을지. */
function groupPaths<T extends Pathed>(rows: TreeRow<T>[]): string[] {
  const out: string[] = [];
  const visit = (r: TreeRow<T>) => {
    if (r.children.length > 0) out.push(r.path);
    r.children.forEach(visit);
  };
  rows.forEach(visit);
  return out;
}

/** 두 값이 어디서 갈렸는지 낱말 단위로. 너무 길면 포기하고 null — 그때는 칸을
 * 통째로 칠한다. */
function markPair(a: string | null, b: string | null, on: boolean): DiffPair | null {
  if (!on || a === null || b === null) return null;
  if (a.length + b.length > MARKABLE) return null;
  const d = diffWords(a, b);
  return d.identical ? null : d;
}

function useToggleSet() {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setSet((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  return [set, toggle, setSet] as const;
}

/** 두 표가 공유하는 보기 상태와 그 결과. 무엇을 남기고(버튼 둘·검색) 어떻게
 * 늘어놓을지(정렬)가 한 곳에서 정해져, 단일 표와 A/B 표가 같은 규칙으로 선다.
 * `tierFn`·`weightFn` 은 모듈 수준 상수여야 한다 — 렌더마다 새로 만들면 메모가
 * 매번 풀린다. */
function useKeyTable<T extends Pathed>(
  items: T[],
  tierFn: (t: T) => Tier,
  weightFn: (t: T) => number,
) {
  const [sort, setSort] = useState<SortMode>('importance');
  const [badOnly, setBadOnly] = useState(false);
  const [hideBlank, setHideBlank] = useState(false);
  const [q, setQ] = useState('');
  const [collapsed, toggleGroup, setCollapsed] = useToggleSet();
  const [open, toggleValue] = useToggleSet();

  const badCount = useMemo(() => items.filter((t) => tierFn(t) === 'bad').length, [items, tierFn]);
  const blankCount = useMemo(() => items.filter((t) => tierFn(t) === 'blank').length, [items, tierFn]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((t) => {
      const tier = tierFn(t);
      if (badOnly && tier !== 'bad') return false;
      if (hideBlank && tier === 'blank') return false;
      return !needle || t.path.toLowerCase().includes(needle);
    });
  }, [items, tierFn, badOnly, hideBlank, q]);
  const grouped = useMemo(
    () => groupByParent(shown, sort === 'importance', tierFn, weightFn),
    [shown, sort, tierFn, weightFn],
  );
  // 최상위 키만 있는 표는 묶을 것이 없다 — 머리줄 없이 줄만 선다.
  const headed = grouped.length > 1 || (grouped[0]?.parent ?? '') !== '';
  const groupKeys = headed ? grouped.map((g) => g.parent) : [];

  const toolbar = (lead?: ReactNode, trailing?: ReactNode, compact?: boolean) => (
    <TableToolbar
      badOnly={badOnly}
      onBadOnly={setBadOnly}
      badCount={badCount}
      hideBlank={hideBlank}
      onHideBlank={setHideBlank}
      blankCount={blankCount}
      hidden={items.length - shown.length}
      sort={sort}
      onSort={setSort}
      q={q}
      onQ={setQ}
      groups={groupKeys.length}
      allCollapsed={groupKeys.length > 0 && groupKeys.every((p) => collapsed.has(p))}
      onToggleAll={() => setCollapsed((cur) => (groupKeys.every((p) => cur.has(p)) ? new Set() : new Set(groupKeys)))}
      lead={lead}
      trailing={trailing}
      compact={compact}
    />
  );

  /** 묶음 머리줄과 그 아래 줄들. 접힌 묶음도 머리줄에서 오류는 말한다. */
  const body = (
    row: (it: T, label: string, depth: number) => ReactNode,
    summary: (items: T[]) => ReactNode,
    cols: number,
  ): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const g of grouped) {
      const shut = headed && collapsed.has(g.parent);
      if (headed) {
        out.push(
          <ParentRow
            key={'§' + g.parent}
            parent={g.parent}
            count={g.items.length}
            cols={cols}
            collapsed={shut}
            onToggle={() => toggleGroup(g.parent)}
          >
            {summary(g.items)}
          </ParentRow>,
        );
      }
      if (!shut) for (const it of g.items) out.push(row(it, splitPath(it.segs).leaf, headed ? 1 : 0));
    }
    return out;
  };

  return { q, open, toggleValue, shown, toolbar, body };
}

// ---------------------------------------------------------------------------
// 단일 실행 — 키별 판정표
// ---------------------------------------------------------------------------

const fieldTier = (f: FieldResult): Tier => tierOf(f.status === 'match', f.expected, f.actual);
const fieldWeight = (f: FieldResult) => FAIL_WEIGHT[f.status];
function FieldRow({
  f, label, depth, expanded, onExpand,
}: {
  f: FieldResult;
  label: string;
  depth: number;
  expanded: boolean;
  onExpand: () => void;
}) {
  const s = STATUS[f.status];
  const dim = fieldTier(f) === 'blank';
  // 같은 값 두 개를 통째로 붉히는 대신 어긋난 낱말만 — 긴 문장에서 어디가
  // 갈렸는지 사람이 눈으로 찾던 일을 표가 한다.
  const marks = useMemo(() => markPair(f.expected, f.actual, f.status === 'diff'), [f]);
  const ok = f.status === 'match';
  const type = f.status === 'type';
  const clampOf = (t: string | null) => isLong(t) && !expanded;
  return (
    <tr className="group transition-colors hover:bg-surface-2/70">
      <KeyCell path={f.path} label={label} depth={depth} rail={s.rail} dim={dim}>
        {f.status !== 'match' && <StatusChip status={f.status} />}
      </KeyCell>
      <ValueTd long={isLong(f.expected)} expanded={expanded} onToggle={onExpand} copy={f.expected}>
        {ok ? (
          <SameValue text={f.expected ?? f.actual} dim={dim} clamp={clampOf(f.expected)} expanded={expanded} />
        ) : (
          <Val
            text={f.expected}
            segs={marks ? marks.left : null}
            tone="plain"
            absent="기대에 없음"
            typeTag={type}
            clamp={clampOf(f.expected)}
          />
        )}
      </ValueTd>
      <ValueTd
        long={!ok && isLong(f.actual)}
        expanded={expanded}
        onToggle={onExpand}
        copy={ok ? null : f.actual}
        className={ok ? undefined : missFill(f.status)}
      >
        {ok ? (
          <SameMark />
        ) : (
          <Val
            text={f.actual}
            segs={marks ? marks.right : null}
            tone={f.status === 'extra' ? 'warn' : 'bad'}
            absent="응답에 없음"
            typeTag={type}
            clamp={clampOf(f.actual)}
          />
        )}
      </ValueTd>
    </tr>
  );
}

/** 키 옆의 상태 칩 — 어긋난 줄에만. 따로 '판정' 열을 두면 스무 줄이 빈 칸으로
 * 남으면서 정작 값이 쓸 폭을 가져간다. */
function StatusChip({ status }: { status: FieldStatus }) {
  const s = STATUS[status];
  return (
    <span className={cn('shrink-0 self-center whitespace-nowrap rounded-full px-1.5 py-px font-sans text-[11px] font-semibold', s.chip)}>
      {s.label}
    </span>
  );
}

/** 오류 층 머리에 붙는 종류별 수 — 누락 2 · 값 다름 6. */
function KindCounts({ rows }: { rows: FieldResult[] }) {
  return (
    <>
      {FAIL_KINDS.map((k) => [k, rows.filter((f) => f.status === k).length] as const)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => (
          <span key={k} className={cn('font-medium', STATUS[k].text)}>
            {STATUS[k].label} <span className="font-mono tabular-nums">{n}</span>
          </span>
        ))}
    </>
  );
}

/** 키 단위 판정표 — 키 · 값 · 판정 세 칸, 부모 객체별로 묶어서.
 *
 * 기본은 '오류 먼저': 묶음 안에서 틀린 키가 위(무거운 종류부터), 그 아래 값이
 * 있는 키, 맨 아래 빈 키. 묶음도 틀린 키를 가진 것이 앞선다. '원래 순서'는 기대
 * 정답에 적힌 차례 그대로.
 *
 * 키 칸 폭은 표 단위로 한 번(가장 긴 끝마디), 판정 칸은 고정, 값 칸이 나머지를
 * 다 쓴다 — 위아래 줄의 칸이 어긋나지 않는다. */
function FieldTable({ m, lead, trailing }: { m: StructuredMatch; lead?: ReactNode; trailing?: ReactNode }) {
  const t = useKeyTable(m.fields, fieldTier, fieldWeight);
  const roomy = m.total >= ROOMY;
  const keyRem = useMemo(
    () =>
      keyColRem(
        m.fields.map((f) => splitPath(f.segs).leaf),
        m.fields.some((f) => f.status !== 'match') ? 5 : 0,
      ),
    [m.fields],
  );

  const body = t.body(
    (f, label, depth) => (
      <FieldRow
        key={f.path}
        f={f}
        label={label}
        depth={depth}
        expanded={t.open.has(f.path)}
        onExpand={() => t.toggleValue(f.path)}
      />
    ),
    (rows) => <KindCounts rows={rows} />,
    3,
  );

  return (
    <div>
      {/* 표 위 막대는 하나다 — 패널 머리줄과 조작 줄을 겹겹이 쌓으면 정작 표가 설
          자리가 없다. 줄 몇 개짜리 표에서는 조작이 접히고 제목만 남는다. */}
      {t.toolbar(lead, trailing, !roomy)}
      {t.shown.length === 0 ? (
        <NoRows>{t.q.trim() ? '검색과 맞는 키가 없습니다' : '해당하는 키가 없습니다'}</NoRows>
      ) : (
        // 안쪽 세로 스크롤은 두지 않는다 — 페이지 스크롤 안에 스크롤이 또 생기면
        // 표를 읽다 말고 어느 쪽을 굴릴지부터 골라야 한다.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] table-fixed border-separate border-spacing-0 text-[13px] leading-normal">
            <colgroup>
              <col style={{ width: `${keyRem}rem` }} />
              <col />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface-3 text-left text-xs text-body">
              <tr>
                <th className={cn(TH, COL)}>키</th>
                <th className={cn(TH, COL)}>기대값</th>
                <th className={TH}>실제값</th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">{body}</tbody>
          </table>
        </div>
      )}
    </div>
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
            'rounded-sm px-2 py-0.5 text-xs font-semibold transition',
            raw === v ? 'bg-surface text-accent shadow-seg' : 'text-muted hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

export function MatchDiff({ row, flush }: { row: RagasResultRow; flush?: boolean }) {
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

  // 제목 · 판정 · 키 수는 한 덩어리로 다닌다: 키별 보기에서는 표 막대 안으로
  // 들어가고, 원본 보기에서는 제 머리줄이 된다.
  const head = (
    <>
      <span className="eyebrow">채점 대상 · 기대 정답</span>
      {/* 키별 표에는 변수 이름을 적을 자리가 없다 — 무엇을 채점했는지는 어느
          보기에서든 이 줄이 말한다. */}
      {row.trace_value && <TraceTag name={row.trace_var_nm} />}
      {(row.exact_match != null || fields) && (
        <span aria-hidden className="h-3 w-px self-center bg-line-strong" />
      )}
      {row.exact_match != null && <OxBadge value={row.exact_match} />}
      {fields && (
        <span className="font-mono text-xs tabular-nums text-muted">
          {/* '키 3/12' 는 '키 3개'로 읽힌다 — 맞은 수라고 적는다. */}
          <span className="font-sans">일치 </span>
          <span className="font-semibold text-ink">{fields.matched}</span>
          <span className="text-muted">/{fields.total}</span>
        </span>
      )}
    </>
  );

  return (
    <div className={cn('overflow-hidden bg-surface', !flush && 'rounded-md border border-line')}>
      {fields && !raw ? (
        <FieldTable m={fields} lead={head} trailing={<ViewToggle raw={raw} onRaw={setRaw} />} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
            {head}
            {fields && (
              <span className="ml-auto">
                <ViewToggle raw={raw} onRaw={setRaw} />
              </span>
            )}
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
        </>
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
 * 그리지 않는다 — 빈 줄이 곧 '어긋난 키 없음'이다. 무거운 종류가 앞에 선다. */
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
  const bad = byImportance(m.fields.filter((f) => f.status !== 'match'), fieldTier, fieldWeight);
  const rest = bad.slice(8);
  return (
    <span className={cn('flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px]', className)}>
      {bad.slice(0, 8).map((f) => (
        <span
          key={f.path + '·' + f.status}
          title={(f.path || '(전체)') + ' — ' + STATUS[f.status].label}
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
      {rest.length > 0 && (
        <span className="text-muted" title={rest.map((f) => f.path || '(전체)').join('\n')}>
          외 {rest.length}
        </span>
      )}
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

// ---------------------------------------------------------------------------
// A/B — 한 표에 두 사이드
// ---------------------------------------------------------------------------

/** 한 키에 대한 A·B 두 판정. 어느 쪽도 그 키를 다루지 않았으면 그 칸은 비운다. */
interface PairRow extends Pathed {
  expected: string | null;
  a?: FieldResult;
  b?: FieldResult;
}

/** 이 키에서 둘이 어떻게 갈렸나. 비교 화면이 답해야 하는 유일한 질문이라 정렬도
 * 행 표시도 이 값 하나에서 나온다. */
type AbVerdict = 'same-ok' | 'same-bad' | 'a' | 'b';

function abVerdict(r: PairRow): AbVerdict {
  const ao = !!r.a && r.a.status === 'match';
  const bo = !!r.b && r.b.status === 'match';
  if (ao && bo) return 'same-ok';
  if (ao) return 'a';
  if (bo) return 'b';
  return 'same-bad';
}

const AB_LABEL: Record<AbVerdict, string> = {
  'same-ok': '동일',
  'same-bad': '둘 다 불일치',
  a: 'A만 맞음',
  b: 'B만 맞음',
};

const pairTier = (r: PairRow): Tier =>
  tierOf(abVerdict(r) === 'same-ok', r.expected, r.a?.actual ?? null, r.b?.actual ?? null);

/** 오류 층 안에서는 갈린 키가 둘 다 틀린 키보다 먼저 — 비교 화면은 두 버전의
 * 차이를 보러 온 곳이고, 둘 다 틀린 키는 버전과 상관없이 틀린 것이다. */
const pairWeight = (r: PairRow): number => {
  const v = abVerdict(r);
  return v === 'a' || v === 'b' ? 2 : v === 'same-bad' ? 1 : 0;
};

const VERDICT_TONE: [AbVerdict, string][] = [['a', 'text-ok'], ['b', 'text-ok'], ['same-bad', 'text-bad']];

/** A만 맞음 1 · B만 맞음 2 · 둘 다 불일치 1 — 머리줄과 오류 층 머리가 같이 쓴다. */
function VerdictCounts({ rows }: { rows: PairRow[] }) {
  return (
    <>
      {VERDICT_TONE.map(([k, tone]) => [k, tone, rows.filter((r) => abVerdict(r) === k).length] as const)
        .filter(([, , n]) => n > 0)
        .map(([k, tone, n]) => (
          <span key={k} className={cn('font-medium', tone)}>
            {AB_LABEL[k]} <span className="font-mono tabular-nums">{n}</span>
          </span>
        ))}
    </>
  );
}

/** A/B 표의 한 줄 — 기대값 하나 옆에 A · B 실제값이 나란히. 맞은 사이드는 `=`,
 * 틀린 사이드만 면을 깔고, 누가 맞았는지는 오른쪽 끝 판정 칸에 — 세로로 훑기만
 * 해도 갈린 자리가 보인다. */
function PairFieldRow({
  r, label, depth, expanded, onExpand,
}: {
  r: PairRow;
  label: string;
  depth: number;
  expanded: boolean;
  onExpand: () => void;
}) {
  const v = abVerdict(r);
  const bad = v !== 'same-ok';
  const dim = pairTier(r) === 'blank';
  const warnOnly = [r.a, r.b].every((f) => !f || f.status === 'match' || f.status === 'extra');
  const type = [r.a, r.b].some((f) => f?.status === 'type');
  const clampOf = (t: string | null) => isLong(t) && !expanded;
  // 맞은 쪽은 값을 되풀이하지 않고 `=` 만 — 그래야 같은 줄에서 틀린 쪽의 값이 혼자
  // 선다. 값 자체는 왼쪽 기대값이다.
  const sideCell = (f: FieldResult | undefined) => {
    if (!f) return <td className={cn(CELL, COL, 'text-muted')}>—</td>;
    if (f.status === 'match') {
      return (
        <td className={cn(CELL, COL)}>
          <SameMark />
        </td>
      );
    }
    const mark = markPair(r.expected, f.actual, f.status === 'diff');
    return (
      <ValueTd
        long={isLong(f.actual)}
        expanded={expanded}
        onToggle={onExpand}
        copy={f.actual}
        className={missFill(f.status)}
      >
        <Val
          text={f.actual}
          segs={mark ? mark.right : null}
          tone={f.status === 'extra' ? 'warn' : 'bad'}
          absent="응답에 없음"
          typeTag={type}
          clamp={clampOf(f.actual)}
        />
      </ValueTd>
    );
  };
  return (
    <tr className="group transition-colors hover:bg-surface-2/70">
      <KeyCell
        path={r.path}
        label={label}
        depth={depth}
        dim={dim}
        rail={!bad ? 'border-l-transparent' : warnOnly ? 'border-l-warn-vivid' : 'border-l-bad-vivid'}
      >
        {/* 어느 쪽이 맞았는지는 키 옆 칩 하나로. 따로 '판정' 열을 두면 좁은
            상세보기에서 값이 쓸 폭을 그만큼 빼앗긴다. */}
        {bad && (
          <span
            title={AB_LABEL[v]}
            className={cn(
              'shrink-0 self-center whitespace-nowrap rounded-full px-1.5 py-px font-sans text-[11px] font-semibold',
              v === 'same-bad' ? (warnOnly ? STATUS.extra.chip : BAD_CHIP) : 'border border-ok-line bg-ok-soft text-ok',
            )}
          >
            {v === 'same-bad' ? '둘 다' : v.toUpperCase()}
          </span>
        )}
      </KeyCell>
      <ValueTd long={isLong(r.expected)} expanded={expanded} onToggle={onExpand} copy={r.expected}>
        {v === 'same-ok' ? (
          <SameValue text={r.expected} dim={dim} clamp={clampOf(r.expected)} expanded={expanded} />
        ) : (
          <Val text={r.expected} segs={null} tone="plain" absent="기대에 없음" typeTag={type} clamp={clampOf(r.expected)} />
        )}
      </ValueTd>
      {sideCell(r.a)}
      {sideCell(r.b)}
    </tr>
  );
}

/**
 * A/B 한 케이스의 키별 판정 — 한 표에 키 · 기대값 · A · B · 판정.
 *
 * 기대값은 두 사이드가 같은 것을 보므로 한 번만 적고, 그 옆에 A · B 의 실제값이
 * 나란히 선다. 사이드마다 표를 따로 두면 같은 키가 좌우 다른 높이에 서서 두
 * 버전을 견줄 수 없다. 정렬 · 묶음 · 버튼은 단일 표와 같고, 오류 안에서만 갈린
 * 키가 둘 다 틀린 키보다 먼저 선다.
 *
 * 두 사이드 모두 JSON 이 아니면 null — 그때는 예전처럼 원문 diff 가 답한다.
 */
export function FieldCompareTable({
  aText, bText, expected, unwrapA, unwrapB, nameA, nameB, className, trailing, flush,
}: {
  aText: string | null | undefined;
  bText: string | null | undefined;
  expected: string | null | undefined;
  unwrapA?: boolean;
  unwrapB?: boolean;
  nameA: string;
  nameB: string;
  className?: string;
  /** 케이스 본문의 한 상자 안에 설 때. */
  flush?: boolean;
  /** 머리줄 오른쪽 끝에 얹을 것 — 보기 전환 토글이 여기 선다. */
  trailing?: ReactNode;
}) {
  const all = useMemo<PairRow[]>(() => {
    const ma = structuredMatch(aText ?? '', expected ?? '', { unwrapBody: unwrapA });
    const mb = structuredMatch(bText ?? '', expected ?? '', { unwrapBody: unwrapB });
    if (!ma && !mb) return [];
    // A 가 본 순서를 그대로 따르고, A 에 없던 키만 뒤에 붙인다 — '원래 순서'가
    // 기대 정답에 적힌 차례로 읽히게.
    const byPath = new Map<string, PairRow>();
    const put = (f: FieldResult, side: 'a' | 'b') => {
      const cur = byPath.get(f.path) ?? { path: f.path, segs: f.segs, expected: f.expected };
      if (cur.expected === null && f.expected !== null) cur.expected = f.expected;
      cur[side] = f;
      byPath.set(f.path, cur);
    };
    ma?.fields.forEach((f) => put(f, 'a'));
    mb?.fields.forEach((f) => put(f, 'b'));
    return [...byPath.values()];
  }, [aText, bText, expected, unwrapA, unwrapB]);

  const t = useKeyTable(all, pairTier, pairWeight);
  const keyRem = useMemo(
    () => keyColRem(all.map((r) => splitPath(r.segs).leaf), all.some((r) => abVerdict(r) !== 'same-ok') ? 3.2 : 0),
    [all],
  );
  if (all.length === 0) return null;
  const roomy = all.length >= ROOMY;
  const quiet = all.every((r) => abVerdict(r) === 'same-ok');

  const body = t.body(
    (r, label, depth) => (
      <PairFieldRow
        key={r.path}
        r={r}
        label={label}
        depth={depth}
        expanded={t.open.has(r.path)}
        onExpand={() => t.toggleValue(r.path)}
      />
    ),
    (rows) => <VerdictCounts rows={rows} />,
    4,
  );

  // 단일 표와 같은 규칙: 제목과 조작이 한 막대에, 판정 열은 없다.
  const head = (
    <>
      <span className="eyebrow">키별 판정</span>
      <span className="text-xs text-muted">
        키 <span className="font-mono font-semibold tabular-nums text-ink">{all.length}</span>
      </span>
      <span aria-hidden className="h-3 w-px self-center bg-line-strong" />
      {/* 갈린 키가 이 표의 요점이다 — 없으면 없다고 먼저 말한다. */}
      <span className="flex flex-wrap items-baseline gap-x-2.5 text-xs">
        {quiet ? <span className="text-muted">A·B 동일</span> : <VerdictCounts rows={all} />}
      </span>
    </>
  );

  return (
    <div className={cn('overflow-hidden bg-surface', !flush && 'rounded-md border border-line', className)}>
      {t.toolbar(head, trailing, !roomy)}
      {t.shown.length === 0 ? (
        <NoRows>{t.q.trim() ? '검색과 맞는 키가 없습니다' : '해당하는 키가 없습니다'}</NoRows>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-0 text-[13px] leading-normal">
            <colgroup>
              <col style={{ width: `${keyRem}rem` }} />
              <col />
              <col />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface-3 text-left text-xs text-body">
              <tr>
                <th className={cn(TH, COL)}>키</th>
                <th className={cn(TH, COL)}>기대값</th>
                <th className={cn(TH, COL, 'truncate')}>
                  <span className="font-mono">A</span> <span className="font-normal text-muted">{nameA}</span>
                </th>
                <th className={cn(TH, 'truncate')}>
                  <span className="font-mono">B</span> <span className="font-normal text-muted">{nameB}</span>
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">{body}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 정답 없는 실행 — 키 · 값 표
// ---------------------------------------------------------------------------

/**
 * 결과 하나를 키 · 값 줄로. 비교할 정답이 없어도 Action 결과는 JSON 이라, 판정표와
 * 같은 걸음(`structuredMatch`)으로 잎을 뽑는다 — 자기 자신과 견주면 모든 줄이
 * 일치로 나오고, 필요한 것은 그 경로와 값뿐이다. JSON 이 아니면 null.
 */
export function valueFields(text: string | null | undefined, unwrapBody: boolean): FieldResult[] | null {
  if (!text?.trim()) return null;
  return structuredMatch(text, text, { unwrapBody })?.fields ?? null;
}

const noStatus = (): FieldStatus => 'match';

function ValueTable({ fields, lead, trailing }: { fields: FieldResult[]; lead?: ReactNode; trailing?: ReactNode }) {
  const [q, setQ] = useState('');
  const [collapsed, toggleGroup, setCollapsed] = useToggleSet();
  const [open, toggleValue] = useToggleSet();
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? fields.filter((f) => f.path.toLowerCase().includes(needle)) : fields;
  }, [fields, q]);
  const tree = useMemo(() => buildFieldTree(shown), [shown]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const groups = useMemo(() => groupPaths(tree), [tree]);
  const allCollapsed = groups.length > 0 && groups.every((p) => collapsed.has(p));

  const roomy = fields.length >= ROOMY;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
        {lead}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {roomy && groups.length > 0 && (
            <button
              type="button"
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups))}
              className="h-7 rounded-sm border border-line px-2.5 text-xs text-muted transition hover:bg-surface-2 hover:text-ink"
            >
              {allCollapsed ? '모두 펼치기' : '모두 접기'}
            </button>
          )}
          {roomy && (
            <span className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="키 검색"
                spellCheck={false}
                className="h-7 w-40 rounded-sm border border-line bg-surface-2 pl-2 pr-5 font-mono text-xs text-ink outline-none transition placeholder:font-sans placeholder:text-muted-soft focus:border-accent-line focus:bg-surface focus:shadow-ring"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  aria-label="검색 지우기"
                  className="absolute right-1 top-1/2 -translate-y-1/2 px-0.5 text-[11px] leading-none text-muted hover:text-ink"
                >
                  ×
                </button>
              )}
            </span>
          )}
          {trailing}
        </span>
      </div>
      {shown.length === 0 ? (
        <NoRows>검색과 맞는 키가 없습니다</NoRows>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] table-fixed border-separate border-spacing-0 text-[13px] leading-normal">
            <colgroup>
              <col style={{ width: '32%' }} />
              <col style={{ width: '68%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface-3 text-left text-xs text-body">
              <tr>
                <th className={cn('border-b border-line px-3 py-1.5 font-semibold', COL)}>키</th>
                <th className="border-b border-line px-3 py-1.5 font-semibold">값</th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {rows.map((r) => {
                if (!r.item) {
                  return (
                    <GroupRow
                      key={r.path}
                      row={r}
                      collapsed={collapsed.has(r.path)}
                      span={1}
                      onToggle={() => toggleGroup(r.path)}
                      statusOf={noStatus}
                    />
                  );
                }
                const dim = tierOf(true, r.item.actual, r.item.actual) === 'blank';
                return (
                  <tr key={r.path} className="group transition-colors hover:bg-surface-2/70">
                    <KeyCell
                      path={r.path}
                      label={r.label}
                      depth={r.depth}
                      gutter={groups.length > 0}
                      rail="border-l-transparent"
                      dim={dim}
                    />
                    <ValueCell
                      text={r.item.actual}
                      absentLabel=""
                      segs={null}
                      tone="ok"
                      fill=""
                      dim={dim}
                      expanded={open.has(r.path)}
                      onToggle={() => toggleValue(r.path)}
                      last
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 정답 없이 돌린 결과를 판정표와 같은 모양으로 — 기대값·일치 칸만 없다. 키별 /
 * 원본 전환도 그대로라, 들여쓴 JSON 전체가 필요할 때는 한 번에 넘어간다.
 * JSON 이 아닌 값에는 쓰지 않는다(`valueFields` 가 null) — 그때는 원문 상자가 맞다.
 */
export function ValuePanel({
  text, unwrapBody, label, tag, trailing, flush,
}: {
  text: string;
  unwrapBody: boolean;
  label: string;
  tag?: string | null;
  trailing?: ReactNode;
  /** 케이스 본문의 한 상자 안에 설 때. */
  flush?: boolean;
}) {
  const fields = useMemo(() => valueFields(text, unwrapBody), [text, unwrapBody]);
  const pretty = useMemo(() => prettyValue(text) ?? text, [text]);
  const [raw, setRaw] = useState(false);
  const head = (
    <>
      <span className="eyebrow">{label}</span>
      {tag && <TraceTag name={tag} />}
      {fields && (
        <span className="text-xs text-muted">
          키 <span className="font-mono font-semibold tabular-nums text-ink">{fields.length}</span>
        </span>
      )}
    </>
  );
  const tools = (
    <>
      {trailing}
      {fields && <ViewToggle raw={raw} onRaw={setRaw} />}
      <CopyButton text={text} />
    </>
  );

  return (
    <div className={cn('min-w-0 overflow-hidden bg-surface', !flush && 'rounded-md border border-line')}>
      {fields && !raw ? (
        <ValueTable fields={fields} lead={head} trailing={tools} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
            {head}
            <span className="ml-auto flex items-center gap-2">{tools}</span>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-xs leading-relaxed text-ink">
            {pretty}
          </pre>
        </>
      )}
    </div>
  );
}

export default MatchDiff;
