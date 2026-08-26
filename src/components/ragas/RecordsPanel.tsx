'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatModelPair, formatModelSnapshot } from '@/lib/modelSnapshot';
import type { RagasRunDetail, RagasRunSummary } from '@/lib/types';
import { CaseCompareTable } from './CompareTable';
import { CompareSummaryDashboard, SingleRunSummaryDashboard } from './RunSummaryDashboard';
import {
  CaseTable, DownloadIcon, fmt2, fmt3, fmtDt, runMean, runTargetLabel, runTargetTitle, scoredMetrics, SegToggle,
  sideLabel, TrashIcon,
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
/** TYPE_CD 의 컬럼 기본값은 '폴더 없음' 을 뜻한다 — 화면에서는 그렇게 읽힌다. */
function catLabel(t: string): string {
  return t === 'NORMAL' ? '폴더 없음' : t;
}

/** 데이터셋 이름, 그리고 이 실행이 좁힌 폴더. 폴더가 없으면 이름만 — 전체를
 * 돌린 실행이다. 이 두 줄이 붙어 있어야 기록에서 모수가 다른 실행끼리
 * 점수를 잘못 나란히 놓는 일이 없다. */
function datasetLabel(r: RagasRunSummary): string {
  // 직접 실행의 데이터셋은 화면에 없는 sink 다 — 이름 대신 무엇으로 돌렸는지를
  // 적는다. 그래야 제목은 대상만 말하고, 입력 종류는 이 칸이 답한다.
  if (r.is_manual) return '직접 입력';
  const nm = r.dataset_nm ?? '—';
  return r.case_type ? `${nm} · ${catLabel(r.case_type)}` : nm;
}

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

/** Second line of the 실행 cell: the run id(s), then a glimpse of what went in.
 * The first case's question is the cheapest thing that tells two runs of the same
 * version apart at a glance, and it already rides along in the list payload.
 * 직접 실행의 질문도 여기 실린다 — 제목 줄은 대상만 말하기로 했으므로, 그
 * 실행을 알아보게 하는 문장은 이 줄이 유일하게 담는 곳이다. */
function RunSubline({
  ids,
  question,
  modelText,
}: {
  ids: string;
  question?: string | null;
  // The models this run went out under, already formatted (a pair for A/B, one
  // snapshot for a single). Without it two runs of the same dataset and version
  // look identical even when the model differed — which is the whole comparison.
  modelText?: string | null;
}) {
  const q = question?.trim();
  const m = modelText;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline gap-1.5 font-mono text-[11px] text-muted">
        <span className="shrink-0">{ids}</span>
        {q && <span className="truncate font-sans text-muted/75" title={q}>· {q}</span>}
      </div>
      {m && (
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted/75" title={m}>
          {m}
        </div>
      )}
    </div>
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
        <button type="button" title="삭제" onClick={onDelete} className={cn(base, 'hover:bg-bad/10 hover:text-bad')}>
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

/** Score cell — the RAGAS mean and the 정답 일치 rate on separate lines, because
 * a graded mean and a pass rate are different claims about the run. Compare runs
 * show A/B on each line. Either line is omitted when that scorer never ran. */
function AvgCell({
  mean, meanA, meanB, ex, exA, exB,
}: {
  mean?: number | null; meanA?: number | null; meanB?: number | null;
  ex?: number | null; exA?: number | null; exB?: number | null;
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
                <span className="text-muted/60">·</span>
                <span className="text-muted font-normal">B <span className="font-semibold text-ink">{fmt2(meanB)}</span></span>
              </div>
              {delta != null && (
                <span
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border',
                    delta > 0
                      ? 'border-ok/25 bg-ok/[0.07] text-ok'
                      : delta < 0
                      ? 'border-bad/25 bg-bad/[0.07] text-bad'
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
              <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px] text-muted">일치</span>
              <span className="text-muted font-normal">A <span className="font-semibold text-ink">{pct(exA)}</span></span>
              <span className="text-muted/60">·</span>
              <span className="text-muted font-normal">B <span className="font-semibold text-ink">{pct(exB)}</span></span>
            </div>
          )}
          {meanA == null && meanB == null && exA == null && exB == null && <span className="text-muted">—</span>}
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
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.6px] text-muted">일치 </span>
            <span className="font-semibold">{pct(ex)}</span>
          </span>
        )}
        {mean == null && ex == null && <span className="text-muted">—</span>}
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

  async function del(id: number) {
    await api.del(`/ragas-runs/${id}`);
    if (selectedKey === `s_${id}`) setSelectedKey(null);
    reload();
  }
  async function delPair(ids: number[], groupId: number) {
    await Promise.all(ids.map((i) => api.del(`/ragas-runs/${i}`)));
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
        // 화면에 적힌 그대로 — 'Default', 'Model · qwen3', '직접 입력'.
        runTargetTitle(r),
        datasetLabel(r),
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
      if (e.key === 'Escape') setSelectedKey(null);
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
        <Table>
          <THead>
            <TR>
              <TH className="w-6 px-2" />
              <TH>실행</TH><TH>유형</TH><TH>상태</TH><TH>데이터셋</TH><TH>엔진</TH>
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
                return (
                  <TR
                    key={key}
                    className={cn('cursor-pointer transition-colors hover:bg-surface-2/70', isSelected && 'bg-surface-3 hover:bg-surface-3')}
                    onClick={() => setSelectedKey(isSelected ? null : key)}
                  >
                    <TD className="px-2 text-center text-muted">
                      <span className={cn('text-xs font-bold transition-transform inline-block', isSelected ? 'text-ink translate-x-0.5' : 'opacity-40')}>
                        ›
                      </span>
                    </TD>
                    <TD className="max-w-[20rem]">
                      {/* 제목은 예외 없이 '무엇을 시험했나' 하나만 말한다. 노드가
                          없으면 버전을 바꾸지 않은 실행이고, 그때도 대상은 있다.
                          어떤 질문이었는지는 아래 서브라인이 받는다 — 직접 실행만
                          질문을 제목에 올리면 목록의 규칙이 행마다 달라진다. */}
                      <div className="truncate text-sm font-medium text-ink">
                        {r.node_nm
                          ? <>{r.node_nm} <span className="text-muted font-normal">· v{r.version_no ?? '—'}</span></>
                          : runTargetTitle(r)}
                      </div>
                      <RunSubline
                        ids={`#${r.ragas_run_id}`}
                        question={r.first_question}
                        modelText={formatModelSnapshot(r.model_snapshot)}
                      />
                    </TD>
                    <TD><TypeText t="single" /></TD>
                    <TD><StatusText s={r.status} /></TD>
                    <TD className="text-xs text-muted" title={datasetLabel(r)}>
                      <div className="max-w-[11rem] truncate">{datasetLabel(r)}</div>
                    </TD>
                    <TD className="text-xs text-muted">{r.engine === 'direct' ? '—' : (r.engine ?? '—')}</TD>
                    <AvgCell mean={mean} ex={r.exact_match != null ? Number(r.exact_match) : null} />
                    <TD className="whitespace-nowrap text-xs text-muted" title={r.created_dt}>{fmtDt(r.created_dt)}</TD>
                    <RowActionsCell
                      csvHref={`${API_BASE}/ragas-runs/${r.ragas_run_id}/export?fmt=csv`}
                      onDelete={() => del(r.ragas_run_id)}
                    />
                  </TR>
                );
              }

              const stat = g.a.status === g.b.status ? g.a.status : `${g.a.status}/${g.b.status}`;
              return (
                <TR
                  key={key}
                  className={cn('cursor-pointer transition-colors hover:bg-surface-2/70', isSelected && 'bg-surface-3 hover:bg-surface-3')}
                  onClick={() => setSelectedKey(isSelected ? null : key)}
                >
                  <TD className="px-2 text-center text-muted">
                    <span className={cn('text-xs font-bold transition-transform inline-block', isSelected ? 'text-ink translate-x-0.5' : 'opacity-40')}>
                      ›
                    </span>
                  </TD>
                  <TD className="max-w-[20rem]">
                    {/* Single 행과 같은 규칙: 제목은 대상, 질문은 서브라인. */}
                    <div className="truncate text-sm font-medium text-ink">
                      {g.a.node_nm
                        ? <>{g.a.node_nm} <span className="text-muted font-normal">· v{g.a.version_no ?? '—'} vs v{g.b.version_no ?? '—'}</span></>
                        : <>{runTargetTitle(g.a)} <span className="text-muted font-normal">· A vs B</span></>}
                    </div>
                    <RunSubline
                      ids={`#${g.a.ragas_run_id}/#${g.b.ragas_run_id}`}
                      question={g.a.first_question}
                      modelText={formatModelPair(g.a.model_snapshot, g.b.model_snapshot)}
                    />
                  </TD>
                  <TD><TypeText t="compare" /></TD>
                  <TD><StatusText s={stat} /></TD>
                  <TD className="text-xs text-muted" title={datasetLabel(g.a)}>
                    <div className="max-w-[11rem] truncate">{datasetLabel(g.a)}</div>
                  </TD>
                  <TD className="text-xs text-muted">{g.b.engine ?? '—'}</TD>
                  <AvgCell
                    meanA={runMean(g.a)}
                    meanB={runMean(g.b)}
                    exA={g.a.exact_match != null ? Number(g.a.exact_match) : null}
                    exB={g.b.exact_match != null ? Number(g.b.exact_match) : null}
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
              <TR><TD colSpan={9} className="py-10 text-center text-sm text-muted">
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/50 transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer Content */}
      <aside className="relative z-10 flex h-full w-full max-w-5xl flex-col border-l border-line bg-surface shadow-modal animate-in slide-in-from-right duration-200">
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
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-bad/20 bg-bad/5 px-3 text-xs font-medium text-bad hover:bg-bad/10 transition-colors"
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
            <AbCompareView
              aId={group.a.ragas_run_id}
              bId={group.b.ragas_run_id}
              labelA={group.a.version_no != null ? String(group.a.version_no) : ''}
              labelB={group.b.version_no != null ? String(group.b.version_no) : ''}
            />
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
        <span className="font-normal text-muted/60"> · {from}–{to} / {total}</span>
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

function AbCompareView({ aId, bId, labelA, labelB }: { aId: number; bId: number; labelA: string; labelB: string }) {
  const [a, setA] = useState<RagasRunDetail | null>(null);
  const [b, setB] = useState<RagasRunDetail | null>(null);
  useEffect(() => {
    api.get<RagasRunDetail>(`/ragas-runs/${aId}`).then(setA).catch(() => setA(null));
    api.get<RagasRunDetail>(`/ragas-runs/${bId}`).then(setB).catch(() => setB(null));
  }, [aId, bId]);
  if (!a || !b) return <div className="p-4 text-xs text-muted">불러오는 중…</div>;
  return (
    <div className="space-y-4">
      <CompareSummaryDashboard detailA={a} detailB={b} labelA={labelA} labelB={labelB} />
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
          <h3 className="mr-1 text-sm font-semibold text-ink">Compare Detail</h3>
          {a.node_nm && <span className="font-medium text-ink">{a.node_nm}</span>}
          <Badge tone="neutral">A · {sideLabel(labelA)}</Badge>
          <span>vs</span>
          <Badge tone="accent">B · {sideLabel(labelB)}</Badge>
          <span className="ml-auto flex items-center gap-2">
            <ModelStamp text={formatModelPair(a.model_snapshot, b.model_snapshot)} />
            <span>Engine {a.engine ?? '—'}</span>
          </span>
        </div>
        <div className="p-4">
          <CaseCompareTable detailA={a} detailB={b} labelA={labelA} labelB={labelB} defaultAllOpen={false} />
        </div>
      </div>
    </div>
  );
}

function RagasRunDetailView({ ragasId }: { ragasId: number }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  useEffect(() => { api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`).then(setDetail).catch(() => setDetail(null)); }, [ragasId]);
  if (!detail) return <div className="p-4 text-xs text-muted">불러오는 중…</div>;

  const verLabel = detail.version_no != null ? `v${detail.version_no}` : (detail.prompt_id ? `ID ${detail.prompt_id}` : runTargetLabel(detail));

  return (
    <div className="space-y-4">
      {scoredMetrics(detail).length > 0 && <SingleRunSummaryDashboard detail={detail} />}
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
          <h3 className="mr-1 text-sm font-semibold text-ink">Single Detail</h3>
          <Badge tone={detail.status === 'FAILED' ? 'bad' : 'neutral'} dot>{detail.status}</Badge>
          {detail.node_nm && <span className="font-medium text-ink">{detail.node_nm}</span>}
          <Badge tone="neutral">{verLabel}</Badge>
          {/* 폴더가 붙어 있으면 이 실행의 모수는 데이터셋 전체가 아니다.
              그걸 모르고 다른 실행과 점수를 나란히 놓으면 비교가 어긋난다. */}
          {detail.case_type && <Badge tone="neutral">폴더 {catLabel(detail.case_type)}</Badge>}
          <span className="ml-auto flex items-center gap-2">
            <ModelStamp text={formatModelSnapshot(detail.model_snapshot)} />
            <span>Engine {detail.engine ?? '—'}</span>
            <span>·</span>
            <span>{detail.results.length} case{detail.results.length === 1 ? '' : 's'}</span>
          </span>
        </div>
        <div className="p-4">
          <CaseTable detail={detail} defaultAllOpen={false} />
        </div>
      </div>
    </div>
  );
}
