'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import pkg from '../../../package.json';

/**
 * App shell, inview's chrome: a full-width top bar (fold toggle, brand, where you
 * are) over one sidebar that carries every destination in the product, so there
 * is a single place to look for where to go.
 *
 * The four run/data sections live on one route (`/`) because Single and Compare
 * must stay mounted — unmounting drops a live run's SSE stream, which the server
 * reads as a cancel. So the sidebar switches them through `onSelect` when that
 * page is already open, and navigates to `/?section=…` from anywhere else.
 */

export type SectionId = 'single' | 'compare' | 'datasets' | 'records' | 'prompts' | 'settings';

/** The sections that live on the run page and are switched in place. */
export const RUN_SECTIONS: SectionId[] = ['single', 'compare', 'datasets', 'records'];

interface Item {
  id: SectionId;
  label: string;
  href: string;
  icon: ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Icons carry the meaning of each row; the label names it. Both, always — an
 * icon rail alone is a guessing game and a text list has no shape. */
const ICONS: Record<SectionId, ReactNode> = {
  single: (
    <svg viewBox="0 0 20 20" width="16" height="16" {...stroke}>
      <circle cx="10" cy="10" r="7" />
      <path d="M8.4 7.3 13 10l-4.6 2.7z" />
    </svg>
  ),
  compare: (
    <svg viewBox="0 0 20 20" width="16" height="16" {...stroke}>
      <rect x="2.5" y="3.5" width="6" height="13" rx="1.2" />
      <rect x="11.5" y="3.5" width="6" height="13" rx="1.2" />
    </svg>
  ),
  datasets: (
    <svg viewBox="0 0 20 20" width="16" height="16" {...stroke}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M2.5 8h15M7.5 8v8.5" />
    </svg>
  ),
  records: (
    <svg viewBox="0 0 20 20" width="16" height="16" {...stroke}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.2l2.8 1.8" />
    </svg>
  ),
  prompts: (
    <svg viewBox="0 0 20 20" width="16" height="16" {...stroke}>
      <path d="M5 2.8h6.4L15.5 7v10.2H5z" />
      <path d="M11 2.8V7h4.5M7.6 10.5h5M7.6 13.4h3.4" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" width="16" height="16" {...stroke}>
      <path d="M3 6h9M15.5 6h1.5M3 14h1.5M8 14h9" />
      <circle cx="13.6" cy="6" r="2" />
      <circle cx="6.2" cy="14" r="2" />
    </svg>
  ),
};

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: 'Test',
    items: [
      { id: 'single', label: 'Single Run', href: '/?section=single', icon: ICONS.single },
      { id: 'compare', label: 'Pair Run', href: '/?section=compare', icon: ICONS.compare },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'datasets', label: 'Datasets', href: '/?section=datasets', icon: ICONS.datasets },
      { id: 'records', label: 'Records', href: '/?section=records', icon: ICONS.records },
    ],
  },
  {
    label: 'Manage',
    items: [
      { id: 'prompts', label: 'Prompt', href: '/nodes', icon: ICONS.prompts },
      { id: 'settings', label: 'Settings', href: '/settings', icon: ICONS.settings },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

export const SECTION_META = Object.fromEntries(
  ALL_ITEMS.map((i) => [i.id, { label: i.label, icon: i.icon }]),
) as Record<SectionId, { label: string; icon: ReactNode }>;

interface HealthData {
  env?: string;
  dbConnected?: boolean;
}

/** Environment and DB state as two badges at the top bar's right end — where
 * inview keeps its env badge — so what this app is talking to is visible from
 * every screen without a sentence about it. */
function StatusBadges() {
  const [health, setHealth] = useState<HealthData | null>(null);
  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HealthData | null) => setHealth(d ?? null))
      .catch(() => {});
  }, []);
  if (!health?.env) return null;
  const prd = health.env === 'prd';
  const db = !!health.dbConnected;
  // inview .env-badge — 13px, 5px 11px, 알약.
  const badge = 'inline-flex items-center gap-1.5 rounded-full border px-[11px] py-[5px] text-[13px]';
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          badge,
          'font-semibold uppercase tracking-[0.04em]',
          prd ? 'border-warn-line bg-warn-soft text-warn' : 'border-accent-line bg-accent-soft text-accent',
        )}
      >
        <span className={cn('h-[7px] w-[7px] rounded-full', prd ? 'bg-warn-vivid' : 'bg-accent')} />
        {health.env}
      </span>
      <span className={cn(badge, db ? 'border-ok-line bg-ok-soft text-ok' : 'border-line-strong bg-surface-2 text-muted')}>
        <span className={cn('h-[7px] w-[7px] rounded-full', db ? 'bg-ok-vivid' : 'bg-muted-soft')} />
        DB
      </span>
    </div>
  );
}

/** The mark carries its own colours in the SVG — a blue→violet gradient tile
 * with a white glyph. Painted with a token class instead, a build whose CSS is
 * missing that token renders the tile transparent and the mark disappears.
 * Same composition as the favicon (`src/app/icon.svg`) so the browser tab and
 * the top bar read as one mark. */
function BrandMark() {
  // useId 는 ':' 를 포함한다 — url(#…) 참조에서 탈나지 않도록 걷어낸다.
  const gid = 'tx-mark-' + useId().replace(/:/g, '');
  return (
    <svg aria-hidden width="28" height="28" viewBox="0 0 32 32" className="shrink-0">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill={`url(#${gid})`} />
      {/* 옅은 눈금 — inview 마크의 '기록지' 결 */}
      <g stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1" strokeLinecap="round">
        <line x1="6" y1="9" x2="26" y2="9" />
        <line x1="6" y1="13" x2="26" y2="13" />
        <line x1="6" y1="17" x2="26" y2="17" />
        <line x1="6" y1="21" x2="26" y2="21" />
        <line x1="6" y1="25" x2="26" y2="25" />
      </g>
      {/* 문자 X 비율: 가로보다 세로가 길다 */}
      <g stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round">
        <line x1="10" y1="8" x2="22" y2="24" />
        <line x1="22" y1="8" x2="10" y2="24" />
      </g>
      <g fill="#ffffff">
        <circle cx="10" cy="8" r="1.6" />
        <circle cx="22" cy="8" r="1.6" />
        <circle cx="16" cy="16" r="1.8" />
        <circle cx="10" cy="24" r="1.6" />
        <circle cx="22" cy="24" r="1.6" />
      </g>
    </svg>
  );
}

/**
 * 메뉴 한 줄 — inview 의 `.sidenav-item` 을 그대로 옮긴 치수다.
 *
 * 38px 높이 · 8px 모서리 · 13.5px semibold. 알약처럼 둥근 줄이 목록의 기본형이고,
 * 고른 줄만 면을 얻는다.
 *
 * 아이콘은 색을 바꾸지 않고 투명도만 오간다(.8 → 1). 줄의 글자색이 이미 상태를
 * 말하는데 아이콘까지 따로 칠하면, 고르지 않은 줄에서 글자와 아이콘이 서로 다른
 * 회색으로 갈려 목록이 두 겹으로 읽힌다.
 *
 * 접힌 레일(64px)에서는 아이콘만 가운데 선다. md 아래에서는 펼침과 상관없이 접힌다.
 */
function NavRow({
  item,
  active,
  folded,
  onClick,
}: {
  item: Item;
  active: boolean;
  folded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-[38px] w-full items-center justify-center gap-2.5 rounded-lg text-left',
        'text-[13.5px] font-semibold tracking-[0.2px] transition-colors',
        !folded && 'md:justify-start md:px-2.5',
        active ? 'bg-accent-soft text-accent' : 'text-body hover:bg-surface-3 hover:text-ink',
      )}
    >
      {/* 고른 줄의 표시 막대. 줄 안이 아니라 사이드바 여백(-10px)에 서고, 위아래로
          8px 물러나 모서리가 둥근 줄과 부딪히지 않는다 — 줄에 붙여 놓으면 면과 막대가
          한 덩어리가 되어 막대가 그냥 왼쪽이 두꺼운 면으로 보인다. */}
      {active && (
        <span
          aria-hidden
          className="absolute -left-2.5 bottom-2 top-2 w-[3px] rounded-r-[3px] bg-gradient-to-b from-accent to-chroma-purple"
        />
      )}
      <span className={cn('shrink-0 transition-opacity', active ? 'opacity-100' : 'opacity-80 group-hover:opacity-100')}>
        {item.icon}
      </span>
      {!folded && <span className="hidden min-w-0 flex-1 truncate md:block">{item.label}</span>}
    </button>
  );
}

// 접힘만 기록한다 (기록 없음 = 펼침).
const FOLDED_KEY = 'testx.navFolded';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export default function AppShell({
  section,
  onSelect,
  children,
}: {
  section: SectionId;
  /** Provided by the run page so its four sections switch without a navigation. */
  onSelect?: (id: SectionId) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const [folded, setFolded] = useState(false);

  useEffect(() => {
    try { setFolded(localStorage.getItem(FOLDED_KEY) === '1'); } catch {}
  }, []);

  const toggleFold = useCallback(() => {
    setFolded((v) => {
      try { localStorage.setItem(FOLDED_KEY, v ? '0' : '1'); } catch {}
      return !v;
    });
  }, []);

  // inview 처럼 '[' 로 메뉴를 접고 편다 — 입력 중일 때는 글자로 둔다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      toggleFold();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFold]);

  const go = (item: Item) => {
    if (onSelect && RUN_SECTIONS.includes(item.id) && pathname === '/') onSelect(item.id);
    else router.push(item.href);
  };

  const group = GROUPS.find((g) => g.items.some((i) => i.id === section));

  return (
    <div className="flex h-full flex-col">
      {/* 상단바 — inview `.topbar`: 64px, 흰→#fbfcfe, 아래 머리카락 선 + 옅은 그림자. */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-gradient-to-b from-white to-[#fbfcfe] pl-[14px] pr-[22px] shadow-topbar">
        <button
          type="button"
          onClick={toggleFold}
          aria-label="메뉴 접기/펼치기"
          aria-expanded={!folded}
          title="메뉴 접기/펼치기 ( [ )"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
          </svg>
        </button>
        {/* 브랜드 폭을 사이드바에 맞춰(170 = 232 − 왼 여백·☰·gap 62) 현재 위치가 본문 시작선에서 출발한다. */}
        <button
          type="button"
          onClick={() => router.push('/')}
          className={cn(
            'flex shrink-0 items-center gap-[9px] whitespace-nowrap text-[18px] font-bold tracking-[-0.1px]',
            !folded && 'md:min-w-[170px]',
          )}
        >
          <BrandMark />
          <span className="text-ink">
            Test
            <span className="bg-gradient-to-br from-accent to-chroma-purple bg-clip-text text-transparent">X</span>
          </span>
          <span className="ml-[3px] hidden text-[13px] font-medium tracking-normal text-muted-soft md:inline">· RAGAS Test</span>
        </button>
        {/* 현재 위치 — 그룹 / 화면 (inview .crumb). */}
        {group && (
          <div
            aria-label="현재 위치"
            className="hidden min-w-0 items-center gap-2 whitespace-nowrap border-l border-line pl-4 text-[13px] text-muted md:flex"
          >
            <span>{group.label}</span>
            <span aria-hidden className="text-line-strong">/</span>
            <span className="truncate text-[16px] font-bold tracking-[-0.1px] text-ink">{SECTION_META[section].label}</span>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <StatusBadges />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar — the whole map of the product in one column. inview `.sidenav`: 232px, 접으면 64px 레일. */}
        <aside
          aria-label="주 메뉴"
          className={cn(
            'flex w-16 shrink-0 flex-col gap-2 border-r border-line bg-surface px-2.5 pb-2.5 pt-3',
            !folded && 'md:w-[232px]',
          )}
        >
          {/* 좌우 여백 10px — 고른 줄의 표시 막대가 이 여백에 선다. overflow-x 를 숨기는
              건 세로 스크롤이 생길 때 그 막대까지 가로 스크롤 거리로 세지 않게 하려는 것. */}
          <nav className="-mx-2.5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5">
            {GROUPS.map((g, i) => (
              <div key={g.label}>
                {/* 그룹 이름 — 11px bold, 대문자, 자간 0.6px (inview .sidenav-label).
                    접힌 레일에서는 글자 대신 머리카락 선 하나로 묶음을 가른다. */}
                <div className={cn('px-1.5 pb-1.5', i === 0 ? 'pt-1' : 'pt-2.5', !folded && 'md:hidden')}>
                  <div className="h-px bg-line" />
                </div>
                {!folded && (
                  <p
                    className={cn(
                      'hidden whitespace-nowrap px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.6px] text-muted md:block',
                      i === 0 ? 'pt-1' : 'pt-3',
                    )}
                  >
                    {g.label}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {g.items.map((it) => (
                    <NavRow key={it.id} item={it} active={it.id === section} folded={folded} onClick={() => go(it)} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div
            title={`TestX v${pkg.version}`}
            className={cn(
              'whitespace-nowrap border-t border-line pt-2 text-center text-[10px] leading-[1.4] tracking-[0.2px] text-muted',
              !folded && 'md:px-2.5 md:text-left md:text-[11px]',
            )}
          >
            {!folded && <span className="hidden md:inline">TestX </span>}
            <span className="font-mono">v{pkg.version}</span>
          </div>
        </aside>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">{children}</div>
      </div>
    </div>
  );
}
