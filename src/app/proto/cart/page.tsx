'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import type {
  Dataset,
  RagasRunDetail,
  RagasRunSummary,
  TestCase,
} from '@/lib/types';
import { parseCaseInput } from '@/components/ragas/caseFields';
import {
  CaseTable,
  DatasetPurpose,
  errText,
  fmtDt,
  folderLabel,
  PendingHint,
  UNFILED,
  useEndpoints,
  useFlowDatasets,
} from '@/components/ragas/shared';
import { SingleRunSummaryDashboard } from '@/components/ragas/RunSummaryDashboard';

/**
 * 프로토타입 (O안) — 돌릴 것을 담아서 한 번에, 기록은 오른쪽에 상주.
 *
 * 임시 페이지다. `/proto/cart` 로만 열리고 사이드바에는 없다. 실제 화면은
 * 아무것도 건드리지 않으며, 고르고 담고 기록을 열어 보는 것까지가 전부다 —
 * 실행은 붙이지 않았다(아래 `plan` 참고: 왜 못 붙였는지를 화면이 직접 말한다).
 *
 * 쓰는 데이터는 전부 실제 API 다: /flow/datasets · /datasets/{id}/cases ·
 * /ragas-runs · /ragas-runs/{id}.
 *
 * 왼쪽은 두 모드를 가진다. 기본은 '고르기'(담을 것을 훑는 목록), 오른쪽 기록을
 * 누르면 '결과'(그 실행의 대시보드 + 케이스 표)로 바뀐다. 오른쪽 열은 접힌다 —
 * 결과를 볼 때 케이스 표에 폭을 돌려줘야 하기 때문이다.
 */

// ---- 담은 것 ---------------------------------------------------------------

type Kind = 'dataset' | 'folder' | 'case';

interface CartItem {
  /** 같은 것을 두 번 담지 않게 하는 열쇠. */
  key: string;
  kind: Kind;
  datasetId: number;
  datasetNm: string;
  label: string;
  /** 이 항목이 데리고 오는 케이스 수. */
  n: number;
}

const KIND_LABEL: Record<Kind, string> = { dataset: '데이터셋', folder: '폴더', case: '케이스' };

const KIND_TONE: Record<Kind, string> = {
  dataset: 'border-accent-line bg-accent-soft text-accent-deep',
  folder: 'border-line bg-surface-3 text-[#7c3aed]',
  case: 'border-line bg-surface-2 text-muted',
};

function KindChip({ kind }: { kind: Kind }) {
  return (
    <span
      className={cn(
        'inline-flex h-[19px] shrink-0 items-center rounded-xs border px-1.5 text-[10.5px] font-bold',
        KIND_TONE[kind],
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

/** 담기 단추. 이미 담은 것은 눌리지 않고 '담김'으로 남는다 — 사라지면 방금 누른
 * 줄이 무엇이었는지 흔적이 없다. */
function AddButton({ has, onAdd }: { has: boolean; onAdd: () => void }) {
  return (
    <button
      type="button"
      disabled={has}
      onClick={onAdd}
      className={cn(
        'h-7 shrink-0 rounded-sm border px-2.5 text-xs font-semibold transition-colors',
        has
          ? 'cursor-default border-line bg-surface-3 text-muted-soft'
          : 'border-line-strong bg-surface text-ink hover:bg-surface-3',
      )}
    >
      {has ? '담김' : '담기'}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn('shrink-0 text-muted-soft transition-transform', !open && '-rotate-90')}
    >
      <path d="M4 6.5 8 10.5l4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- 왼쪽: 고르기 ----------------------------------------------------------

/** 한 데이터셋을 펼치면 그 케이스를 한 번만 읽어 와 폴더로 묶는다. case-types 를
 * 따로 부르지 않는 건, 담을 수 있는 폴더는 케이스가 있는 폴더뿐이기 때문이다. */
function useCases(datasetId: number | null) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (datasetId == null) { setCases([]); return; }
    let alive = true;
    setLoading(true);
    api
      .get<TestCase[]>(`/datasets/${datasetId}/cases`)
      .then((rows) => { if (alive) setCases(rows); })
      .catch(() => { if (alive) setCases([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [datasetId]);
  return { cases, loading };
}

function BrowsePane({
  datasets, inCart, add,
}: {
  datasets: Dataset[];
  inCart: (key: string) => boolean;
  add: (it: CartItem) => void;
}) {
  const [q, setQ] = useState('');
  const [openDs, setOpenDs] = useState<number | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const { cases, loading } = useCases(openDs);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? datasets.filter((d) => d.dataset_nm.toLowerCase().includes(needle))
    : datasets;

  // 펼친 데이터셋의 케이스를 폴더로 묶는다. 폴더 없는 케이스도 한 묶음이다 —
  // 담을 수 없으면 그 케이스들은 이 화면에서 영영 못 고른다.
  const folders = useMemo(() => {
    const by = new Map<string, TestCase[]>();
    cases.forEach((c) => {
      const k = c.case_type || UNFILED;
      const cur = by.get(k);
      if (cur) cur.push(c); else by.set(k, [c]);
    });
    return Array.from(by.entries());
  }, [cases]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="데이터셋 검색"
          className="h-9 flex-1"
        />
        <span className="shrink-0 text-caption text-muted-soft">{shown.length}개</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && (
          <p className="px-4 py-8 text-sm text-muted-soft">데이터셋이 없습니다</p>
        )}

        {shown.map((d) => {
          const open = openDs === d.dataset_id;
          const dsKey = `d:${d.dataset_id}`;
          return (
            <div key={d.dataset_id} className="border-b border-line">
              <div className="flex items-center gap-2.5 px-3.5 py-2">
                <button
                  type="button"
                  onClick={() => { setOpenDs(open ? null : d.dataset_id); setOpenFolder(null); }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Chevron open={open} />
                  <KindChip kind="dataset" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-semibold text-ink">{d.dataset_nm}</span>
                    <DatasetPurpose text={d.description} />
                  </span>
                </button>
                <span className="shrink-0 text-caption text-muted-soft">{d.case_count ?? 0}건</span>
                <AddButton
                  has={inCart(dsKey)}
                  onAdd={() => add({
                    key: dsKey,
                    kind: 'dataset',
                    datasetId: d.dataset_id,
                    datasetNm: d.dataset_nm,
                    label: d.dataset_nm,
                    n: d.case_count ?? 0,
                  })}
                />
              </div>

              {open && loading && (
                <div className="px-3.5 pb-3 pl-10"><PendingHint label="케이스 읽는 중…" /></div>
              )}

              {open && !loading && folders.map(([type, rows]) => {
                const fKey = `f:${d.dataset_id}:${type}`;
                const fOpen = openFolder === fKey;
                return (
                  <div key={fKey}>
                    <div className="flex items-center gap-2.5 bg-surface-2 py-1.5 pl-10 pr-3.5">
                      <button
                        type="button"
                        onClick={() => setOpenFolder(fOpen ? null : fKey)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <Chevron open={fOpen} />
                        <KindChip kind="folder" />
                        <span className="truncate text-[13px] font-medium text-body">{folderLabel(type)}</span>
                      </button>
                      <span className="shrink-0 text-caption text-muted-soft">{rows.length}건</span>
                      <AddButton
                        has={inCart(fKey)}
                        onAdd={() => add({
                          key: fKey,
                          kind: 'folder',
                          datasetId: d.dataset_id,
                          datasetNm: d.dataset_nm,
                          label: `${d.dataset_nm} · ${folderLabel(type)}`,
                          n: rows.length,
                        })}
                      />
                    </div>

                    {fOpen && rows.map((c) => {
                      const cKey = `c:${c.case_id}`;
                      const question = parseCaseInput(c.input_data).question || '(질문 없음)';
                      return (
                        <div key={c.case_id} className="flex items-center gap-2.5 py-1.5 pl-[68px] pr-3.5">
                          <KindChip kind="case" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-body" title={question}>
                            {question}
                          </span>
                          <AddButton
                            has={inCart(cKey)}
                            onAdd={() => add({
                              key: cKey,
                              kind: 'case',
                              datasetId: d.dataset_id,
                              datasetNm: d.dataset_nm,
                              label: question,
                              n: 1,
                            })}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 왼쪽: 결과 ------------------------------------------------------------

function ResultPane({
  runId, title, onBack,
}: {
  runId: number;
  /** 실행의 이름(데이터셋 · 폴더)은 목록 쪽 요약에만 있다 — 상세 응답은 이름을
   * 들고 오지 않으므로, 오른쪽 기록에서 고른 줄의 이름을 그대로 받는다. */
  title: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    api
      .get<RagasRunDetail>(`/ragas-runs/${runId}`)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [runId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">← 데이터 고르기</Button>
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ink">
          {title}{detail ? ` · ${detail.results.length}건` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {error && <p className="text-sm text-bad">{error}</p>}
        {!detail && !error && <PendingHint label="결과 읽는 중…" />}
        {detail && (
          <>
            <SingleRunSummaryDashboard detail={detail} />
            <CaseTable detail={detail} bordered />
          </>
        )}
      </div>
    </div>
  );
}

// ---- 오른쪽: 바구니 + 기록 -------------------------------------------------

function RunRow({
  run, active, onOpen,
}: {
  run: RagasRunSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const hit = run.exact_match;
  const total = run.case_count ?? 0;
  const pass = hit != null && total ? Math.round(hit * total) : null;
  const rate = hit ?? null;
  const tone =
    rate == null ? 'border-line bg-surface-3 text-muted'
    : rate >= 0.9 ? 'border-ok-line bg-ok-soft text-ok'
    : rate >= 0.7 ? 'border-warn-line bg-warn-soft text-warn'
    : 'border-bad-line bg-bad-soft text-bad';
  const running = ['PENDING', 'RUNNING', 'CANCELLING'].includes(run.status);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
    >
      <span className="w-[42px] shrink-0 text-[11px] text-muted-soft">
        {fmtDt(run.started_dt ?? run.created_dt)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">
          {run.dataset_nm ?? '직접 입력'}
          {run.case_type ? ` · ${folderLabel(run.case_type)}` : ''}
        </span>
        <span className="block text-[10.5px] text-muted-soft">
          {total ? `${total}건` : ''}{run.endpoint_nm ? ` · ${run.endpoint_nm}` : ''}
        </span>
      </span>
      {running ? (
        <span className="shrink-0 animate-pulse text-[10.5px] font-bold text-accent">도는 중</span>
      ) : (
        <span className={cn('inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[10px] font-bold', tone)}>
          {pass != null ? `${pass}/${total}` : run.status}
        </span>
      )}
    </button>
  );
}

function Rail({
  cart, drop, clear, runs, openRunId, onOpenRun, onClose,
}: {
  cart: CartItem[];
  drop: (key: string) => void;
  clear: () => void;
  runs: RagasRunSummary[];
  openRunId: number | null;
  onOpenRun: (id: number) => void;
  onClose: () => void;
}) {
  const endpoints = useEndpoints();
  const [plan, setPlan] = useState<string | null>(null);

  const cases = cart.reduce((n, it) => n + it.n, 0);
  // 데이터셋별로 몇 건인지 — 한 실행이 데이터셋 하나만 받으므로, 섞여 있으면
  // 실행이 그 수만큼 나뉜다. 그 사실을 화면이 직접 말한다.
  const perSet = useMemo(() => {
    const by = new Map<string, number>();
    cart.forEach((it) => by.set(it.datasetNm, (by.get(it.datasetNm) ?? 0) + it.n));
    return Array.from(by.entries());
  }, [cart]);

  return (
    <div className="flex h-full flex-col">
      {/* 바구니 */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2.5">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-body">
          <path d="M2 2.5h1.8l1.5 7.2h6.4l1.3-5H4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6.4" cy="13" r="1.1" fill="currentColor" />
          <circle cx="11.2" cy="13" r="1.1" fill="currentColor" />
        </svg>
        <span className="text-body-sm font-bold text-ink">담은 것</span>
        <span
          className={cn(
            'inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-bold',
            cart.length ? 'border-accent-line bg-accent-soft text-accent-deep' : 'border-line bg-surface-3 text-muted-soft',
          )}
        >
          {cart.length}묶음 · {cases}건
        </span>
        {cart.length > 0 && (
          <button type="button" onClick={clear} className="ml-auto text-[11px] font-semibold text-muted hover:text-ink">
            비우기
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="접기"
          title="접기 — 결과에 폭을 돌려줍니다"
          className={cn('rounded-sm p-1 text-muted-soft hover:bg-surface-3 hover:text-ink', cart.length > 0 ? 'ml-1.5' : 'ml-auto')}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6.5 4.5 10 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="max-h-[42%] min-h-0 overflow-y-auto">
        {cart.length === 0 && (
          <p className="px-3.5 py-6 text-xs leading-relaxed text-muted-soft">
            왼쪽에서 담으면 데이터셋을 넘나들어 한 번에 돌릴 수 있습니다
          </p>
        )}
        {cart.map((it) => (
          <div key={it.key} className="flex items-center gap-2 border-b border-line px-3 py-2">
            <KindChip kind={it.kind} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink" title={it.label}>{it.label}</span>
            <span className="shrink-0 text-[11px] font-semibold text-body">{it.n}건</span>
            <button
              type="button"
              onClick={() => drop(it.key)}
              aria-label="빼기"
              className="shrink-0 rounded-full p-0.5 text-muted-soft hover:bg-surface-3 hover:text-ink"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-y border-line bg-surface-2 px-3 py-2.5">
        <span className="inline-flex items-baseline gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.5px] text-muted-soft">조건</span>
          <span className="truncate text-xs font-semibold text-ink">
            {(endpoints[0]?.endpoint_nm ?? 'API 미등록')} · Default · Action Test
          </span>
        </span>
        {perSet.length > 1 && (
          <span className="rounded-sm border border-warn-line bg-warn-soft px-2 py-1.5 text-[11px] leading-snug text-warn">
            데이터셋 {perSet.length}개가 섞여 있어 실행 {perSet.length}개로 나뉘어 돕니다
          </span>
        )}
        <Button
          variant="primary"
          size="md"
          disabled={cart.length === 0}
          onClick={() => setPlan(perSet.map(([nm, n]) => `${nm} ${n}건`).join(' / '))}
          className="w-full"
        >
          {cases ? `${cases}건 실행` : '실행'}
        </Button>
        {plan && (
          <span className="text-[11px] leading-snug text-muted">
            프로토타입이라 실제로 돌지는 않습니다 — 누르면 {perSet.length}개 실행으로 나갑니다: {plan}
          </span>
        )}
      </div>

      {/* 기록 */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="eyebrow">기록</span>
        <span className="text-[11px] text-muted-soft">최근 {runs.length}건</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {runs.length === 0 && <p className="px-3.5 py-6 text-xs text-muted-soft">실행 기록이 없습니다</p>}
        {runs.map((r) => (
          <RunRow
            key={r.ragas_run_id}
            run={r}
            active={openRunId === r.ragas_run_id}
            onOpen={() => onOpenRun(r.ragas_run_id)}
          />
        ))}
      </div>
    </div>
  );
}

// ---- 페이지 ----------------------------------------------------------------

export default function ProtoCartPage() {
  const { datasets } = useFlowDatasets();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [runs, setRuns] = useState<RagasRunSummary[]>([]);
  const [openRunId, setOpenRunId] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  useEffect(() => {
    api
      .get<RagasRunSummary[]>('/ragas-runs')
      .then((rows) => setRuns(rows.filter((r) => !r.is_manual).slice(0, 14)))
      .catch(() => setRuns([]));
  }, []);

  const inCart = (key: string) => cart.some((c) => c.key === key);
  const add = (it: CartItem) => setCart((cur) => (cur.some((c) => c.key === it.key) ? cur : [...cur, it]));
  const drop = (key: string) => setCart((cur) => cur.filter((c) => c.key !== key));

  const cases = cart.reduce((n, it) => n + it.n, 0);
  const openRun = runs.find((r) => r.ragas_run_id === openRunId);
  const openRunTitle = openRun
    ? `${openRun.dataset_nm ?? '직접 입력'}${openRun.case_type ? ` · ${folderLabel(openRun.case_type)}` : ''}`
    : `실행 ${openRunId}`;

  return (
    <AppShell section="single">
      <div className={cn(SHELL, 'flex h-full min-h-0 flex-col px-8 py-7')}>
        <PageHeader
          title="담아서 한 번에 (프로토타입)"
          right={
            <span className="text-caption text-muted">
              O안 · 실제 실행은 붙이지 않았습니다
            </span>
          }
        />

        <div className="flex min-h-0 flex-1 gap-4">
          <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-surface shadow-card">
            {openRunId == null ? (
              <BrowsePane datasets={datasets} inCart={inCart} add={add} />
            ) : (
              <ResultPane runId={openRunId} title={openRunTitle} onBack={() => setOpenRunId(null)} />
            )}
          </div>

          {railOpen ? (
            <div className="w-[360px] shrink-0 overflow-hidden rounded-md border border-line bg-surface shadow-card">
              <Rail
                cart={cart}
                drop={drop}
                clear={() => setCart([])}
                runs={runs}
                openRunId={openRunId}
                onOpenRun={setOpenRunId}
                onClose={() => setRailOpen(false)}
              />
            </div>
          ) : (
            // 접힌 레일 — 담은 것의 수는 접혀 있어도 남는다. 사라지면 담아 둔 걸
            // 잊은 채로 다른 걸 담게 된다.
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              title="바구니와 기록 펼치기"
              className="flex w-11 shrink-0 flex-col items-center gap-2.5 rounded-md border border-line bg-surface py-3 shadow-card transition-colors hover:bg-surface-2"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
                <path d="M9.5 4.5 6 8l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-bold',
                  cart.length ? 'border-accent-line bg-accent-soft text-accent-deep' : 'border-line bg-surface-3 text-muted-soft',
                )}
              >
                {cases}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-muted-soft [writing-mode:vertical-rl]">
                바구니 · 기록
              </span>
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
