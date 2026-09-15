'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { abKeyStats, keyStats, structuredCount, type AbKeyStat, type KeyStat } from '@/lib/fieldStats';
import type { FieldStatus } from '@/lib/exactMatch';
import type { RagasResultRow } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Chevron } from './shared';

/**
 * 실행 전체를 키 단위로 — 케이스 하나가 아니라 데이터셋 하나에 대한 답.
 *
 * 케이스별 판정표는 "이 케이스는 왜 틀렸나"까지만 답한다. 마흔 개짜리 데이터셋을
 * 돌리는 이유인 "어떤 키가 자주 깨지나"는, 마흔 개를 하나씩 펼쳐 보고 각각이
 * 무슨 말을 했는지 외우는 것 말고는 읽을 방법이 없었다. 이 판이 그 자리를 채운다.
 *
 * 규칙 몇 가지:
 * · 실패한 키만 선다. 다 맞은 실행에서는 아예 그리지 않는다 — 전부 0 인 표는
 *   화면을 차지할 뿐 아무 말도 하지 않는다.
 * · 정렬은 실패 '수'다. 비율로 세우면 한 번 비교되어 한 번 틀린 키가 마흔 중
 *   열둘을 틀린 키 위에 선다 — 고치러 갈 곳은 후자다.
 * · 한 줄을 펼치면 그 키가 틀어진 케이스만 모여 나온다. 어느 케이스였는지
 *   찾으러 아래 목록을 다시 훑지 않아도 되게.
 */

const TONE: Record<FieldStatus, string> = {
  match: 'text-muted',
  diff: 'text-bad',
  type: 'text-bad',
  missing: 'text-bad',
  extra: 'text-warn',
};

const LABEL: Record<FieldStatus, string> = {
  match: '일치',
  diff: '값 다름',
  type: '타입 다름',
  missing: '누락',
  extra: '추가',
};

const FAIL_KINDS: FieldStatus[] = ['diff', 'type', 'missing', 'extra'];

/** 처음에 세우는 줄 수. 넘치면 접어 두고 세어서 말한다 — 키가 예순 개인
 * 페이로드에서 이 판이 화면을 통째로 밀어내면 안 된다. */
const FIRST = 8;

function Panel({
  title, count, children, note,
}: {
  title: string;
  count: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface-2 px-3 py-2">
        <span className="eyebrow">{title}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
        {note && <span className="ml-auto text-[11px] text-muted">{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** 실패율 막대. 숫자를 읽기 전에 어느 줄이 심한지부터 보이게. */
function Bar({ ratio, tone = 'bg-bad-vivid' }: { ratio: number; tone?: string }) {
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <span className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.round(ratio * 100)}%` }} />
    </span>
  );
}

function StatusCounts({ counts }: { counts: Record<FieldStatus, number> }) {
  const shown = FAIL_KINDS.filter((k) => counts[k] > 0);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
      {shown.map((k) => (
        <span key={k} className={cn('font-medium', TONE[k])}>
          {LABEL[k]} <span className="font-mono tabular-nums">{counts[k]}</span>
        </span>
      ))}
    </span>
  );
}

/** '더 보기' 한 줄. 목록을 자른 사실 자체가 보여야 해서 버튼이 곧 그 말이다. */
function MoreRow({ hidden, open, onToggle }: { hidden: number; open: boolean; onToggle: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full border-t border-line bg-surface-2 px-3 py-1.5 text-center text-[11px] text-muted transition hover:bg-surface-3 hover:text-ink"
    >
      {open ? '접기' : `나머지 ${hidden}개 키 보기`}
    </button>
  );
}

/** 한 키가 틀어진 케이스들. 질문 한 줄과 두 값 — 아래 목록에서 그 케이스를
 * 다시 찾지 않아도 되는 만큼만. */
function FailCases({ stat }: { stat: KeyStat }) {
  return (
    <tr>
      <td colSpan={4} className="border-b border-line bg-surface-2 px-3 py-2 pl-8">
        <ul className="space-y-1.5">
          {stat.fails.map((c) => (
            <li key={c.resultId} className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <span className="truncate text-[11px] text-body" title={c.question ?? undefined}>
                {c.question ?? '—'}
              </span>
              <span className="truncate font-mono text-[11px] text-ok" title={c.expected ?? undefined}>
                {c.expected ?? '기대에 없음'}
              </span>
              <span
                className={cn('truncate font-mono text-[11px]', c.status === 'extra' ? 'text-warn' : 'text-bad')}
                title={c.actual ?? undefined}
              >
                {c.actual ?? '응답에 없음'}
              </span>
              <span className={cn('whitespace-nowrap text-[10px] font-semibold', TONE[c.status])}>
                {LABEL[c.status]}
              </span>
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

function KeyRow({ stat, open, onToggle }: { stat: KeyStat; open: boolean; onToggle: () => void }) {
  const fails = stat.fails.length;
  return (
    <>
      <tr className="cursor-pointer transition-colors hover:bg-surface-2/70" onClick={onToggle}>
        <td className="border-b border-line px-3 py-2 align-middle">
          <span className="flex items-center gap-1">
            <Chevron open={open} />
            <span className="min-w-0 truncate font-mono text-xs text-ink" title={stat.path || undefined}>
              {stat.path || '(전체)'}
            </span>
          </span>
        </td>
        <td className="border-b border-line px-3 py-2 align-middle">
          <Bar ratio={stat.total ? fails / stat.total : 0} />
        </td>
        <td className="whitespace-nowrap border-b border-line px-3 py-2 text-right align-middle font-mono text-xs tabular-nums">
          <span className="font-semibold text-bad">{fails}</span>
          <span className="text-muted">/{stat.total}</span>
        </td>
        <td className="border-b border-line px-3 py-2 align-middle">
          <StatusCounts counts={stat.counts} />
        </td>
      </tr>
      {open && <FailCases stat={stat} />}
    </>
  );
}

/**
 * 단일 실행의 키별 집계. 실패한 키가 하나도 없으면 아무것도 그리지 않는다.
 */
export function KeyBreakdown({ rows }: { rows: RagasResultRow[] }) {
  const stats = useMemo(() => keyStats(rows).filter((s) => s.fails.length > 0), [rows]);
  const cases = useMemo(() => structuredCount(rows), [rows]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // 케이스가 하나뿐이면 바로 아래 판정표가 같은 말을 이미 하고 있다.
  if (cases < 2 || stats.length === 0) return null;
  const shown = all ? stats : stats.slice(0, FIRST);

  return (
    <Panel
      title="키별 집계"
      count={`${stats.length}개 키`}
      note={`${cases}개 케이스 기준`}
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
        <colgroup>
          <col style={{ width: '32%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '34%' }} />
        </colgroup>
        <thead className="text-left text-[10px] uppercase tracking-[0.6px] text-muted">
          <tr>
            <th className="border-b border-line px-3 py-1.5 font-semibold">키</th>
            <th className="border-b border-line px-3 py-1.5 font-semibold">실패율</th>
            <th className="border-b border-line px-3 py-1.5 text-right font-semibold">실패</th>
            <th className="border-b border-line px-3 py-1.5 font-semibold">유형</th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {shown.map((s) => (
            <KeyRow
              key={s.path}
              stat={s}
              open={open === s.path}
              onToggle={() => setOpen(open === s.path ? null : s.path)}
            />
          ))}
        </tbody>
      </table>
      <MoreRow hidden={stats.length - FIRST} open={all} onToggle={() => setAll(!all)} />
    </Panel>
  );
}

/** A·B 가 이 키에서 어떻게 갈렸는지 한 막대에 — A 만 맞은 몫과 B 만 맞은 몫이
 * 같은 길이에서 자리를 나눈다. 어느 쪽으로 기울었는지가 숫자보다 먼저 읽힌다. */
function SplitBar({ s }: { s: AbKeyStat }) {
  const w = (n: number) => (s.total ? `${Math.round((n / s.total) * 100)}%` : '0%');
  return (
    <span className="relative flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <span className="bg-muted" style={{ width: w(s.aOnly) }} title={`A만 맞음 ${s.aOnly}`} />
      <span className="bg-accent" style={{ width: w(s.bOnly) }} title={`B만 맞음 ${s.bOnly}`} />
      <span className="bg-bad-vivid" style={{ width: w(s.bothBad) }} title={`둘 다 불일치 ${s.bothBad}`} />
    </span>
  );
}

function AbCount({ n, tone }: { n: number; tone: string }) {
  return (
    <span className={cn('font-mono text-xs tabular-nums', n > 0 ? tone : 'text-muted-soft')}>{n}</span>
  );
}

/**
 * 비교 실행의 키별 집계 — 갈린 키를 위에서부터.
 *
 * 케이스마다 표를 열어 A·B 를 견줘 보는 대신, 데이터셋 전체에서 어느 키가 두
 * 버전을 갈랐는지 한 판으로 답한다. 갈린 데도 없고 둘 다 틀린 데도 없으면 그리지
 * 않는다.
 */
export function AbKeyBreakdown({
  aRows, bRows, nameA, nameB,
}: {
  aRows: RagasResultRow[];
  bRows: RagasResultRow[];
  nameA: string;
  nameB: string;
}) {
  const stats = useMemo(
    () => abKeyStats(aRows, bRows).filter((s) => s.split > 0 || s.bothBad > 0),
    [aRows, bRows],
  );
  const [all, setAll] = useState(false);
  if (stats.length === 0) return null;
  const shown = all ? stats : stats.slice(0, FIRST);
  const split = stats.filter((s) => s.split > 0).length;

  return (
    <Panel
      title="키별 집계"
      count={`${stats.length}개 키`}
      note={split > 0 ? `A·B 갈린 키 ${split}개` : 'A·B 갈린 키 없음'}
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
        <colgroup>
          <col style={{ width: '34%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead className="text-left text-[10px] uppercase tracking-[0.6px] text-muted">
          <tr>
            <th className="border-b border-line px-3 py-1.5 font-semibold">키</th>
            <th className="border-b border-line px-3 py-1.5 font-semibold">갈림</th>
            <th className="truncate border-b border-line px-3 py-1.5 text-right font-semibold" title={nameA}>A만</th>
            <th className="truncate border-b border-line px-3 py-1.5 text-right font-semibold" title={nameB}>B만</th>
            <th className="border-b border-line px-3 py-1.5 text-right font-semibold">둘 다</th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {shown.map((s) => (
            <tr key={s.path} className="transition-colors hover:bg-surface-2/70">
              <td className="border-b border-line px-3 py-2 align-middle">
                <span className="block truncate font-mono text-xs text-ink" title={s.path || undefined}>
                  {s.path || '(전체)'}
                </span>
              </td>
              <td className="border-b border-line px-3 py-2 align-middle">
                <SplitBar s={s} />
              </td>
              <td className="border-b border-line px-3 py-2 text-right align-middle">
                <AbCount n={s.aOnly} tone="font-semibold text-ink" />
              </td>
              <td className="border-b border-line px-3 py-2 text-right align-middle">
                <AbCount n={s.bOnly} tone="font-semibold text-accent" />
              </td>
              <td className="border-b border-line px-3 py-2 text-right align-middle">
                <AbCount n={s.bothBad} tone="text-bad" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <MoreRow hidden={stats.length - FIRST} open={all} onToggle={() => setAll(!all)} />
    </Panel>
  );
}
