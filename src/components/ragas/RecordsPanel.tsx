'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { RagasRunDetail, RagasRunSummary } from '@/lib/types';
import { CaseCompareTable } from './CompareTable';
import { CaseTable, fmt2, fmt3, fmtDt, runMean, SegToggle } from './shared';

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

const RUNS_PAGE_SIZE = 20; // rows per Records page — same as inview's question table

/** Status pill = inview .pill: tinted rounded background + dot + text.
 * FAILED red (wins in mixed pair states like DONE/FAILED), DONE green,
 * everything else (RUNNING/CANCELLED…) muted. */
function StatusText({ s }: { s: string }) {
  const tone = s.includes('FAILED') ? 'bad' : s.includes('DONE') ? 'ok' : 'neutral';
  return <Badge tone={tone} dot>{s}</Badge>;
}

/** Run-type label — plain colored text (badges read too heavy at this density):
 * Single blue, Compare purple (= inview node/model chip colors). */
function TypeText({ t }: { t: Exclude<RunTypeFilter, 'all'> }) {
  return (
    <span className={cn('text-xs font-semibold', t === 'compare' ? 'text-[#7c3aed]' : 'text-accent')}>
      {t === 'compare' ? 'Compare' : 'Single'}
    </span>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.5v7m0 0L5.25 6.75M8 9.5l2.75-2.75M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.75 4.25h10.5M6.5 2.5h3M5.5 4.5l.4 8a1 1 0 0 0 1 .95h2.2a1 1 0 0 0 1-.95l.4-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Per-row actions: quiet icon-only ghost buttons (inview .btn idiom at table
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

/** Sortable column header = inview .qth-sort: sortable columns always show a
 * faint ↕ affordance; the active sort darkens to ink with a solid ▲/▼. */
function SortTH({
  k, label, sort, onSort, className, title,
}: {
  k: RunSortKey; label: string;
  sort: { key: RunSortKey; dir: 'asc' | 'desc' };
  onSort: (k: RunSortKey) => void;
  className?: string; title?: string;
}) {
  const active = sort.key === k;
  return (
    <TH className={cn('whitespace-nowrap', className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        title={title}
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

/** Score cell: a small 0..1 track bar beside the value — same visual language
 * as the detail views' MetricBar, without overlapping the number. */
function AvgCell({ mean }: { mean: number | null }) {
  return (
    <TD className="font-mono text-xs font-semibold tabular-nums text-ink">
      <div className="flex items-center gap-2">
        {mean != null && (
          <span aria-hidden className="relative h-1.5 w-10 overflow-hidden rounded-full bg-bg">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              style={{ width: `${Math.max(0, Math.min(1, mean)) * 100}%` }}
            />
          </span>
        )}
        <span>{fmt2(mean)}</span>
      </div>
    </TD>
  );
}

export default function RecordsPanel() {
  const [ragas, setRagas] = useState<RagasRunSummary[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<RunTypeFilter>('all');
  const [sort, setSort] = useState<{ key: RunSortKey; dir: 'asc' | 'desc' }>({ key: 'created', dir: 'desc' });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filter, sort, query]);
  const reload = useCallback(() => {
    api.get<RagasRunSummary[]>('/ragas-runs').then(setRagas).catch(() => setRagas([]));
  }, []);
  useEffect(reload, [reload]);
  async function del(id: number) { await api.del(`/ragas-runs/${id}`); if (open === id) setOpen(null); reload(); }
  async function delPair(ids: number[]) { await Promise.all(ids.map((i) => api.del(`/ragas-runs/${i}`))); setOpen(null); reload(); }
  const toggleSort = (key: RunSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  // The avg sort reads the pair's B side (the Avg cell shows B); the created
  // sort uses the run id, which is monotonic with creation time.
  const sortVal = (g: RunGroup): number | null => {
    if (sort.key === 'created') return g.kind === 'single' ? g.run.ragas_run_id : g.a.ragas_run_id;
    return runMean(g.kind === 'single' ? g.run : g.b);
  };
  // Free-text search over what identifies a run: node/version, dataset,
  // (first) question — which is the message for direct calls — and run id.
  const q = query.trim().toLowerCase();
  const matches = (g: RunGroup): boolean => {
    if (!q) return true;
    const rs = g.kind === 'single' ? [g.run] : [g.a, g.b];
    return rs.some((r) =>
      [r.node_nm, r.version_no != null ? `v${r.version_no}` : null, r.dataset_nm, r.first_question, `#${r.ragas_run_id}`]
        .some((v) => v != null && v.toLowerCase().includes(q)),
    );
  };
  const groups = groupRuns(ragas)
    .filter((g) => (filter === 'all' || groupType(g) === filter) && matches(g))
    .sort((x, y) => {
      const vx = sortVal(x); const vy = sortVal(y);
      if (vx == null && vy == null) return 0;
      if (vx == null) return 1; // unscored rows sink to the bottom either way
      if (vy == null) return -1;
      return sort.dir === 'asc' ? vx - vy : vy - vx;
    });
  const pageCount = Math.max(1, Math.ceil(groups.length / RUNS_PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1); // clamp after deletes shrink the list
  const paged = groups.slice(curPage * RUNS_PAGE_SIZE, curPage * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE);
  // Columns: expand, Run, Type, Status, Dataset, Engine, Avg, Created, actions.
  // Per-metric scores live in the expanded Details view, not the list.
  const cols = 9;

  return (
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
            <TH className="w-7 px-2" />
            <TH>실행</TH><TH>유형</TH><TH>상태</TH><TH>데이터셋</TH><TH>엔진</TH>
            <SortTH k="avg" label="평균" sort={sort} onSort={toggleSort} title="채점된 지표들의 평균" />
            <SortTH k="created" label="생성일시" sort={sort} onSort={toggleSort} />
            <TH />
          </TR>
        </THead>
        <TBody>
          {paged.map((g) => {
            if (g.kind === 'single') {
              const r = g.run;
              const isOpen = open === r.ragas_run_id;
              const mean = runMean(r);
              return (
                <Fragment key={`r${r.ragas_run_id}`}>
                  {/* An open row keeps the hover surface (= inview .qrow.open) so it reads as
                      one block with the detail panel below. */}
                  <TR
                    className={cn('cursor-pointer', isOpen && 'bg-surface-2')}
                    onClick={() => setOpen(isOpen ? null : r.ragas_run_id)}
                  >
                    <TD className="px-2 text-center text-muted">{isOpen ? '▾' : '▸'}</TD>
                    <TD>
                      {/* Manual runs have no node/version identity — the sent message is the run's name. */}
                      {r.is_manual ? (
                        <div className="max-w-[18rem] truncate text-sm text-ink" title={r.first_question ?? undefined}>
                          {r.first_question ?? '—'}
                        </div>
                      ) : (
                        <div className="whitespace-nowrap text-sm text-ink">
                          {r.node_nm
                            ? <>{r.node_nm} <span className="text-muted">· v{r.version_no ?? '—'}</span></>
                            : 'As-is'}
                        </div>
                      )}
                      <div className="font-mono text-[11px] text-muted">#{r.ragas_run_id}</div>
                    </TD>
                    <TD><TypeText t="single" /></TD>
                    <TD><StatusText s={r.status} /></TD>
                    {/* Manual runs log into the hidden sink dataset — not meaningful, show a dash. */}
                    <TD className="text-xs text-muted" title={r.is_manual ? undefined : r.dataset_nm ?? undefined}>
                      <div className="max-w-[11rem] truncate">{r.is_manual ? '—' : (r.dataset_nm ?? '—')}</div>
                    </TD>
                    <TD className="text-xs text-muted">{r.engine === 'direct' ? '—' : (r.engine ?? '—')}</TD>
                    <AvgCell mean={mean} />
                    <TD className="whitespace-nowrap text-xs text-muted" title={r.created_dt}>{fmtDt(r.created_dt)}</TD>
                    <RowActionsCell
                      csvHref={`${API_BASE}/ragas-runs/${r.ragas_run_id}/export?fmt=csv`}
                      onDelete={() => del(r.ragas_run_id)}
                    />
                  </TR>
                  {r.error_msg && <TR><TD colSpan={cols} className="bg-bad/5 text-xs text-bad">⚠ {r.error_msg}</TD></TR>}
                  {isOpen && (
                    <TR><TD colSpan={cols} className="bg-surface-2 p-3"><RagasRunDetailView ragasId={r.ragas_run_id} /></TD></TR>
                  )}
                </Fragment>
              );
            }
            // A/B pair → one row (metric cells show candidate B; expand shows A-vs-B delta)
            const open2 = open === g.groupId;
            const stat = g.a.status === g.b.status ? g.a.status : `${g.a.status}/${g.b.status}`;
            return (
              <Fragment key={`ab${g.groupId}`}>
                <TR className={cn('cursor-pointer', open2 && 'bg-surface-2')} onClick={() => setOpen(open2 ? null : g.groupId)}>
                  <TD className="px-2 text-center text-muted">{open2 ? '▾' : '▸'}</TD>
                  <TD>
                    <div className="whitespace-nowrap text-sm text-ink">
                      {g.a.node_nm ?? '—'} <span className="text-muted">· v{g.a.version_no ?? '—'}→v{g.b.version_no ?? '—'}</span>
                    </div>
                    <div className="font-mono text-[11px] text-muted">#{g.a.ragas_run_id}/#{g.b.ragas_run_id}</div>
                  </TD>
                  <TD><TypeText t="compare" /></TD>
                  <TD><StatusText s={stat} /></TD>
                  <TD className="text-xs text-muted" title={g.a.dataset_nm ?? undefined}>
                    <div className="max-w-[11rem] truncate">{g.a.dataset_nm ?? '—'}</div>
                  </TD>
                  <TD className="text-xs text-muted">{g.b.engine ?? '—'}</TD>
                  <AvgCell mean={runMean(g.b)} />
                  <TD className="whitespace-nowrap text-xs text-muted" title={g.a.created_dt}>{fmtDt(g.a.created_dt)}</TD>
                  <RowActionsCell
                    csvHref={`${API_BASE}/ragas-runs/ab/${g.groupId}/export?fmt=csv`}
                    onDelete={() => delPair([g.a.ragas_run_id, g.b.ragas_run_id])}
                  />
                </TR>
                {open2 && (
                  <TR><TD colSpan={cols} className="bg-surface-2 p-3"><AbCompareView aId={g.a.ragas_run_id} bId={g.b.ragas_run_id} labelA={g.a.version_no ?? ''} labelB={g.b.version_no ?? ''} /></TD></TR>
                )}
              </Fragment>
            );
          })}
          {groups.length === 0 && (
            <TR><TD colSpan={cols} className="py-10 text-center text-sm text-muted">
              {ragas.length === 0 ? '아직 평가 실행 기록이 없습니다.' : '검색 · 필터 조건에 맞는 기록이 없습니다.'}
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
  );
}

/** Centered prev/next pager under the runs table = inview .qpager. */
function RunsPager({
  curPage, pageCount, total, onPage,
}: {
  curPage: number; pageCount: number; total: number; onPage: (f: (p: number) => number) => void;
}) {
  const btn =
    'rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors ' +
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
  if (!a || !b) return <div className="text-xs text-muted">불러오는 중…</div>;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-sm border border-line bg-surface">
        <CaseCompareTable detailA={a} detailB={b} labelA={labelA} labelB={labelB} />
      </div>
      {(a.status === 'CANCELLED' || b.status === 'CANCELLED') && (
        <p className="text-xs text-muted">취소된 실행 — 답변만 저장되고 점수는 없습니다.</p>
      )}
    </div>
  );
}

function RagasRunDetailView({ ragasId }: { ragasId: number }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  useEffect(() => { api.get<RagasRunDetail>(`/ragas-runs/${ragasId}`).then(setDetail).catch(() => setDetail(null)); }, [ragasId]);
  if (!detail) return <div className="text-xs text-muted">불러오는 중…</div>;
  return <CaseTable detail={detail} bordered />;
}
