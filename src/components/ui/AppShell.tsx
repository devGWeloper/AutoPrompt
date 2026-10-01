'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import pkg from '../../../package.json';

/**
 * App shell: one sidebar carries every destination in the product, so there is a
 * single place to look for where to go instead of a top nav and an in-page tab
 * strip competing to answer it.
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
    label: '실행',
    items: [
      { id: 'single', label: '단일 실행', href: '/?section=single', icon: ICONS.single },
      { id: 'compare', label: 'A · B 비교', href: '/?section=compare', icon: ICONS.compare },
    ],
  },
  {
    label: '데이터',
    items: [
      { id: 'datasets', label: '데이터셋', href: '/?section=datasets', icon: ICONS.datasets },
      { id: 'records', label: '실행 기록', href: '/?section=records', icon: ICONS.records },
    ],
  },
  {
    label: '관리',
    items: [
      { id: 'prompts', label: '프롬프트', href: '/nodes', icon: ICONS.prompts },
      { id: 'settings', label: '설정', href: '/settings', icon: ICONS.settings },
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

/** Environment and DB state as two dots — the sidebar foot says what this app is
 * talking to without a sentence about it. Set in inview's status-bar register:
 * small, tracked, grey, with the version in mono at the far end. */
function StatusFoot() {
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
  return (
    <div className="flex items-center gap-2.5 border-t border-line bg-surface-2 px-4 py-2.5 text-[12px] tracking-[0.2px]">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.5px]',
          prd ? 'border-warn-line bg-warn-soft text-warn' : 'border-accent-line bg-accent-soft text-accent',
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', prd ? 'bg-warn-vivid' : 'bg-accent')} />
        {health.env}
      </span>
      <span aria-hidden className="h-3 w-px bg-line-strong" />
      <span className={cn('inline-flex items-center gap-1.5', db ? 'text-ok' : 'text-muted-soft')}>
        <span className={cn('h-1.5 w-1.5 rounded-full', db ? 'bg-ok-vivid' : 'bg-muted-soft')} />
        DB
      </span>
      <span className="ml-auto font-mono text-caption-mono text-muted-soft">v{pkg.version}</span>
    </div>
  );
}

/** The mark carries its own colours in the SVG — a blue→violet gradient tile
 * with a white glyph. Painted with a token class instead, a build whose CSS is
 * missing that token renders the tile transparent and the mark disappears.
 * Same composition as the favicon (`src/app/icon.svg`) so the browser tab and
 * the sidebar read as one mark. */
function BrandMark() {
  // 사이드바와 모바일 레일이 둘 다 DOM 에 있어서, 그라데이션 id 는 인스턴스마다 달라야 한다.
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
 */
function NavRow({
  item,
  active,
  compact,
  onClick,
}: {
  item: Item;
  active: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-[38px] items-center gap-2.5 rounded-lg px-2.5 text-left',
        'text-[13.5px] font-semibold tracking-[0.2px] transition-colors',
        compact ? 'shrink-0' : 'w-full',
        active ? 'bg-accent-soft text-accent' : 'text-body hover:bg-surface-3 hover:text-ink',
      )}
    >
      {/* 고른 줄의 표시 막대. 줄 안이 아니라 사이드바 여백(-10px)에 서고, 위아래로
          8px 물러나 모서리가 둥근 줄과 부딪히지 않는다 — 줄에 붙여 놓으면 면과 막대가
          한 덩어리가 되어 막대가 그냥 왼쪽이 두꺼운 면으로 보인다.
          레일에서는 줄이 가로로 늘어서므로 왼쪽 막대가 뜻을 잃어 서지 않는다. */}
      {active && !compact && (
        <span
          aria-hidden
          className="absolute -left-2.5 bottom-2 top-2 w-[3px] rounded-r-[3px] bg-gradient-to-b from-accent to-chroma-purple"
        />
      )}
      <span className={cn('shrink-0 transition-opacity', active ? 'opacity-100' : 'opacity-80 group-hover:opacity-100')}>
        {item.icon}
      </span>
      {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    </button>
  );
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

  const go = (item: Item) => {
    if (onSelect && RUN_SECTIONS.includes(item.id) && pathname === '/') onSelect(item.id);
    else router.push(item.href);
  };

  return (
    <div className="flex h-full">
      {/* Sidebar — the whole map of the product in one column. */}
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line bg-surface md:flex">
        <button
          onClick={() => router.push('/')}
          className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-[#fbfcfe] px-4"
        >
          <BrandMark />
          <span className="text-[18px] font-bold tracking-[-0.1px] text-ink">
            Test
            <span className="bg-gradient-to-br from-accent to-chroma-purple bg-clip-text text-transparent">X</span>
          </span>
        </button>
        {/* 좌우 여백 10px — 고른 줄의 표시 막대가 이 여백에 선다. overflow-x 를 숨기는
            건 세로 스크롤이 생길 때 그 막대까지 가로 스크롤 거리로 세지 않게 하려는 것. */}
        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2.5 pt-1">
          {GROUPS.map((g, i) => (
            <div key={g.label} className={i === 0 ? 'pt-1' : 'pt-3'}>
              {/* 그룹 이름 — 11px bold, 대문자, 자간 0.6px (inview .sidenav-label). */}
              <p className="whitespace-nowrap px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.6px] text-muted">
                {g.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {g.items.map((it) => (
                  <NavRow key={it.id} item={it} active={it.id === section} onClick={() => go(it)} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <StatusFoot />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Below md the same rows become one icon rail across the top. */}
        <div className="flex items-center gap-1 border-b border-line bg-surface px-3 py-2 shadow-topbar md:hidden">
          <BrandMark />
          <div className="ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {ALL_ITEMS.map((it) => (
              <NavRow key={it.id} item={it} active={it.id === section} compact onClick={() => go(it)} />
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">{children}</div>
      </div>
    </div>
  );
}
