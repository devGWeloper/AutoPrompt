'use client';

import {
  Fragment, useCallback, useEffect, useState,
  type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatModelPair, formatModelSnapshot } from '@/lib/modelSnapshot';
import type { RagasRunDetail, RagasRunSummary } from '@/lib/types';
import CaseImportModal from './CaseImportModal';
import type { Fields } from './caseFields';
import { CaseCompareTable } from './CompareTable';
import { CompareSummaryDashboard, SingleRunSummaryDashboard } from './RunSummaryDashboard';
import { AbKeyBreakdown, KeyBreakdown } from './KeyBreakdown';
import {
  CaseTable, DownloadIcon, ErrBox, errText, fmt2, fmt3, fmtDt, folderLabel, hasTextSelection, runMean, runTargetLabel,
  compareSideLabel, runModelDetail, runTitle, runTitleParts, scoredMetrics, SegToggle, TrashIcon, UNSCORED_LABEL,
} from './shared';

const API_BASE = '/api';

type RunGroup =
  | { kind: 'single'; run: RagasRunSummary }
  | { kind: 'ab'; groupId: number; a: RagasRunSummary; b: RagasRunSummary };

function groupRuns(runs: RagasRunSummary[]): RunGroup[] {
  const groups: RunGroup[] = [];
  const seen = new Set<number>();
  for (const r of runs) {
    if (r.ab_group_id != null) {
      if (seen.has(r.ab_group_id)) continue;
      seen.add(r.ab_group_id);
      const members = runs.filter((x) => x.ab_group_id === r.ab_group_id).sort((a, b) => a.ragas_run_id - b.ragas_run_id);
      if (members.length === 2) { groups.push({ kind: 'ab', groupId: r.ab_group_id, a: members[0], b: members[1] }); continue; }
      members.forEach((mm) => groups.push({ kind: 'single', run: mm }));
    } else {
      groups.push({ kind: 'single', run: r });
    }
  }
  return groups;
}

// Records-tab type filter: an A/B pair is 'compare', everything else (dataset
// or manual, scored or not) is a 'single' run.
type RunTypeFilter = 'all' | 'single' | 'compare';
const RUN_TYPE_FILTERS: { id: RunTypeFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'single', label: 'Single' },
  { id: 'compare', label: 'Compare' },
];
function groupType(g: RunGroup): Exclude<RunTypeFilter, 'all'> {
  return g.kind === 'ab' ? 'compare' : 'single';
}

type RunSortKey = 'created' | 'avg';

const RUNS_PAGE_SIZE = 20; // rows per Records page

/** Status badge: soft tint + dot + text at the brand's 4px radius.
 * FAILED red (wins in mixed pair states like DONE/FAILED), DONE green,
 * everything else (RUNNING/CANCELLED…) muted. */
function StatusText({ s }: { s: string }) {
  const tone = s.includes('FAILED') ? 'bad' : s.includes('DONE') ? 'ok' : 'neutral';
  return <Badge tone={tone} dot>{s}</Badge>;
}

/** Run-type label — plain colored text (badges read too heavy at this density):
 * Single blue, Compare purple — the same two stops of the chromatic palette
 * that key those two sections in the tab header. */
function TypeText({ t }: { t: Exclude<RunTypeFilter, 'all'> }) {
  return (
    <span className={cn('text-xs font-semibold', t === 'compare' ? 'text-chroma-purple' : 'text-accent')}>
      {t === 'compare' ? 'Compare' : 'Single'}
    </span>
  );
}

/** 실행 번호. 맨 왼쪽 자기 열에 선다 — 대상 칸에 얹어 두면 제목이 매번 번호부터
 * 시작해서, 정작 읽어야 할 이름이 오른쪽으로 밀린다. A/B 는 두 건이라 둘 다. */
function RunIdCell({ ids }: { ids: string }) {
  return (
    <TD className="whitespace-nowrap font-mono text-[11px] text-muted-soft">{ids}</TD>
  );
}

/** 대상 칸 두 줄. 위는 **어디로 보냈나**(등록 API 이름, 없으면 host), 아래는
 * **무엇을 바꿔서 보냈나** — 프롬프트 버전, `model:` 을 단 고정 모델, A/B 라면
 * 갈린 축. 바꾼 게 없으면 그 줄은 `default` 다. 이 줄은 늘 있어서 행 높이가
 * 일정하고, 그래서 목록을 훑을 때 위아래가 흔들리지 않는다. */
function TargetCell({
  api, apiHint, change, changeHint,
}: {
  api: string;
  apiHint: string | null;
  change: string;
  changeHint: string | null;
}) {
  return (
    <TD className="max-w-[20rem]">
      <div className="truncate text-sm font-medium text-ink" title={apiHint ?? api}>{api}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted" title={changeHint ?? change}>
        {change}
      </div>
    </TD>
  );
}

/** 데이터 칸 — 데이터셋/폴더와 건수, 직접 실행이면 물어본 문장.
 *
 * 대상 칸과 같은 크기·같은 굵기다. 무엇을 시험했는지와 무엇으로 쟀는지는 한쪽이
 * 다른 쪽의 부연이 아니라 나란한 두 사실이고, 5건짜리 폴더와 24건짜리 전체를
 * 흐린 잔글씨로 적어 두면 그걸 못 보고 점수를 나란히 놓게 된다. 나머지 칸
 * (유형·상태·엔진·시각)은 muted 로 남아서, 이 둘이 행의 내용이 된다. */
function ScopeCell({ text, count }: { text: string | null; count: string | null }) {
  return (
    <TD title={[text, count].filter(Boolean).join(' ') || undefined}>
      {/* 건수는 shrink-0 이라 절대 안 잘린다. 한 문자열로 붙여 두면 좁은 칸에서
          오른쪽 끝인 건수부터 사라지는데, 5건짜리 폴더 실행과 24건짜리 전체 실행을
          가르는 게 바로 그 값이다. 이름이 길면 이름 쪽이 줄어든다. */}
      <div className="flex max-w-[16rem] items-baseline gap-1.5 text-sm font-medium text-ink">
        <span className="truncate">{text ?? '—'}</span>
        {count && <span className="shrink-0">{count}</span>}
      </div>
    </TD>
  );
}


/** Which models this run went out under. Absent when nothing was pinned — that
 * run used the agent's own config, and saying so on every old record would be
 * noise. */
function ModelStamp({ text: s }: { text: string | null }) {
  if (!s) return null;
  return (
    <>
      <span className="max-w-[22rem] truncate font-mono" title={s}>{s}</span>
      <span>·</span>
    </>
  );
}

/** Per-row actions: quiet icon-only ghost buttons (secondary-button idiom at table
 * density). Row expansion lives on the row itself, so only export + delete
 * remain here; stopPropagation keeps clicks from toggling the row. */
function RowActionsCell({ csvHref, onDelete }: { csvHref: string; onDelete: () => void }) {
  const base =
    'inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return (
    <TD className="whitespace-nowrap text-right">
      <div className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <a href={csvHref} title="CSV 내보내기" className={cn(base, 'hover:bg-surface-3 hover:text-ink')}>
          <DownloadIcon />
        </a>
        <button type="button" title="삭제" onClick={onDelete} className={cn(base, 'hover:bg-bad-soft hover:text-bad')}>
          <TrashIcon />
        </button>
      </div>
    </TD>
  );
}

/** Sortable column header: sortable columns always show a
 * faint ↕ affordance; the active sort darkens to ink with a solid ▲/▼. */
function SortTH({
  k, label, sort, onSort, className,
}: {
  k: RunSortKey; label: string;
  sort: { key: RunSortKey; dir: 'asc' | 'desc' };
  onSort: (k: RunSortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <TH className={cn('whitespace-nowrap', className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn('inline-flex items-center gap-1 transition-colors', active ? 'text-ink' : 'hover:text-ink')}
      >
        {label}
        <span className={cn('text-[9px] leading-none', !active && 'opacity-50')} aria-hidden>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </TH>
  );
}

const pct = (v: number | null | undefined) => (v != null ? `${Math.round(Number(v) * 100)}%` : '—');

/** 점수가 없을 때 그 자리에 서는 말. 채점을 끄고 돌린 실행과, 채점을 켰는데
 * 점수가 안 나온 실행(실패·진행 중)은 다른 사건이라 다르게 적는다. */
function NoScore({ unscored }: { unscored?: boolean }) {
  return unscored
    ? <span className="font-sans text-[11px] text-muted-soft">{UNSCORED_LABEL}</span>
    : <span className="text-muted">—</span>;
}

/** Score cell — the RAGAS mean and the 정답 일치 rate on separate lines, because
 * a graded mean and a pass rate are different claims about the run. Compare runs
 * show A/B on each line. Either line is omitted when that scorer never ran. */
function AvgCell({
  mean, meanA, meanB, ex, exA, exB, unscored,
}: {
  mean?: number | null; meanA?: number | null; meanB?: number | null;
  ex?: number | null; exA?: number | null; exB?: number | null;
  /** 채점하지 않은 실행 — 빈 점수 칸이 그 이유를 대게 한다. */
  unscored?: boolean;
}) {
  if (meanA !== undefined || meanB !== undefined) {
    const delta = meanA != null && meanB != null ? meanB - meanA : null;
    return (
      <TD className="font-mono text-xs tabular-nums text-ink whitespace-nowrap">
        <div className="flex flex-col gap-1">
          {(meanA != null || meanB != null) && (
            <div className="flex items-center gap-2">
              <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px] text-muted">RAGAS</span>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted font-normal">A <span className="font-semibold text-ink">{fmt2(meanA)}</span></span>
                <span className="text-muted-soft">·</span>
                <span className="text-muted font-normal">B <span className="font-semibold text-ink">{fmt2(meanB)}</span></span>
              </div>
              {delta != null && (
                <span
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border',
                    delta > 0
                      ? 'border-ok-line bg-ok-soft text-ok'
                      : delta < 0
                      ? 'border-bad-line bg-bad-soft text-bad'
                      : 'border-line bg-surface-2 text-muted'
                  )}
                >
                  {(delta > 0 ? '+' : '') + delta.toFixed(2)}
                </span>
              )}
            </div>
          )}
          {(exA != null || exB != null) && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px] text-muted">Action</span>
              <span className="text-muted font-normal">A <span className="font-semibold text-ink">{pct(exA)}</span></span>
              <span className="text-muted-soft">·</span>
              <span className="text-muted font-normal">B <span className="font-semibold text-ink">{pct(exB)}</span></span>
            </div>
          )}
          {meanA == null && meanB == null && exA == null && exB == null && <NoScore unscored={unscored} />}
        </div>
      </TD>
    );
  }

  return (
    <TD className="font-mono text-xs tabular-nums text-ink whitespace-nowrap">
      <div className="flex flex-col gap-0.5">
        {mean != null && (
          <span>
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px] text-muted">RAGAS </span>
            <span className="font-semibold">{fmt2(mean)}</span>
          </span>
        )}
        {ex != null && (
          <span>
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px] text-muted">Action </span>
            <span className="font-semibold">{pct(ex)}</span>
          </span>
        )}
        {mean == null && ex == null && <NoScore unscored={unscored} />}
      </div>
    </TD>
  );
}

export default function RecordsPanel() {
  const [ragas, setRagas] = useState<RagasRunSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunTypeFilter>('all');
  const [sort, setSort] = useState<{ key: RunSortKey; dir: 'asc' | 'desc' }>({ key: 'created', dir: 'desc' });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => { setPage(0); }, [filter, sort, query]);
  const reload = useCallback(() => {
    api.get<RagasRunSummary[]>('/ragas-runs').then(setRagas).catch(() => setRagas([]));
  }, []);
  useEffect(reload, [reload]);

  // 삭제가 거절될 수 있다 — 실행 중인 기록이 그렇다. 조용히 실패하면 행이
  // 그대로 남은 이유를 알 수 없으므로 목록 위에 이유를 적는다.
  const [delErr, setDelErr] = useState<string | null>(null);

  async function del(id: number) {
    setDelErr(null);
    try {
      await api.del(`/ragas-runs/${id}`);
    } catch (e) { setDelErr(errText(e)); return; }
    if (selectedKey === `s_${id}`) setSelectedKey(null);
    reload();
  }
  async function delPair(ids: number[], groupId: number) {
    setDelErr(null);
    try {
      await Promise.all(ids.map((i) => api.del(`/ragas-runs/${i}`)));
    } catch (e) { setDelErr(errText(e)); reload(); return; }
    if (selectedKey === `ab_${groupId}`) setSelectedKey(null);
    reload();
  }

  const toggleSort = (key: RunSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  const sortVal = (g: RunGroup): number | null => {
    if (sort.key === 'created') return g.kind === 'single' ? g.run.ragas_run_id : g.a.ragas_run_id;
    return runMean(g.kind === 'single' ? g.run : g.b);
  };

  const q = query.trim().toLowerCase();
  const matches = (g: RunGroup): boolean => {
    if (!q) return true;
    const rs = g.kind === 'single' ? [g.run] : [g.a, g.b];
    return rs.some((r) =>
      [
        r.node_nm,
        r.version_no != null ? `v${r.version_no}` : null,
        r.dataset_nm,
        r.case_type,
        r.first_question,
        `#${r.ragas_run_id}`,
        // 화면에 적힌 제목 그대로 — 폴더·건수·'답변만'까지 다 검색어가 된다.
        runTitle(r),
        // Searchable by model name: "이 모델로 돌린 실행만" is the main reason to
        // come back to this list after a model change.
        formatModelSnapshot(r.model_snapshot),
      ].some((v) => v != null && v.toLowerCase().includes(q)),
    );
  };

  const groups = groupRuns(ragas)
    .filter((g) => (filter === 'all' || groupType(g) === filter) && matches(g))
    .sort((x, y) => {
      const vx = sortVal(x); const vy = sortVal(y);
      if (vx == null && vy == null) return 0;
      if (vx == null) return 1;
      if (vy == null) return -1;
      return sort.dir === 'asc' ? vx - vy : vy - vx;
    });

  const pageCount = Math.max(1, Math.ceil(groups.length / RUNS_PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const paged = groups.slice(curPage * RUNS_PAGE_SIZE, curPage * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE);

  // Key generator helper
  const getGroupKey = (g: RunGroup) => (g.kind === 'single' ? `s_${g.run.ragas_run_id}` : `ab_${g.groupId}`);

  const selectedIndex = groups.findIndex((g) => getGroupKey(g) === selectedKey);
  const selectedGroup = selectedIndex >= 0 ? groups[selectedIndex] : null;

  // ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A dialog opened from the drawer takes Esc for itself — closing the drawer
      // underneath would throw away whatever was being edited in it.
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setSelectedKey(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handlePrevGroup = () => {
    if (selectedIndex > 0) setSelectedKey(getGroupKey(groups[selectedIndex - 1]));
  };
  const handleNextGroup = () => {
    if (selectedIndex >= 0 && selectedIndex < groups.length - 1) {
      setSelectedKey(getGroupKey(groups[selectedIndex + 1]));
    }
  };

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">실행 기록 <span className="text-muted">({groups.length})</span></h2>
          <div className="flex items-center gap-2.5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="노드 · 데이터셋 · 질문 검색"
              className="h-8 w-56 text-xs"
            />
            <SegToggle value={filter} onChange={setFilter} options={RUN_TYPE_FILTERS} />
            <Button variant="secondary" size="sm" onClick={reload}>새로고침</Button>
          </div>
        </div>
        {delErr && (
          <div className="border-b border-line px-4 py-2.5">
            <ErrBox msg={delErr} />
          </div>
        )}
        <Table>
          <THead>
            <TR>
              <TH className="w-6 px-2" />
              {/* 대상과 데이터를 두 칸으로 나눠 둔다. 한 줄에 이어 붙이면 행마다
                  길이가 달라져, 같은 API 로 여러 번 돌린 기록이 세로로 안 맞는다. */}
              <TH className="w-14">#</TH>
              <TH>대상</TH><TH>데이터</TH><TH>유형</TH><TH>상태</TH><TH>엔진</TH>
              <SortTH k="avg" label="점수" sort={sort} onSort={toggleSort} />
              <SortTH k="created" label="생성일시" sort={sort} onSort={toggleSort} />
              <TH className="w-16" />
            </TR>
          </THead>
          <TBody>
            {paged.map((g) => {
              const key = getGroupKey(g);
              const isSelected = selectedKey === key;

              if (g.kind === 'single') {
                const r = g.run;
                const mean = runMean(r);
                const single = runTitleParts(r);
                return (
                  <TR
                    key={key}
                    className={cn('cursor-pointer transition-colors hover:bg-surface-2/70', isSelected && 'bg-surface-3 hover:bg-surface-3')}
                    onClick={() => { if (!hasTextSelection()) setSelectedKey(isSelected ? null : key); }}
                  >
                    <TD className="px-2 text-center text-muted">
                      <span className={cn('text-xs font-bold transition-transform inline-block', isSelected ? 'text-ink translate-x-0.5' : 'opacity-40')}>
                        ›
                      </span>
                    </TD>
                    <RunIdCell ids={String(r.ragas_run_id)} />
                    <TargetCell
                      api={single.api}
                      apiHint={single.apiHint}
                      change={single.change}
                      changeHint={runModelDetail(r.model_snapshot)}
                    />
                    <ScopeCell text={single.scope} count={single.count} />
                    <TD><TypeText t="single" /></TD>
                    <TD><StatusText s={r.status} /></TD>
                    <TD className="text-xs text-muted">{r.engine === 'direct' ? '—' : (r.engine ?? '—')}</TD>
                    <AvgCell
                      mean={mean}
                      ex={r.exact_match != null ? Number(r.exact_match) : null}
                      unscored={single.unscored}
                    />
                    <TD className="whitespace-nowrap text-xs text-muted" title={r.created_dt}>{fmtDt(r.created_dt)}</TD>
                    <RowActionsCell
                      csvHref={`${API_BASE}/ragas-runs/${r.ragas_run_id}/export?fmt=csv`}
                      onDelete={() => del(r.ragas_run_id)}
                    />
                  </TR>
                );
              }

              const stat = g.a.status === g.b.status ? g.a.status : `${g.a.status}/${g.b.status}`;
              const pair = runTitleParts(g.a, g.b);
              return (
                <TR
                  key={key}
                  className={cn('cursor-pointer transition-colors hover:bg-surface-2/70', isSelected && 'bg-surface-3 hover:bg-surface-3')}
                  onClick={() => { if (!hasTextSelection()) setSelectedKey(isSelected ? null : key); }}
                >
                  <TD className="px-2 text-center text-muted">
                    <span className={cn('text-xs font-bold transition-transform inline-block', isSelected ? 'text-ink translate-x-0.5' : 'opacity-40')}>
                      ›
                    </span>
                  </TD>
                  <RunIdCell ids={`${g.a.ragas_run_id}/${g.b.ragas_run_id}`} />
                  {/* Single 행과 같은 규칙. A/B 는 두 사이드가 갈린 값만 화살표로
                      적혀서, 무엇과 무엇을 견준 것인지가 그 자리에서 읽힌다. */}
                  <TargetCell
                    api={pair.api}
                    apiHint={pair.apiHint}
                    change={pair.change}
                    changeHint={pair.changeHint}
                  />
                  <ScopeCell text={pair.scope} count={pair.count} />
                  <TD><TypeText t="compare" /></TD>
                  <TD><StatusText s={stat} /></TD>
                  <TD className="text-xs text-muted">{g.b.engine ?? '—'}</TD>
                  <AvgCell
                    meanA={runMean(g.a)}
                    meanB={runMean(g.b)}
                    exA={g.a.exact_match != null ? Number(g.a.exact_match) : null}
                    exB={g.b.exact_match != null ? Number(g.b.exact_match) : null}
                    unscored={pair.unscored}
                  />
                  <TD className="whitespace-nowrap text-xs text-muted" title={g.a.created_dt}>{fmtDt(g.a.created_dt)}</TD>
                  <RowActionsCell
                    csvHref={`${API_BASE}/ragas-runs/ab/${g.groupId}/export?fmt=csv`}
                    onDelete={() => delPair([g.a.ragas_run_id, g.b.ragas_run_id], g.groupId)}
                  />
                </TR>
              );
            })}
            {groups.length === 0 && (
              <TR><TD colSpan={10} className="py-10 text-center text-sm text-muted">
                {ragas.length === 0 ? '실행 기록이 없습니다' : '검색 결과 없음'}
              </TD></TR>
            )}
          </TBody>
        </Table>
        {groups.length > RUNS_PAGE_SIZE && (
          <RunsPager
            curPage={curPage}
            pageCount={pageCount}
            total={groups.length}
            onPage={setPage}
          />
        )}
      </Card>

      {/* Side Drawer for Master-Detail View */}
      {selectedGroup && (
        <RecordDetailDrawer
          group={selectedGroup}
          onClose={() => setSelectedKey(null)}
          onPrev={selectedIndex > 0 ? handlePrevGroup : undefined}
          onNext={selectedIndex < groups.length - 1 ? handleNextGroup : undefined}
          onDelete={() => {
            if (selectedGroup.kind === 'single') del(selectedGroup.run.ragas_run_id);
            else delPair([selectedGroup.a.ragas_run_id, selectedGroup.b.ragas_run_id], selectedGroup.groupId);
          }}
        />
      )}
    </>
  );
}

/**
 * 서랍 폭. 읽고 싶은 너비는 사람마다, 그리고 무엇을 펼쳤느냐에 따라 다르다 —
 * 질문 다섯 줄짜리 단일 실행과 네 칸짜리 A/B 판정표가 필요로 하는 자리는 아예
 * 다르다. 끌어서 맞춘 폭은 이 브라우저에 남아 다음 상세보기에도 그대로 열린다.
 */
const DRAWER_W_KEY = 'ptx.records.drawerWidth';
const DRAWER_MIN_W = 520;
/** 왼쪽에 목록이 한 뼘은 남아야 '서랍'이다 — 화면을 통째로 덮지는 않는다. */
const drawerMaxW = () => Math.max(DRAWER_MIN_W, window.innerWidth - 120);
const clampDrawerW = (w: number) => Math.min(Math.max(w, DRAWER_MIN_W), drawerMaxW());
/** 아무것도 고르지 않았을 때의 폭(= max-w-5xl). 키보드로 줄일 때의 출발점. */
const defaultDrawerW = () => Math.min(1024, window.innerWidth);

function useDrawerWidth() {
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  // 저장된 폭은 첫 페인트 뒤에 읽는다 — 서버가 그릴 때는 없는 값이라, 처음부터
  // 쓰면 서버와 클라이언트가 서로 다른 마크업을 그린다.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(DRAWER_W_KEY));
      if (Number.isFinite(saved) && saved > 0) setWidth(clampDrawerW(saved));
    } catch {
      // 저장소를 막아 둔 브라우저 — 기본 폭으로 연다.
    }
  }, []);

  // 창이 줄면 서랍도 따라 줄어야 한다.
  useEffect(() => {
    const onResize = () => setWidth((w) => (w == null ? w : clampDrawerW(w)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const apply = useCallback((w: number) => {
    const next = clampDrawerW(w);
    setWidth(next);
    try { window.localStorage.setItem(DRAWER_W_KEY, String(Math.round(next))); } catch { /* 무시 */ }
  }, []);

  const reset = useCallback(() => {
    setWidth(null);
    try { window.localStorage.removeItem(DRAWER_W_KEY); } catch { /* 무시 */ }
  }, []);

  const handleProps = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      // 포인터를 손잡이에 묶어 둔다 — 빠르게 끌다 손잡이 밖으로 나가도 계속 따라온다.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      apply(window.innerWidth - e.clientX);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      setDragging(false);
    },
    onDoubleClick: reset,
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // 손잡이가 포커스를 받는 까닭 — 마우스로만 조절되는 크롬은 없느니만 못하다.
      const step = e.shiftKey ? 96 : 24;
      const cur = width ?? defaultDrawerW();
      if (e.key === 'ArrowLeft') { e.preventDefault(); apply(cur + step); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); apply(cur - step); }
      else if (e.key === 'Home' || e.key === 'Backspace') { e.preventDefault(); reset(); }
    },
  };

  return { width, dragging, handleProps };
}

/** 서랍 왼쪽 모서리의 손잡이. 평소에는 보이지 않다가 가져다 대면 파란 선이 서고,
 * 끄는 동안에는 켜진 채로 남는다. 더블클릭은 기본 폭으로 되돌린다. */
function DrawerResizer({
  dragging, ...rest
}: { dragging: boolean } & ComponentProps<'div'>) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="상세 패널 너비 조절"
      title="끌어서 너비 조절 · 더블클릭하면 기본 너비"
      tabIndex={0}
      {...rest}
      className={cn(
        'group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors',
        dragging ? 'after:bg-accent' : 'after:bg-transparent hover:after:bg-accent',
        'focus-visible:outline-none focus-visible:after:bg-accent',
      )}
    />
  );
}

/** Side Drawer Component for viewing Run Details without nested table expansion */
function RecordDetailDrawer({
  group,
  onClose,
  onPrev,
  onNext,
  onDelete,
}: {
  group: RunGroup;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDelete: () => void;
}) {
  const isSingle = group.kind === 'single';
  const csvHref = isSingle
    ? `${API_BASE}/ragas-runs/${group.run.ragas_run_id}/export?fmt=csv`
    : `${API_BASE}/ragas-runs/ab/${group.groupId}/export?fmt=csv`;

  const { width, dragging, handleProps } = useDrawerWidth();

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[rgba(17,24,39,0.5)] transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer Content */}
      <aside
        className={cn(
          'relative z-10 flex h-full w-full flex-col border-l border-line bg-surface shadow-modal',
          width == null && 'max-w-5xl',
          // 끄는 동안에는 열리는 애니메이션이 매 프레임 다시 걸리지 않게 둔다.
          !dragging && 'animate-in slide-in-from-right duration-200',
        )}
        style={width == null ? undefined : { width, maxWidth: '100vw' }}
      >
        <DrawerResizer {...handleProps} dragging={dragging} />
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-display-xs text-ink">
              {isSingle ? (
                <>Single <span className="font-mono text-xs font-normal text-muted">#{group.run.ragas_run_id}</span></>
              ) : (
                <>Compare <span className="font-mono text-xs font-normal text-muted">#{group.a.ragas_run_id}/#{group.b.ragas_run_id}</span></>
              )}
            </h2>
            <TypeText t={isSingle ? 'single' : 'compare'} />
            <StatusText s={isSingle ? group.run.status : (group.a.status === group.b.status ? group.a.status : `${group.a.status}/${group.b.status}`)} />
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Navigation */}
            <div className="mr-2 flex items-center rounded-md border border-line bg-surface-2 p-0.5">
              <button
                type="button"
                disabled={!onPrev}
                onClick={onPrev}
                className="rounded-sm px-2 py-1 text-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                title="이전 기록"
              >
                ‹ 이전
              </button>
              <button
                type="button"
                disabled={!onNext}
                onClick={onNext}
                className="rounded-sm px-2 py-1 text-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                title="다음 기록"
              >
                다음 ›
              </button>
            </div>

            <a
              href={csvHref}
              title="CSV 내보내기"
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink transition-colors"
            >
              <DownloadIcon /> CSV
            </a>
            <button
              type="button"
              title="삭제"
              onClick={onDelete}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-bad-line bg-bad-soft px-3 text-xs font-medium text-bad hover:bg-bad-soft2 transition-colors"
            >
              <TrashIcon /> 삭제
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-ink transition-colors"
              aria-label="닫기 (Esc)"
              title="닫기 (Esc)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isSingle ? (
            <RagasRunDetailView ragasId={group.run.ragas_run_id} />
          ) : (
            <AbCompareView aId={group.a.ragas_run_id} bId={group.b.ragas_run_id} />
          )}
        </div>
      </aside>
    </div>
  );
}

/** Centered prev/next pager under the runs table. */
function RunsPager({
  curPage, pageCount, total, onPage,
}: {
  curPage: number; pageCount: number; total: number; onPage: (f: (p: number) => number) => void;
}) {
  const btn =
    'rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors ' +
    'hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40';
  const from = curPage * RUNS_PAGE_SIZE + 1;
  const to = Math.min(total, from + RUNS_PAGE_SIZE - 1);
  return (
    <div className="flex items-center justify-center gap-3.5 border-t border-line px-4 py-3">
      <button type="button" disabled={curPage === 0} onClick={() => onPage((p) => Math.max(0, p - 1))} className={btn}>
        ‹ 이전
      </button>
      <span className="font-mono text-xs font-semibold tabular-nums text-muted">
        {curPage + 1} / {pageCount}
        <span className="font-normal text-muted-soft"> · {from}–{to} / {total}</span>
      </span>
      <button
        type="button"
        disabled={curPage >= pageCount - 1}
        onClick={() => onPage((p) => Math.min(pageCount - 1, p + 1))}
        className={btn}
      >
        다음 ›
      </button>
    </div>
  );
}

function AbCompareView({ aId, bId }: { aId: number; bId: number }) {
  const [a, setA] = useState<RagasRunDetail | null>(null);
  const [b, setB] = useState<RagasRunDetail | null>(null);
  useEffect(() => {
    api.get<RagasRunDetail>(`/ragas-runs/${aId}`).then(setA).catch(() => setA(null));
    api.get<RagasRunDetail>(`/ragas-runs/${bId}`).then(setB).catch(() => setB(null));
  }, [aId, bId]);
  if (!a || !b) return <div className="p-4 text-xs text-muted">불러오는 중…</div>;
  return (
    <div className="space-y-4">
      <CompareSummaryDashboard detailA={a} detailB={b} />
      {/* 케이스를 하나씩 펼쳐 A·B 를 견주기 전에, 데이터셋 전체에서 어느 키가 두
          버전을 갈랐는지부터. 갈린 키가 없으면 서지 않는다. */}
      <AbKeyBreakdown aRows={a.results} bRows={b.results} nameA={compareSideLabel(a)} nameB={compareSideLabel(b)} />
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
          <h3 className="mr-1 text-sm font-semibold text-ink">Compare Detail</h3>
          {a.node_nm && <span className="font-medium text-ink">{a.node_nm}</span>}
          <Badge tone="neutral">A · {compareSideLabel(a)}</Badge>
          <span>vs</span>
          <Badge tone="accent">B · {compareSideLabel(b)}</Badge>
          <span className="ml-auto flex items-center gap-2">
            <ModelStamp text={formatModelPair(a.model_snapshot, b.model_snapshot)} />
            <span>Engine {a.engine ?? '—'}</span>
          </span>
        </div>
        <div className="p-4">
          <CaseCompareTable detailA={a} detailB={b} defaultAllOpen={false} />
        </div>
      </div>
    </div>
  );
}

function parseContexts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : [String(v)];
  } catch {
    return [raw];
  }
}

/** A run's cases as rows for the import grid. The 정답 column takes what the run
 * actually produced — the captured variable when one was judged, since that is
 * what 정답 일치 compares — so a good run becomes its own expected answers. */
function rowsFromRun(d: RagasRunDetail): Fields[] {
  return d.results
    .filter((r) => (r.question ?? '').trim())
    .map((r) => ({
      question: (r.question ?? '').trim(),
      contexts: parseContexts(r.contexts).join('\n'),
      groundTruth: (r.trace_value ?? r.answer ?? '').trim(),
      category: '',
    }));
}

function RagasRunDetailView({ ragasId }: { ragasId: number }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => { setAdded(null); api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`).then(setDetail).catch(() => setDetail(null)); }, [ragasId]);
  if (!detail) return <div className="p-4 text-xs text-muted">불러오는 중…</div>;

  const verLabel = detail.version_no != null ? `v${detail.version_no}` : (detail.prompt_id ? `ID ${detail.prompt_id}` : runTargetLabel(detail));
  const seed = rowsFromRun(detail);

  return (
    <div className="space-y-4">
      {scoredMetrics(detail).length > 0 && <SingleRunSummaryDashboard detail={detail} />}
      <KeyBreakdown rows={detail.results} />
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
          <h3 className="mr-1 text-sm font-semibold text-ink">Single Detail</h3>
          <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'} dot>{detail.status}</Badge>
          {detail.node_nm && <span className="font-medium text-ink">{detail.node_nm}</span>}
          <Badge tone="neutral">{verLabel}</Badge>
          {/* 폴더가 붙어 있으면 이 실행의 모수는 데이터셋 전체가 아니다.
              그걸 모르고 다른 실행과 점수를 나란히 놓으면 비교가 어긋난다. */}
          {detail.case_type && <Badge tone="neutral">폴더 {folderLabel(detail.case_type)}</Badge>}
          {/* 목록은 이름(또는 host)까지만 적는다 — 전체 주소가 필요한 자리는 여기다. */}
          {(detail.endpoint_nm || detail.endpoint_url) && (
            <Badge tone="neutral">
              <span title={detail.endpoint_url ?? undefined}>
                API {detail.endpoint_nm ?? detail.endpoint_url}
              </span>
            </Badge>
          )}
          <span className="ml-auto flex items-center gap-2">
            <ModelStamp text={formatModelSnapshot(detail.model_snapshot)} />
            <span>Engine {detail.engine ?? '—'}</span>
            <span>·</span>
            <span>{detail.results.length} case{detail.results.length === 1 ? '' : 's'}</span>
            <Button variant="secondary" size="sm" className="ml-1" disabled={seed.length === 0} onClick={() => setAdding(true)}>
              데이터셋에 추가
            </Button>
          </span>
        </div>
        {added && (
          <div className="flex items-center gap-2 border-b border-line bg-surface-2/50 px-4 py-2 text-xs text-muted">
            <span className="min-w-0 flex-1 truncate">{added}</span>
            <button type="button" className="shrink-0 hover:text-ink" onClick={() => setAdded(null)}>닫기</button>
          </div>
        )}
        <div className="p-4">
          <CaseTable detail={detail} defaultAllOpen={false} />
        </div>
      </div>
      {adding && (
        <CaseImportModal
          title="데이터셋에 추가"
          initialRows={seed}
          onClose={() => setAdding(false)}
          onSaved={(res, t) =>
            setAdded(
              `${t.name} 에 ${res.created}건 추가` +
              (res.folders_created.length ? ` · 새 폴더 ${res.folders_created.join(', ')}` : ''),
            )
          }
        />
      )}
    </div>
  );
}
