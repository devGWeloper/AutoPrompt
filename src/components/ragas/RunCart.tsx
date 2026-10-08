'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Dataset, RagasRunSummary, TestCase } from '@/lib/types';
import { parseCaseInput } from './caseFields';
import { DatasetPurpose, fmtDt, folderLabel, PendingHint, UNFILED } from './shared';

/**
 * O안 — 돌릴 것을 담아서 한 번에.
 *
 * 지금 실행 조건은 "데이터셋 하나 + 폴더 하나"로 묶여 있어서, 오늘 확인할 것이
 * 여러 데이터셋에 흩어져 있으면 실행을 나눠서 여러 번 해야 한다. 바구니는 고르는
 * 일과 돌리는 일을 떼어 놓아 그 묶음을 먼저 모으게 한다.
 *
 * 왼쪽 레일 하나가 '고르는 일' 전부를 가진다 — 위에서 아래로 훑기 · 담긴 것 ·
 * 실행 · 기록. 고르는 자리가 오른쪽 본문에 있으면 결과와 자리를 다투고, 무엇보다
 * 담는 곳과 담긴 것이 화면 양쪽으로 갈려 한 동작이 두 군데를 오가게 된다.
 * 본문은 결과만 쓴다.
 *
 * 담긴 것을 따로 목록으로 두지 않는다. 같은 줄을 한 번 더 누르면 빠지고, 머리의
 * '담은 것만' 으로 걸러 보면 그게 바구니 목록이다 — 목록 두 개가 같은 것을 두 모양
 * 으로 보여 주면 어느 쪽에서 빼야 하는지가 매번 헷갈린다.
 *
 * 프로토타입 코드다. 단일 실행 패널의 'O · 바구니' 스킨만 쓴다.
 */

// ---- 담은 것 ---------------------------------------------------------------

export type CartKind = 'dataset' | 'folder' | 'case';

export interface CartItem {
  /** 같은 것을 두 번 담지 않게 하는 열쇠. */
  key: string;
  kind: CartKind;
  datasetId: number;
  datasetNm: string;
  label: string;
  /** 이 항목이 데리고 오는 케이스 수. */
  n: number;
  /** 돌릴 케이스들. null 은 '데이터셋 전체' — 그 경우 서버에 case_ids 를 보내지
   * 않는다(폴더를 펼치지 않고도 데이터셋째로 담을 수 있어야 하므로). */
  caseIds: number[] | null;
}

export interface CartApi {
  cart: CartItem[];
  add: (it: CartItem) => void;
  drop: (key: string) => void;
  /** 담겼으면 빼고, 아니면 담는다 — 같은 줄이 두 동작을 한다. */
  toggle: (it: CartItem) => void;
  clear: () => void;
  inCart: (key: string) => boolean;
  /** 담은 케이스 수 합계. */
  cases: number;
  /** 데이터셋 이름 → 건수. 한 실행이 데이터셋 하나만 받으므로, 둘 이상이면
   * 실행이 그만큼 나뉜다. */
  perSet: [string, number][];
  /** 바구니가 데이터셋 하나로 떨어질 때의 실행 인자. 섞여 있으면 null —
   * 지금 서버가 한 번에 못 받는다. */
  single: { datasetId: number; caseIds: number[] | null } | null;
}

/**
 * a 가 b 를 품는가 — 데이터셋은 그 안의 모든 폴더·케이스를, 폴더는 자기 케이스를
 * 품는다.
 *
 * 품는 것과 품긴 것을 같이 담으면 같은 케이스를 두 번 세게 된다 — '주문 조회
 * 24건' 과 '주문 조회 · 부분취소 12건' 을 같이 담으면 바구니가 36건이라고 말하지만
 * 실제로 돌 것은 24건이다.
 */
function covers(a: CartItem, b: CartItem): boolean {
  if (a.key === b.key || a.datasetId !== b.datasetId) return false;
  if (a.kind === 'dataset') return true;
  if (a.kind === 'folder' && b.kind === 'case') {
    const mine = a.caseIds ?? [];
    return (b.caseIds ?? []).every((id) => mine.includes(id));
  }
  return false;
}

export function useCart(): CartApi {
  const [cart, setCart] = useState<CartItem[]>([]);

  const add = useCallback((it: CartItem) => {
    setCart((cur) => {
      if (cur.some((c) => c.key === it.key)) return cur;
      // 이미 상위가 담겨 있으면 담을 것이 없다. 아래 UI 가 그 줄의 단추를 막아 두지만,
      // 막는 쪽이 한 군데 더 있어도 손해가 없다.
      if (cur.some((c) => covers(c, it))) return cur;
      // 거꾸로, 새로 담는 것이 이미 담긴 것들을 품으면 그것들을 걷어낸다 — 폴더 둘을
      // 담아 둔 뒤 데이터셋째로 담으면 폴더 둘은 뜻이 없어진다.
      return [...cur.filter((c) => !covers(it, c)), it];
    });
  }, []);
  const drop = useCallback((key: string) => {
    setCart((cur) => cur.filter((c) => c.key !== key));
  }, []);
  const toggle = useCallback((it: CartItem) => {
    setCart((cur) => {
      if (cur.some((c) => c.key === it.key)) return cur.filter((c) => c.key !== it.key);
      if (cur.some((c) => covers(c, it))) return cur;
      return [...cur.filter((c) => !covers(it, c)), it];
    });
  }, []);
  const clear = useCallback(() => setCart([]), []);

  const cases = cart.reduce((n, it) => n + it.n, 0);

  const perSet = useMemo(() => {
    const by = new Map<string, number>();
    cart.forEach((it) => by.set(it.datasetNm, (by.get(it.datasetNm) ?? 0) + it.n));
    return Array.from(by.entries());
  }, [cart]);

  const single = useMemo(() => {
    if (cart.length === 0) return null;
    const ids = new Set(cart.map((c) => c.datasetId));
    if (ids.size !== 1) return null;
    const datasetId = cart[0].datasetId;
    // 데이터셋째로 담은 게 하나라도 있으면 그게 전체를 덮는다 — 그 안의 폴더·케이스를
    // 따로 더해도 결과가 같다.
    if (cart.some((c) => c.caseIds === null)) return { datasetId, caseIds: null };
    const merged = new Set<number>();
    cart.forEach((c) => (c.caseIds ?? []).forEach((id) => merged.add(id)));
    return { datasetId, caseIds: Array.from(merged) };
  }, [cart]);

  return { cart, add, drop, toggle, clear, inCart: (key) => cart.some((c) => c.key === key), cases, perSet, single };
}

/** 최근 실행 — 레일 아래쪽 기록. 수동 호출은 데이터셋이 없어 담을 것과 짝이 맞지
 * 않으므로 뺀다. */
export function useRecentRuns(limit = 14, enabled = true) {
  const [runs, setRuns] = useState<RagasRunSummary[]>([]);
  const reload = useCallback(() => {
    // 레일이 떠 있지 않은 스킨에서는 부르지 않는다 — 패널이 열릴 때마다 쓰지도
    // 않는 목록을 한 번씩 읽어 오게 된다.
    if (!enabled) return;
    api
      .get<RagasRunSummary[]>('/ragas-runs')
      .then((rows) => setRuns(rows.filter((r) => !r.is_manual).slice(0, limit)))
      .catch(() => setRuns([]));
  }, [limit, enabled]);
  useEffect(reload, [reload]);
  return { runs, reload };
}

// ---- 조각 -----------------------------------------------------------------

const KIND_LABEL: Record<CartKind, string> = { dataset: '셋', folder: '폴더', case: '건' };

const KIND_TONE: Record<CartKind, string> = {
  dataset: 'border-accent-line bg-accent-soft text-accent-deep',
  folder: 'border-line bg-surface-3 text-[#7c3aed]',
  case: 'border-line bg-surface-2 text-muted',
};

/** 무엇을 담았는지 — 데이터셋 하나와 케이스 하나가 목록에서 같아 보이면 '26건' 이
 * 어디서 왔는지 셀 수 없다. 레일이 좁으므로 이름은 한 글자로 줄인다. */
function KindChip({ kind }: { kind: CartKind }) {
  return (
    <span className={cn('inline-flex h-[18px] shrink-0 items-center rounded-xs border px-1 text-[10px] font-bold', KIND_TONE[kind])}>
      {KIND_LABEL[kind]}
    </span>
  );
}

/**
 * 담기·빼기를 한 단추가 겸한다. 담긴 줄은 체크로 서고, 다시 누르면 빠진다.
 *
 * `covered` 는 '위쪽에서 이미 담겼다' — 데이터셋째로 담았으면 그 안의 폴더·케이스는
 * 따로 담을 것이 없다. 단추를 숨기지 않고 흐린 체크로 두는 건, 이미 돌 거리에
 * 들어 있다는 사실을 그 줄에서 읽을 수 있어야 하기 때문이다.
 */
function PickButton({ on, covered, onToggle }: { on: boolean; covered?: boolean; onToggle: () => void }) {
  if (covered) {
    return (
      <span
        title="위 항목에 이미 담겨 있습니다"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-accent-line bg-accent-soft text-accent"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden className="opacity-55">
          <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? '빼기' : '담기'}
      title={on ? '빼기' : '담기'}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border transition-colors',
        on
          ? 'border-accent bg-accent text-white hover:border-accent-deep hover:bg-accent-deep'
          : 'border-line-strong bg-surface text-muted hover:bg-surface-3 hover:text-ink',
      )}
    >
      {on ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden
      className={cn('shrink-0 text-muted-soft transition-transform', !open && '-rotate-90')}
    >
      <path d="M4 6.5 8 10.5l4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- 훑기 ------------------------------------------------------------------

/** 펼친 데이터셋의 케이스를 한 번만 읽어 폴더로 묶는다. case-types 를 따로 부르지
 * 않는 건, 담을 수 있는 폴더는 케이스가 있는 폴더뿐이기 때문이다. */
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

/** 데이터셋 ▸ 폴더 ▸ 케이스. 어느 층에서든 담을 수 있다 — 한 층만 담게 하면
 * '이 데이터셋 전체와 저기서 한 건' 같은 묶음을 만들 수 없다. */
function CartTree({ datasets, cart, q }: { datasets: Dataset[]; cart: CartApi; q: string }) {
  const [openDs, setOpenDs] = useState<number | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const { cases, loading } = useCases(openDs);

  const needle = q.trim().toLowerCase();
  const shown = needle ? datasets.filter((d) => d.dataset_nm.toLowerCase().includes(needle)) : datasets;

  // 폴더 없는 케이스도 한 묶음이다 — 담을 수 없으면 이 화면에서 영영 못 고른다.
  const folders = useMemo(() => {
    const by = new Map<string, TestCase[]>();
    cases.forEach((c) => {
      const k = c.case_type || UNFILED;
      const cur = by.get(k);
      if (cur) cur.push(c); else by.set(k, [c]);
    });
    return Array.from(by.entries());
  }, [cases]);

  if (shown.length === 0) {
    return <p className="px-3 py-6 text-xs text-muted-soft">{needle ? '찾는 데이터셋이 없습니다' : '데이터셋이 없습니다'}</p>;
  }

  return (
    <>
      {shown.map((d) => {
        const open = openDs === d.dataset_id;
        // 데이터셋째로 담았으면 그 안의 줄들은 이미 돌 거리에 들어 있다.
        const dsPicked = cart.inCart(`d:${d.dataset_id}`);
        const dsKey = `d:${d.dataset_id}`;
        return (
          <div key={d.dataset_id} className="border-b border-line">
            <div className="flex items-center gap-1.5 py-1.5 pl-2 pr-2">
              <button
                type="button"
                onClick={() => { setOpenDs(open ? null : d.dataset_id); setOpenFolder(null); }}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <Caret open={open} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{d.dataset_nm}</span>
                  <DatasetPurpose text={d.description} />
                </span>
                <span className="shrink-0 text-[11px] text-muted-soft">{d.case_count ?? 0}</span>
              </button>
              <PickButton
                on={cart.inCart(dsKey)}
                onToggle={() => cart.toggle({
                  key: dsKey, kind: 'dataset', datasetId: d.dataset_id, datasetNm: d.dataset_nm,
                  label: d.dataset_nm, n: d.case_count ?? 0, caseIds: null,
                })}
              />
            </div>

            {open && loading && <div className="pb-2 pl-6 pr-2"><PendingHint label="케이스 읽는 중…" /></div>}

            {open && !loading && folders.map(([type, rows]) => {
              const fKey = `f:${d.dataset_id}:${type}`;
              const fOpen = openFolder === fKey;
              const fPicked = cart.inCart(fKey);
              return (
                <div key={fKey}>
                  <div className="flex items-center gap-1.5 bg-surface-2 py-1 pl-5 pr-2">
                    <button
                      type="button"
                      onClick={() => setOpenFolder(fOpen ? null : fKey)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <Caret open={fOpen} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-body">{folderLabel(type)}</span>
                      <span className="shrink-0 text-[11px] text-muted-soft">{rows.length}</span>
                    </button>
                    <PickButton
                      on={fPicked}
                      covered={dsPicked}
                      onToggle={() => cart.toggle({
                        key: fKey, kind: 'folder', datasetId: d.dataset_id, datasetNm: d.dataset_nm,
                        label: `${d.dataset_nm} · ${folderLabel(type)}`, n: rows.length,
                        caseIds: rows.map((c) => c.case_id),
                      })}
                    />
                  </div>

                  {fOpen && rows.map((c) => {
                    const cKey = `c:${c.case_id}`;
                    const question = parseCaseInput(c.input_data).question || '(질문 없음)';
                    return (
                      <div key={c.case_id} className="flex items-center gap-1.5 py-1 pl-9 pr-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-body" title={question}>{question}</span>
                        <PickButton
                          on={cart.inCart(cKey)}
                          covered={dsPicked || fPicked}
                          onToggle={() => cart.toggle({
                            key: cKey, kind: 'case', datasetId: d.dataset_id, datasetNm: d.dataset_nm,
                            label: question, n: 1, caseIds: [c.case_id],
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
    </>
  );
}

/** '담은 것만' 으로 걸렀을 때 — 같은 줄들이 층 없이 평평하게 선다. */
function CartPicked({ cart }: { cart: CartApi }) {
  if (cart.cart.length === 0) {
    return (
      <p className="px-3 py-6 text-xs leading-relaxed text-muted-soft">
        아직 담은 것이 없습니다. 위를 눌러 전체 목록에서 담으세요
      </p>
    );
  }
  return (
    <>
      {cart.cart.map((it) => (
        <div key={it.key} className="flex items-center gap-1.5 border-b border-line py-1.5 pl-2 pr-2">
          <KindChip kind={it.kind} />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink" title={it.label}>{it.label}</span>
          <span className="shrink-0 text-[11px] font-semibold text-body">{it.n}</span>
          <PickButton on onToggle={() => cart.drop(it.key)} />
        </div>
      ))}
    </>
  );
}

// ---- 기록 ------------------------------------------------------------------

function RunRow({ run, active, onOpen }: { run: RagasRunSummary; active: boolean; onOpen: () => void }) {
  const total = run.case_count ?? 0;
  const rate = run.exact_match;
  const pass = rate != null && total ? Math.round(rate * total) : null;
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
        'flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-left transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
    >
      <span className="w-[42px] shrink-0 text-[11px] text-muted-soft">{fmtDt(run.started_dt ?? run.created_dt)}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
        {run.dataset_nm ?? '직접 입력'}{run.case_type ? ` · ${folderLabel(run.case_type)}` : ''}
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

// ---- 레일 ------------------------------------------------------------------

export function CartRail({
  cart, datasets, runs, openRunId, onOpenRun, onCollapse, onRun, running, onCancel, cancelling,
  blockedReason, conditionText,
}: {
  cart: CartApi;
  datasets: Dataset[];
  runs: RagasRunSummary[];
  openRunId: number | null;
  onOpenRun: (id: number) => void;
  onCollapse: () => void;
  /** 바구니가 데이터셋 하나로 떨어질 때만 받는다. */
  onRun?: (arg: { datasetId: number; caseIds: number[] | null }) => void;
  running?: boolean;
  /** 도는 것을 멈춘다. 머리띠에서 실행 단추를 뺐으니 취소도 이 레일이 들어야 한다 —
   * 멈출 자리가 없으면 잘못 담아 돌린 실행을 끝까지 기다리는 수밖에 없다. */
  onCancel?: () => void;
  cancelling?: boolean;
  /** 바구니는 멀쩡한데 조건이 덜 채워져 실행이 막힌 이유. 멈춘 단추만 두면 눌러
   * 보고도 왜 아무 일이 없는지 알 수 없다. */
  blockedReason?: string | null;
  /** 조건 한 줄. 머리띠가 조건을 들고 있으면 넘기지 않는다. */
  conditionText?: ReactNode;
}) {
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [q, setQ] = useState('');
  const [histOpen, setHistOpen] = useState(true);
  const { cases, perSet, single, clear } = cart;
  const split = perSet.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 머리 — 담은 양이 늘 보인다. 아래 목록이 '전체' 를 보고 있을 때도 그렇다. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-2.5 py-2">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-body">
          <path d="M2 2.5h1.8l1.5 7.2h6.4l1.3-5H4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6.4" cy="13" r="1.1" fill="currentColor" />
          <circle cx="11.2" cy="13" r="1.1" fill="currentColor" />
        </svg>
        <span className="text-body-sm font-bold text-ink">바구니</span>
        <span
          className={cn(
            'inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-bold',
            cart.cart.length ? 'border-accent-line bg-accent-soft text-accent-deep' : 'border-line bg-surface-3 text-muted-soft',
          )}
        >
          {cart.cart.length}묶음 · {cases}건
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="접기"
          title="접기 — 결과에 폭을 돌려줍니다"
          className="ml-auto rounded-sm p-1 text-muted-soft hover:bg-surface-3 hover:text-ink"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M9.5 4.5 6 8l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* 고르는 줄: 무엇을 보고 있는지(전체 / 담은 것만)와 검색. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2">
        <div className="inline-flex shrink-0 rounded-sm border border-line bg-surface p-0.5">
          {([[false, '전체'], [true, '담은 것']] as const).map(([v, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setOnlyPicked(v)}
              className={cn(
                'rounded-xs px-2 py-1 text-[11.5px] font-semibold transition-colors',
                onlyPicked === v ? 'bg-primary text-primary-fg' : 'text-muted hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {onlyPicked ? (
          cart.cart.length > 0 && (
            <button type="button" onClick={clear} className="ml-auto shrink-0 text-[11px] font-semibold text-muted hover:text-ink">
              비우기
            </button>
          )
        ) : (
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="데이터셋 검색" className="h-7 min-w-0 flex-1 text-xs" />
        )}
      </div>

      {/* 담을 것 훑기 — 레일에서 가장 큰 자리를 쓴다. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {onlyPicked ? <CartPicked cart={cart} /> : <CartTree datasets={datasets} cart={cart} q={q} />}
      </div>

      {/* 실행 — 담긴 것과 기록 사이. 위는 아직 안 돈 것, 아래는 끝난 것이다. */}
      <div className="flex shrink-0 flex-col gap-2 border-y border-line bg-surface-2 px-2.5 py-2.5">
        {conditionText && (
          <span className="inline-flex items-baseline gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.5px] text-muted-soft">조건</span>
            <span className="truncate text-xs font-semibold text-ink">{conditionText}</span>
          </span>
        )}
        {/* 도는 중에는 조건 경고를 접는다 — 지금 돌고 있는 실행과 상관이 없는데
            취소 단추 위에 서면 그 경고 때문에 못 멈추는 것처럼 읽힌다. */}
        {!running && !split && blockedReason && (
          <span className="rounded-sm border border-warn-line bg-warn-soft px-2 py-1.5 text-[11px] leading-snug text-warn">
            {blockedReason}
          </span>
        )}
        {!running && split && (
          <span className="rounded-sm border border-warn-line bg-warn-soft px-2 py-1.5 text-[11px] leading-snug text-warn">
            데이터셋 {perSet.length}개가 섞여 있어 한 번에 못 돕니다 — 실행을 묶는 일이 아직 없어서, 지금은 하나씩 담아 돌려야 합니다
          </span>
        )}
        {/* 한 자리가 실행과 취소를 겸한다. 도는 중에 단추가 '도는 중…' 으로 멈춰
            있으면 멈추는 길이 없고, 취소를 따로 세우면 안 도는 동안 빈 자리가 남는다.
            바구니를 비워도 취소는 눌려야 하므로 막는 조건을 가른다. */}
        <Button
          variant={running ? 'secondary' : 'primary'}
          size="md"
          disabled={running ? cancelling || !onCancel : !single || !onRun || !!blockedReason}
          onClick={() => {
            if (running) { onCancel?.(); return; }
            if (single && onRun) onRun(single);
          }}
          className="w-full"
        >
          {running
            ? cancelling ? '취소 중…' : '취소'
            : cases ? `${cases}건 실행` : '실행'}
        </Button>
      </div>

      {/* 기록 — 접을 수 있다. 담을 것을 길게 훑을 때는 자리를 내준다. */}
      <button
        type="button"
        onClick={() => setHistOpen((v) => !v)}
        aria-expanded={histOpen}
        className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-1.5 text-left"
      >
        <Caret open={histOpen} />
        <span className="eyebrow">기록</span>
        <span className="text-[11px] text-muted-soft">최근 {runs.length}건</span>
      </button>
      {histOpen && (
        <div className="max-h-[38%] min-h-0 shrink-0 overflow-y-auto">
          {runs.length === 0 && <p className="px-3 py-5 text-xs text-muted-soft">실행 기록이 없습니다</p>}
          {runs.map((r) => (
            <RunRow key={r.ragas_run_id} run={r} active={openRunId === r.ragas_run_id} onOpen={() => onOpenRun(r.ragas_run_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 접힌 레일. 담은 건수는 접혀 있어도 남는다 — 사라지면 담아 둔 걸 잊은 채로 또
 * 담게 된다. */
export function CartRailFolded({ cases, onOpen }: { cases: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="바구니와 기록 펼치기"
      className="flex w-11 shrink-0 flex-col items-center gap-2.5 self-start rounded-md border border-line bg-surface py-3 shadow-card transition-colors hover:bg-surface-2"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
        <path d="M6.5 4.5 10 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span
        className={cn(
          'inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-bold',
          cases ? 'border-accent-line bg-accent-soft text-accent-deep' : 'border-line bg-surface-3 text-muted-soft',
        )}
      >
        {cases}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-muted-soft [writing-mode:vertical-rl]">
        바구니 · 기록
      </span>
    </button>
  );
}
