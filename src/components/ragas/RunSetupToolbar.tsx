'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  EXACT_MATCH,
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  RAGAS_METRICS,
  type Dataset,
  type DatasetCategory,
  type Endpoint,
} from '@/lib/types';
import { EndpointSelect, ScoreToggle, folderLabel } from './shared';

/**
 * 실행 조건 머리띠(E안).
 *
 * 조건 네 개가 각자 한 줄을 쓰면 카드가 화면의 절반을 먹고, 결과는 스크롤 아래로
 * 밀린다. 여기서는 한 줄이 값만 이름표와 함께 보여 주고, 실제 컨트롤은 누를 때만
 * 그 아래로 열린다.
 */

/**
 * 머리띠 한 줄.
 *
 * TraceX 의 지표 토글(.tbd-metric-btn)과 같은 말투: 칸은 테두리 없이 흰 띠 위에
 * 글자로만 서 있고, 누른 칸만 액센트 면 + 흰 글자로 뜬다. 칸마다 테두리를 두르면
 * 띠가 셀렉트 네 개를 늘어놓은 폼으로 읽힌다.
 */
export function RunToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // 한 줄에 다 들어가면 56px, 좁은 화면에서 접히면 그만큼만 자란다.
        'flex min-h-[56px] flex-wrap items-center gap-x-2 gap-y-1.5',
        'rounded-md border border-line bg-surface px-2 py-2 shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarSep() {
  return <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />;
}

/**
 * 머리띠의 한 칸: 작은 이름표 + 지금 값, 누르면 실제 컨트롤이 아래로 열린다.
 *
 * 값을 버튼에 그대로 적는 게 핵심이다 — 셀렉트를 늘어놓으면 값을 읽기 위해 컨트롤
 * 네 개를 훑어야 하는데, 조건은 바꾸는 일보다 확인하는 일이 훨씬 많다.
 */
export function ToolbarMenu({
  label, value, width = 260, muted, lead, badge, children,
}: {
  label: string;
  value: string;
  /** 열리는 판의 너비(px). 모델 표처럼 넓은 것은 늘려 준다. */
  width?: number;
  /** 아직 고르지 않은 값 — 자리만 잡고 있다는 뜻으로 흐리게 적는다. */
  muted?: boolean;
  /** 이 줄에서 가장 중요한 칸(= 무엇을 시험하는가). 네 칸이 같은 무게면 눈이 어디서
   * 시작해야 할지 모른다. */
  lead?: boolean;
  /** 값 뒤에 붙는 작은 수 — 건수처럼 값의 일부가 아니면서 같이 읽혀야 하는 것. */
  badge?: string;
  /** 함수로 주면 판을 닫는 손잡이를 받는다 — 하나를 고르는 줄은 누른 뒤 판이 닫혀야
   * 메뉴로 읽힌다. 여럿을 켜고 끄는 줄(지표)은 닫지 않는다. */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex h-9 max-w-[340px] items-center gap-2 rounded-md px-3 transition-colors',
          open
            ? 'bg-accent text-white shadow-[0_1px_3px_rgba(37,99,235,0.35)]'
            : 'bg-transparent hover:bg-surface-3',
        )}
      >
        <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-[0.6px]', open ? 'text-white/75' : 'text-muted')}>{label}</span>
        <span
          className={cn(
            'truncate',
            lead ? 'text-[14.5px] font-bold' : 'text-[13.5px] font-semibold',
            open ? (muted ? 'text-white/70' : 'text-white') : muted ? 'text-muted-soft' : 'text-ink',
          )}
        >
          {value}
        </span>
        {badge && (
          <span
            className={cn(
              'inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10.5px] font-bold',
              open ? 'bg-white/20 text-white' : 'bg-accent-soft text-accent-deep',
            )}
          >
            {badge}
          </span>
        )}
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden className={cn('shrink-0 self-center', open ? 'text-white/75' : 'text-muted-soft')}>
          <path d="M4 6.5 8 10.5l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        // 줄이 자기 여백을 들고 있으므로 판의 안쪽 여백은 6px 뿐이다. 그림자는
        // lift — modal 급 그림자를 작은 판에 쓰면 네 칸 중 하나를 눌렀을 뿐인데
        // 화면 전체가 뒤로 물러난 것처럼 보인다.
        <div
          style={{ width }}
          className="absolute left-0 top-[42px] z-20 rounded-md border border-line-strong bg-surface p-1.5 shadow-lift"
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

// ---- 판 안의 줄 ------------------------------------------------------------

/**
 * 고르는 줄. 판 안의 기본 단위다.
 *
 * 하나만 고르는 줄(`check` 없음)은 고른 것에 체크 표시가 서고, 여러 개를 켜고 끄는
 * 줄(`check` 있음)은 왼쪽에 상자가 선다 — 같은 모양으로 두면 눌렀을 때 하나가
 * 바뀌는지 하나가 더해지는지 알 수 없다.
 */
export function MenuRow({
  label, note, selected, check, disabled, indent, title, onClick,
}: {
  label: string;
  note?: string;
  selected?: boolean;
  /** 주면 여럿 고르기 — 왼쪽에 체크 상자가 선다. */
  check?: boolean;
  disabled?: boolean;
  indent?: boolean;
  title?: string;
  onClick: () => void;
}) {
  const on = check ?? selected;
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors',
        indent && 'pl-6',
        disabled
          ? 'cursor-not-allowed text-muted-soft'
          : on && check === undefined
            ? 'bg-accent-soft text-accent'
            : 'text-ink hover:bg-surface-3',
      )}
    >
      {check !== undefined && (
        <span
          className={cn(
            'flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-xs border',
            check ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-transparent',
          )}
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', on ? 'font-semibold' : 'font-medium')}>{label}</span>
      {note && <span className="shrink-0 text-[11px] text-muted-soft">{note}</span>}
      {check === undefined && selected && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-accent">
          <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** 판 안의 묶음 이름. 윗줄과 선으로 끊어 '여기부터 다른 것' 을 말한다. */
export function MenuSection({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('mt-1 border-t border-line px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.6px] text-muted-soft', className)}>
      {label}
    </div>
  );
}

/** 판 맨 아래의 동작 — 고르는 줄이 아니라 '여기서 나가서 하는 일'(케이스 고르기처럼). */
export function MenuFoot({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex items-center gap-1.5 border-t border-line px-1 pt-1.5">{children}</div>;
}

/** 두 줄기를 나란히 — 데이터셋과 그 폴더처럼, 왼쪽을 고르면 오른쪽이 달라지는 짝. */
export function MenuCols({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="flex items-stretch gap-1.5">
      <div className="min-w-0 flex-1">{left}</div>
      <div aria-hidden className="w-px shrink-0 bg-line" />
      <div className="min-w-0 flex-1">{right}</div>
    </div>
  );
}

/** 머리띠 오른쪽 끝의 실행 단추에 붙는 ▶. 버튼 하나뿐인 줄에서 '여기가 시작'을
 * 글자보다 먼저 말한다. */
export function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.8v10.4L13 8z" />
    </svg>
  );
}

// ---- Single · Compare 가 같이 쓰는 판 -----------------------------------------
// 두 패널의 머리띠가 같은 칸을 같은 모양으로 열어야 같은 화면으로 읽힌다.

/** Agent 칸. 등록된 API 가 없으면 고를 목록이 없다 — 설정으로 가는 길만 띄운다. */
export function AgentMenu({
  endpoints, value, onPick,
}: { endpoints: Endpoint[]; value: number | null; onPick: (id: number | null) => void }) {
  if (endpoints.length === 0) {
    return <EndpointSelect endpoints={endpoints} value={value} onChange={onPick} className="h-9 w-full text-sm" />;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {endpoints.map((e) => (
        <MenuRow
          key={e.endpoint_id}
          label={e.endpoint_nm}
          title={e.endpoint_url}
          selected={e.endpoint_id === value}
          onClick={() => onPick(e.endpoint_id)}
        />
      ))}
    </div>
  );
}

export const agentLabel = (endpoints: Endpoint[], id: number | null) =>
  endpoints.find((e) => e.endpoint_id === id)?.endpoint_nm ?? 'API 선택';

export type DataSource = 'dataset' | 'manual';

/** 데이터 칸. `cases` 를 주면 판 아래에 케이스 고르기가 붙는다. */
export function DataMenu({
  close, source, setSource, datasets, datasetId, setDatasetId, folders, caseType, setCaseType, cases,
}: {
  close: () => void;
  source: DataSource;
  setSource: (v: DataSource) => void;
  datasets: Dataset[];
  datasetId: number | null;
  setDatasetId: (v: number | null) => void;
  folders: DatasetCategory[];
  caseType: string | null;
  setCaseType: (v: string | null) => void;
  cases?: { picked: number | null; onPick: () => void; onClear: () => void };
}) {
  const picked = datasets.find((d) => d.dataset_id === datasetId);
  return (
    <div className="flex flex-col gap-0.5">
      <MenuRow label="데이터셋" note="케이스 묶음" selected={source === 'dataset'} onClick={() => setSource('dataset')} />
      <MenuRow label="직접 입력" note="메시지 하나" selected={source === 'manual'} onClick={() => { setSource('manual'); close(); }} />
      {source === 'dataset' && (
        <>
          <MenuSection label="데이터셋 · 폴더" />
          <MenuCols
            left={
              <div className="flex flex-col gap-0.5">
                {datasets.length === 0 && <p className="px-2 py-1.5 text-[11px] text-muted-soft">데이터셋 없음</p>}
                {datasets.map((d) => (
                  <MenuRow
                    key={d.dataset_id}
                    label={d.dataset_nm}
                    note={d.case_count != null ? String(d.case_count) : undefined}
                    title={d.description ?? undefined}
                    selected={d.dataset_id === datasetId}
                    onClick={() => setDatasetId(d.dataset_id)}
                  />
                ))}
              </div>
            }
            right={
              datasetId == null ? (
                <p className="px-2 py-1.5 text-[11px] text-muted-soft">데이터셋을 먼저 고르세요</p>
              ) : folders.length < 2 ? (
                // 폴더가 하나뿐이면 '전체' 와 그 폴더가 같은 실행이다.
                <p className="px-2 py-1.5 text-[11px] text-muted-soft">폴더 없음 — 전체 실행</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <MenuRow
                    label="전체"
                    note={picked?.case_count != null ? String(picked.case_count) : undefined}
                    selected={caseType == null}
                    onClick={() => { setCaseType(null); close(); }}
                  />
                  {folders.map((c) => (
                    <MenuRow
                      key={c.type_cd}
                      label={folderLabel(c.type_cd)}
                      note={String(c.case_count)}
                      disabled={c.case_count === 0}
                      selected={c.type_cd === caseType}
                      onClick={() => { setCaseType(c.type_cd); close(); }}
                    />
                  ))}
                </div>
              )
            }
          />
          {cases && datasetId != null && (
            <MenuFoot>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { cases.onPick(); close(); }}
                title="이 데이터셋(폴더)에서 돌릴 케이스만 고릅니다"
              >
                {cases.picked != null ? `케이스 ${cases.picked}건 고름` : '케이스 고르기'}
              </Button>
              {cases.picked != null && (
                <Button variant="ghost" size="sm" onClick={cases.onClear} title="선택 해제 — 전체 실행">
                  해제
                </Button>
              )}
            </MenuFoot>
          )}
        </>
      )}
    </div>
  );
}

/** 데이터 칸에 적는 값과 건수. 건수는 값이 아니라 값에 딸린 수 — 이름과 한 덩어리로
 * 이어 붙이면 어디까지가 데이터셋 이름인지 흐려진다. */
export function dataSummary(
  source: DataSource,
  datasets: Dataset[],
  datasetId: number | null,
  folders: DatasetCategory[],
  caseType: string | null,
  pickedCount: number | null = null,
): { label: string; badge?: string; count: number | null; empty: boolean } {
  const ds = datasets.find((d) => d.dataset_id === datasetId);
  const folder = caseType != null ? folders.find((c) => c.type_cd === caseType) : null;
  // 몇 건이 도는지 — 고른 케이스가 있으면 그 수, 폴더를 좁혔으면 폴더의 수,
  // 아니면 데이터셋 전체. 실행 버튼에 그대로 적는 값이다.
  const count = pickedCount ?? (folder ? folder.case_count : ds?.case_count ?? null);
  if (source === 'manual') return { label: '직접 입력', count, empty: false };
  if (!ds) return { label: '데이터셋 선택', count, empty: true };
  return {
    label: [ds.dataset_nm, folder ? folderLabel(folder.type_cd) : null].filter(Boolean).join(' · '),
    badge: pickedCount != null ? `선택 ${pickedCount}건` : count != null ? `${count}건` : undefined,
    count,
    empty: false,
  };
}

/** 채점 칸. 여럿을 켜고 끄는 판이라 누른 뒤에도 닫지 않는다. */
export function ScoreMenu({
  scoreOn, setScoreOn, metrics, setMetrics,
}: {
  scoreOn: boolean;
  setScoreOn: (v: boolean) => void;
  metrics: string[];
  setMetrics: (fn: (cur: string[]) => string[]) => void;
}) {
  const toggle = (m: string) => setMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-8 items-center gap-2 px-2">
        <ScoreToggle on={scoreOn} onChange={setScoreOn} />
        <span className="text-[13px] font-medium text-ink">{scoreOn ? '채점함' : '채점 없이 응답만'}</span>
      </div>
      <MenuRow
        label={METRIC_LABELS[EXACT_MATCH]}
        title={METRIC_DESCRIPTIONS[EXACT_MATCH]}
        check={metrics.includes(EXACT_MATCH)}
        disabled={!scoreOn}
        onClick={() => toggle(EXACT_MATCH)}
      />
      <MenuSection label="RAGAS" />
      {RAGAS_METRICS.map((m) => (
        <MenuRow
          key={m}
          indent
          label={METRIC_LABELS[m]}
          title={METRIC_DESCRIPTIONS[m]}
          check={metrics.includes(m)}
          disabled={!scoreOn}
          onClick={() => toggle(m)}
        />
      ))}
      {scoreOn && metrics.length === 0 && (
        <p className="px-2 pt-1 text-caption text-bad">하나 이상 고르세요</p>
      )}
    </div>
  );
}

export function scoreLabel(scoreOn: boolean, metrics: string[]): string {
  if (!scoreOn) return '없음';
  if (metrics.length === 0) return '지표 선택';
  const ragas = metrics.filter((m) => m !== EXACT_MATCH).length;
  return [metrics.includes(EXACT_MATCH) ? 'Action Test' : null, ragas ? `RAGAS ${ragas}` : null]
    .filter(Boolean).join(' + ');
}
