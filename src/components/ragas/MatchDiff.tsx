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
import { diffWords, type DiffPair, type DiffSeg } from '@/lib/textDiff';
import { cn } from '@/lib/cn';
import type { RagasResultRow } from '@/lib/types';
import { AnswerBox, Chevron, CopyButton, ElapsedTag, OxBadge, TraceTag } from './shared';

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
const BAD_FILL = { expected: 'bg-ok-soft text-ok', actual: 'bg-bad-soft text-bad' };

const STATUS: Record<FieldStatus, StatusStyle> = {
  match: { label: '일치', text: QUIET, chip: QUIET, rail: 'border-l-transparent', expected: '', actual: '' },
  diff: { label: '값 다름', text: 'text-bad', chip: BAD_CHIP, rail: 'border-l-bad-vivid', ...BAD_FILL },
  type: { label: '타입 다름', text: 'text-bad', chip: BAD_CHIP, rail: 'border-l-bad-vivid', ...BAD_FILL },
  // 기대값만 있는 줄이라 실제값 칸은 칠하지 않는다 — 거기엔 아무것도 없다.
  missing: { label: '누락', text: 'text-bad', chip: BAD_CHIP, rail: 'border-l-bad-vivid', expected: 'bg-ok-soft text-ok', actual: '' },
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

/** 어긋난 낱말에 얹는 색. 칸 전체를 칠하지 않으니 한 단계 진한 톤을 쓴다. */
const MARK: Record<'ok' | 'bad' | 'warn', string> = {
  ok: 'bg-ok-soft2 text-ok',
  bad: 'bg-bad-soft2 text-bad',
  warn: 'bg-warn-soft2 text-warn',
};

/** 접힌 가지가 무엇을 감추고 있는지 고를 때의 순서 — 누락이 가장 무겁고 '추가'가
 * 가장 가볍다. */
const RANK: Record<FieldStatus, number> = { match: 0, extra: 1, diff: 2, type: 3, missing: 4 };
const rankOf = (s: FieldStatus) => RANK[s];

const FAIL_KINDS: FieldStatus[] = ['diff', 'type', 'missing', 'extra'];

const CELL = 'border-b border-line px-3 py-2 align-top';
/** 열 사이 세로 헤어라인. 값이 두 칸에 걸쳐 읽히는 표라 가로줄만으로는 어느
 * 칸까지가 기대값인지 눈이 자꾸 놓친다. */
const COL = 'border-r border-line';

/** 이 길이를 넘는 값은 두 줄로 접어 둔다. 한 줄이 화면을 다 먹으면 위아래를
 * 나란히 읽으라고 만든 표가 아니게 된다. */
const LONG = 90;
/** 이보다 긴 짝은 낱말 맞추기를 포기하고 칸을 통째로 칠한다. */
const MARKABLE = 600;

/** 값이 아예 없는 쪽 — 빈 칸으로 두면 '빈 문자열이 왔다'로도 읽힌다. */
function Absent({ children }: { children: string }) {
  return <span className="font-sans text-[11px] text-muted opacity-70">{children}</span>;
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
// 걸러 보기 — 머리줄의 숫자가 곧 버튼이다
// ---------------------------------------------------------------------------

/** 표에 무엇을 남길지. 상태 이름 하나면 그 상태만. */
type RowFilter = 'all' | 'bad' | FieldStatus;

function keepStatus(s: FieldStatus, filter: RowFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'bad') return s !== 'match';
  return s === filter;
}

/** 같은 수를 한 번은 요약으로 한 번은 필터 막대로 두 줄에 걸쳐 적는 대신,
 * 세어 놓은 숫자를 그대로 누르게 한다. 누른 칩을 다시 누르면 전체로 돌아온다. */
function FilterChip({
  active, tone, count, label, onClick, title,
}: {
  active: boolean;
  tone?: string;
  count: number;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'inline-flex items-baseline gap-1 rounded-sm border px-1.5 py-px text-[11px] font-medium transition',
        active ? 'border-line-strong bg-surface-3 text-ink' : cn('border-transparent hover:bg-surface-3', tone ?? 'text-muted'),
      )}
    >
      {label}
      <span className="font-mono tabular-nums">{count}</span>
    </button>
  );
}

/** 표 위 한 줄: 몇 개 중 몇 개가 맞았고 틀린 것은 어떤 종류인지 — 그리고 그
 * 숫자를 누르면 표가 거기에 맞춰 줄어든다. 일치/불일치 배지만으로는 "키 하나
 * 때문인지 전부 어긋났는지"를 알 수 없다. */
function FieldFilterBar({
  m, filter, onFilter,
}: {
  m: StructuredMatch;
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
}) {
  const counts = FAIL_KINDS
    .map((k) => [k, m.fields.filter((f) => f.status === k).length] as const)
    .filter(([, n]) => n > 0);
  const bad = m.total - m.matched;
  const pick = (f: RowFilter) => onFilter(filter === f ? 'all' : f);
  return (
    <span className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[11px]">
      <button
        type="button"
        onClick={() => onFilter('all')}
        aria-pressed={filter === 'all'}
        title="전체 키"
        className={cn(
          'rounded-sm border px-1.5 py-px font-mono tabular-nums transition',
          filter === 'all' ? 'border-line-strong bg-surface-3' : 'border-transparent hover:bg-surface-3',
        )}
      >
        <span className="font-sans font-medium text-muted">키 </span>
        <span className="font-semibold text-ink">{m.matched}</span>
        <span className="text-muted-soft">/{m.total}</span>
      </button>
      {counts.length > 0 && <span aria-hidden className="mx-1 h-2.5 w-px self-center bg-line-strong" />}
      {/* 종류가 둘 이상일 때만 합계가 따로 설 값이 있다 — 하나뿐이면 그 칩이
          곧 '어긋남 전부'다. */}
      {counts.length > 1 && (
        <FilterChip
          active={filter === 'bad'}
          tone="text-bad"
          count={bad}
          label="어긋남"
          onClick={() => pick('bad')}
          title="일치한 키를 숨긴다"
        />
      )}
      {counts.map(([k, n]) => (
        <FilterChip
          key={k}
          active={filter === k}
          tone={STATUS[k].text}
          count={n}
          label={STATUS[k].label}
          onClick={() => pick(k)}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 표의 부품 — 단일 표와 A/B 표가 같은 것을 쓴다
// ---------------------------------------------------------------------------

/** 키 칸. 들여쓰기가 구조를 말하므로 경로 전체가 아니라 이 줄이 가진 마디만
 * 적는다 — 스무 줄이 같은 접두사를 되풀이하면 정작 달라지는 끝마디가 묻힌다.
 * 전체 경로는 툴팁으로 남고, 손을 올리면 집어갈 수 있다. */
function KeyCell({
  row, rail, gutter, lead, children,
}: {
  row: { path: string; label: string; depth: number };
  rail: string;
  /** 가지가 하나라도 있는 표에서는 잎 줄도 셰브런 자리를 비워 둔다 — 그래야
   * 같은 깊이의 가지와 잎이 한 선에 선다. */
  gutter: boolean;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <td className={cn(CELL, COL, 'border-l-[3px] font-mono text-ink', rail)}>
      <span className="flex items-baseline gap-1" style={{ paddingLeft: row.depth * 12 }}>
        {gutter && <span className="w-3.5 shrink-0 self-center">{lead}</span>}
        <span className="min-w-0 break-all" title={row.path || undefined}>
          {row.label || <span className="text-muted">(전체)</span>}
        </span>
        {children}
        {row.path && (
          <IconCopy text={row.path} className="ml-auto shrink-0 self-start opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </span>
    </td>
  );
}

function ValueCell({
  text, absentLabel, segs, tone, fill, expanded, onToggle, last,
}: {
  text: string | null;
  absentLabel: string;
  /** 낱말 단위 표시. null 이면 칸을 통째로 칠한다. */
  segs: DiffSeg[] | null;
  tone: 'ok' | 'bad' | 'warn';
  fill: string;
  expanded: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  if (text === null) {
    return (
      <td className={cn(CELL, !last && COL)}>
        <Absent>{absentLabel}</Absent>
      </td>
    );
  }
  const long = text.length > LONG;
  return (
    <td className={cn(CELL, !last && COL, 'group/v relative break-words font-mono', !segs && fill)}>
      <div className={cn(!expanded && long && 'line-clamp-2')}>
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
      {long && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="mt-1 font-sans text-[10px] text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
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

/** 접었다 펴는 가지 줄. 접혀 있어도 아래에 무엇이 있는지는 말한다 — 조용한 가지는
 * 그 아래 실패가 없는 것으로 읽힌다. */
function GroupRow<T extends Pathed>({
  row, cols, collapsed, onToggle, statusOf,
}: {
  row: TreeRow<T>;
  /** 요약을 걸칠 가운데 칸 수 (단일 2, 비교 3). */
  cols: number;
  collapsed: boolean;
  onToggle: () => void;
  statusOf: (item: T) => FieldStatus;
}) {
  const worst = worstStatus(row, statusOf, rankOf);
  const bad = countBad(row, statusOf);
  const s = STATUS[worst];
  return (
    <tr className="group cursor-pointer bg-surface-2/40 transition-colors hover:bg-surface-2" onClick={onToggle}>
      <KeyCell
        row={row}
        gutter
        rail={worst === 'match' ? 'border-l-transparent' : s.rail}
        lead={<Chevron open={!collapsed} />}
      />
      <td className={cn(CELL, COL)} colSpan={cols}>
        <span className="text-[11px] text-muted">
          하위 <span className="font-mono tabular-nums">{row.leaves}</span>개
          {bad > 0 && (
            <span className={cn('font-medium', s.text)}>
              {' · '}
              {worst === 'extra' ? '추가' : '어긋남'} <span className="font-mono tabular-nums">{bad}</span>
            </span>
          )}
        </span>
      </td>
      <td className={cn(CELL, 'whitespace-nowrap')}>
        {collapsed && bad > 0 && (
          <span className={cn('inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold', s.chip)}>
            {s.label}
          </span>
        )}
      </td>
    </tr>
  );
}

/** 표 안쪽 얇은 조작 줄 — 키가 많을 때만 선다. 키 이름으로 좁히고, 가지를 한
 * 번에 접는다. 걸러낸 줄 수는 여기서 말한다: 표가 짧아진 이유가 필터인지 실제로
 * 키가 그것뿐인지 헷갈리면 안 된다. */
function TableToolbar({
  q, onQ, groups, allCollapsed, onToggleAll, hidden, onClearFilter,
}: {
  q: string;
  onQ: (v: string) => void;
  groups: number;
  allCollapsed: boolean;
  onToggleAll: () => void;
  hidden: number;
  onClearFilter?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
      <input
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder="키 검색"
        spellCheck={false}
        className="h-6 w-36 rounded-sm border border-line bg-surface-2 px-2 font-mono text-[11px] text-ink outline-none transition placeholder:font-sans placeholder:text-muted-soft focus:border-accent-line focus:bg-surface focus:shadow-ring"
      />
      {q && (
        <button type="button" onClick={() => onQ('')} className="text-[11px] text-muted hover:text-ink">
          지우기
        </button>
      )}
      {hidden > 0 && (
        <span className="text-[11px] text-muted">
          <span className="font-mono tabular-nums">{hidden}</span>개 숨김
          {onClearFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              className="ml-1.5 underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              전체 보기
            </button>
          )}
        </span>
      )}
      {groups > 0 && (
        <button
          type="button"
          onClick={onToggleAll}
          className="ml-auto rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-surface-2 hover:text-ink"
        >
          {allCollapsed ? '모두 펼치기' : '모두 접기'}
        </button>
      )}
    </div>
  );
}

/** 걸러낸 뒤 아무 줄도 남지 않았을 때. 빈 표는 '비교할 것이 없다'로도 읽힌다. */
function NoRows({ children }: { children: string }) {
  return <div className="px-3 py-6 text-center text-xs text-muted">{children}</div>;
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

/** 길어서 접어 둔 값 중 어느 줄이 펴져 있는지 — 한 줄의 값 칸 둘은 같이 펴진다. */
function useExpanded() {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) =>
    setOpen((cur) => { const n = new Set(cur); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  return { open, toggle };
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) =>
    setCollapsed((cur) => { const n = new Set(cur); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  return { collapsed, setCollapsed, toggle };
}

// ---------------------------------------------------------------------------
// 단일 실행 — 키별 판정표
// ---------------------------------------------------------------------------

function FieldRow({
  row, gutter, expanded, onExpand,
}: {
  row: TreeRow<FieldResult>;
  gutter: boolean;
  expanded: boolean;
  onExpand: () => void;
}) {
  const f = row.item as FieldResult;
  const s = STATUS[f.status];
  // 같은 값 두 개를 통째로 붉히는 대신 어긋난 낱말만 — 긴 문장에서 어디가
  // 갈렸는지 사람이 눈으로 찾던 일을 표가 한다.
  const marks = useMemo(() => markPair(f.expected, f.actual, f.status === 'diff'), [f]);
  return (
    <tr className="group transition-colors hover:bg-surface-2/70">
      <KeyCell row={row} gutter={gutter} rail={s.rail} />
      <ValueCell
        text={f.expected}
        absentLabel="기대에 없음"
        segs={marks ? marks.left : null}
        tone="ok"
        fill={s.expected}
        expanded={expanded}
        onToggle={onExpand}
      />
      <ValueCell
        text={f.actual}
        absentLabel="응답에 없음"
        segs={marks ? marks.right : null}
        tone={f.status === 'extra' ? 'warn' : 'bad'}
        fill={s.actual}
        expanded={expanded}
        onToggle={onExpand}
      />
      <td className={cn(CELL, 'whitespace-nowrap')}>
        <span className={cn('inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold', s.chip)}>
          {s.label}
        </span>
      </td>
    </tr>
  );
}

const fieldStatus = (f: FieldResult) => f.status;

/** 키 단위 판정표. 기대 정답에 적힌 순서 그대로, 온 구조 그대로 읽히고, 어긋난
 * 줄만 색을 갖는다 — 왼쪽 톤 레일과 어긋난 낱말, 그리고 결과 칩.
 *
 * 열 너비는 고정 비율이다. 자동 폭은 값 하나가 길어질 때마다 열이 통째로 밀려,
 * 위아래 줄의 기대값·실제값이 서로 어긋난 자리에 서게 된다 — 나란히 읽으라고
 * 만든 표에서 그것만은 일어나면 안 된다. */
function FieldTable({
  m, filter, onFilter,
}: {
  m: StructuredMatch;
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
}) {
  const [q, setQ] = useState('');
  const { collapsed, setCollapsed, toggle: toggleGroup } = useCollapsed();
  const { open, toggle: toggleValue } = useExpanded();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return m.fields.filter(
      (f) => keepStatus(f.status, filter) && (!needle || f.path.toLowerCase().includes(needle)),
    );
  }, [m.fields, filter, q]);
  const tree = useMemo(() => buildFieldTree(shown), [shown]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const groups = useMemo(() => groupPaths(tree), [tree]);
  const hidden = m.total - shown.length;

  return (
    <div>
      {(m.total >= 8 || groups.length > 0) && (
        <TableToolbar
          q={q}
          onQ={setQ}
          groups={groups.length}
          allCollapsed={groups.length > 0 && groups.every((p) => collapsed.has(p))}
          onToggleAll={() =>
            setCollapsed((cur) => (groups.every((p) => cur.has(p)) ? new Set() : new Set(groups)))
          }
          hidden={hidden}
          onClearFilter={filter !== 'all' ? () => onFilter('all') : undefined}
        />
      )}
      {rows.length === 0 ? (
        <NoRows>{q.trim() ? '검색과 맞는 키가 없습니다' : '해당하는 키가 없습니다'}</NoRows>
      ) : (
        <div className="max-h-96 overflow-auto">
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
              {rows.map((r) =>
                r.item ? (
                  <FieldRow
                    key={r.path}
                    row={r}
                    gutter={groups.length > 0}
                    expanded={open.has(r.path)}
                    onExpand={() => toggleValue(r.path)}
                  />
                ) : (
                  <GroupRow
                    key={r.path}
                    row={r}
                    cols={2}
                    collapsed={collapsed.has(r.path)}
                    onToggle={() => toggleGroup(r.path)}
                    statusOf={fieldStatus}
                  />
                ),
              )}
            </tbody>
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
  // 키가 많고 어긋난 것이 있으면 어긋난 줄부터 연다 — 스무 줄 중 두 줄을 찾으러
  // 스크롤을 내리는 것이 이 표에서 가장 자주 하는 일이었다. 짧은 표는 그대로
  // 둔다: 여덟 줄은 한눈에 들어오고, 걸러 놓으면 무엇이 맞았는지가 사라진다.
  const [filter, setFilter] = useState<RowFilter>(() =>
    fields && !fields.ok && fields.total >= 10 ? 'bad' : 'all',
  );

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
        {fields && !raw && <FieldFilterBar m={fields} filter={filter} onFilter={setFilter} />}
        {fields && raw && (
          <span className="font-mono text-[11px] tabular-nums text-muted">
            키 <span className="font-semibold text-ink">{fields.matched}</span>
            <span className="text-muted-soft">/{fields.total}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {fields && <ViewToggle raw={raw} onRaw={setRaw} />}
          <ElapsedTag ms={row.elapsed_ms} />
        </span>
      </div>
      {fields && !raw ? (
        <FieldTable m={fields} filter={filter} onFilter={setFilter} />
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

/** 이 키에서 둘이 어떻게 갈렸나. 비교 화면이 답해야 하는 유일한 질문이라 필터도
 * 행 표시도 전부 이 값 하나에서 나온다. */
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

type AbFilter = 'all' | AbVerdict;

/** 가지 줄의 톤을 고르는 데만 쓰는 상태 — 한쪽이라도 어긋났으면 그 종류로 선다. */
function pairStatus(r: PairRow): FieldStatus {
  const st = [r.a?.status, r.b?.status].filter(Boolean) as FieldStatus[];
  return st.reduce<FieldStatus>((worst, s) => (rankOf(s) > rankOf(worst) ? s : worst), 'match');
}

/** A/B 표의 한 줄. 어느 쪽이 맞았는지는 키 옆의 작은 표시 하나로 — 값 칸을 읽지
 * 않고 세로로 훑기만 해도 갈린 자리가 보여야 한다. */
function PairFieldRow({
  row, gutter, expanded, onExpand,
}: {
  row: TreeRow<PairRow>;
  gutter: boolean;
  expanded: boolean;
  onExpand: () => void;
}) {
  const r = row.item as PairRow;
  const v = abVerdict(r);
  const bad = v !== 'same-ok';
  const warnOnly = [r.a, r.b].every((f) => !f || f.status === 'match' || f.status === 'extra');
  const marks = {
    a: markPair(r.expected, r.a?.actual ?? null, r.a?.status === 'diff'),
    b: markPair(r.expected, r.b?.actual ?? null, r.b?.status === 'diff'),
  };
  const cell = (f: FieldResult | undefined, mark: DiffPair | null, last?: boolean) => {
    if (!f) return <td className={cn(CELL, !last && COL, 'text-muted-soft')}>—</td>;
    return (
      <ValueCell
        text={f.actual}
        absentLabel="응답에 없음"
        segs={mark ? mark.right : null}
        tone={f.status === 'extra' ? 'warn' : 'bad'}
        fill={STATUS[f.status].actual}
        expanded={expanded}
        onToggle={onExpand}
        last={last}
      />
    );
  };
  return (
    <tr className="group transition-colors hover:bg-surface-2/70">
      <KeyCell
        row={row}
        gutter={gutter}
        rail={!bad ? 'border-l-transparent' : warnOnly ? 'border-l-warn-vivid' : 'border-l-bad-vivid'}
      >
        {(v === 'a' || v === 'b') && (
          <span
            title={AB_LABEL[v]}
            className="shrink-0 rounded-sm border border-ok-line bg-ok-soft px-1 py-px text-[10px] font-semibold text-ok"
          >
            {v.toUpperCase()}
          </span>
        )}
      </KeyCell>
      <td className={cn(CELL, COL, 'break-words font-mono', bad ? 'text-ok' : 'text-muted')}>
        {r.expected === null ? <Absent>기대에 없음</Absent> : r.expected}
      </td>
      {cell(r.a, marks.a)}
      {cell(r.b, marks.b, true)}
    </tr>
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
 * 머리줄의 셋 — A만 맞음 · B만 맞음 · 둘 다 불일치 — 은 세어 놓은 수이자 필터다.
 * 키가 서른 개인 페이로드에서 갈린 두 개를 찾는 일이 이 화면에서 제일 잦다.
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
  const all = useMemo<PairRow[] | null>(() => {
    const ma = structuredMatch(aText ?? '', expected ?? '', { unwrapBody: unwrapA });
    const mb = structuredMatch(bText ?? '', expected ?? '', { unwrapBody: unwrapB });
    if (!ma && !mb) return null;
    // A 가 본 순서를 그대로 따르고, A 에 없던 키만 뒤에 붙인다 — 기대 정답에 적힌
    // 차례가 곧 A 의 차례라, 두 사이드를 합쳐도 읽는 순서가 바뀌지 않는다.
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

  const [filter, setFilter] = useState<AbFilter>('all');
  const [q, setQ] = useState('');
  const { collapsed, setCollapsed, toggle: toggleGroup } = useCollapsed();
  const { open, toggle: toggleValue } = useExpanded();

  const counts = useMemo(() => {
    const c: Record<AbVerdict, number> = { 'same-ok': 0, 'same-bad': 0, a: 0, b: 0 };
    all?.forEach((r) => { c[abVerdict(r)]++; });
    return c;
  }, [all]);
  const shown = useMemo(() => {
    if (!all) return [];
    const needle = q.trim().toLowerCase();
    return all.filter(
      (r) => (filter === 'all' || abVerdict(r) === filter) && (!needle || r.path.toLowerCase().includes(needle)),
    );
  }, [all, filter, q]);
  const tree = useMemo(() => buildFieldTree(shown), [shown]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const groups = useMemo(() => groupPaths(tree), [tree]);

  if (!all) return null;
  const hidden = all.length - shown.length;
  const pick = (f: AbFilter) => setFilter(filter === f ? 'all' : f);
  const chips: [AbVerdict, string][] = [['a', 'text-ok'], ['b', 'text-ok'], ['same-bad', 'text-bad']];
  const quiet = counts.a + counts.b + counts['same-bad'] === 0;

  return (
    <div className={cn('overflow-hidden rounded-md border border-line bg-surface', className)}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-line bg-surface-2 px-3 py-2">
        <span className="eyebrow">키별 판정</span>
        <button
          type="button"
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          title="전체 키"
          className={cn(
            'ml-1 rounded-sm border px-1.5 py-px text-[11px] transition',
            filter === 'all' ? 'border-line-strong bg-surface-3' : 'border-transparent hover:bg-surface-3',
          )}
        >
          <span className="text-muted">키 </span>
          <span className="font-mono font-semibold tabular-nums text-ink">{all.length}</span>
        </button>
        <span aria-hidden className="mx-1 h-3 w-px self-center bg-line-strong" />
        {/* 갈린 키가 이 표의 요점이다 — 없으면 없다고 먼저 말한다. */}
        {quiet ? (
          <span className="text-[11px] text-muted">A·B 동일</span>
        ) : (
          chips
            .filter(([k]) => counts[k] > 0)
            .map(([k, tone]) => (
              <FilterChip
                key={k}
                active={filter === k}
                tone={tone}
                count={counts[k]}
                label={AB_LABEL[k]}
                onClick={() => pick(k)}
              />
            ))
        )}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </div>
      {(all.length >= 8 || groups.length > 0) && (
        <TableToolbar
          q={q}
          onQ={setQ}
          groups={groups.length}
          allCollapsed={groups.length > 0 && groups.every((p) => collapsed.has(p))}
          onToggleAll={() =>
            setCollapsed((cur) => (groups.every((p) => cur.has(p)) ? new Set() : new Set(groups)))
          }
          hidden={hidden}
          onClearFilter={filter !== 'all' ? () => setFilter('all') : undefined}
        />
      )}
      {rows.length === 0 ? (
        <NoRows>{q.trim() ? '검색과 맞는 키가 없습니다' : '해당하는 키가 없습니다'}</NoRows>
      ) : (
        <div className="max-h-96 overflow-auto">
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
              {rows.map((r) =>
                r.item ? (
                  <PairFieldRow
                    key={r.path}
                    row={r}
                    gutter={groups.length > 0}
                    expanded={open.has(r.path)}
                    onExpand={() => toggleValue(r.path)}
                  />
                ) : (
                  <GroupRow
                    key={r.path}
                    row={r}
                    cols={2}
                    collapsed={collapsed.has(r.path)}
                    onToggle={() => toggleGroup(r.path)}
                    statusOf={pairStatus}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default MatchDiff;
