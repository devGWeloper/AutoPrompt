'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';

interface HealthData {
  env?: string;
  dbConnected?: boolean;
}

/** Status badges: dev/prd pill + DB connection status pill (inview style). */
function StatusBadges() {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HealthData | null) => setHealth(d ?? null))
      .catch(() => {});
  }, []);

  if (!health || !health.env) return null;
  const prd = health.env === 'prd';
  const dbConnected = !!health.dbConnected;

  return (
    <div className="flex items-center gap-2">
      {/* Environment Badge */}
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]',
          prd
            ? 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
            : 'border-[#bfdbfe] bg-[#eff6ff] text-accent',
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', prd ? 'bg-[#b45309]' : 'bg-accent')} />
        {health.env}
      </span>

      {/* DB Connection Status Badge */}
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.02em]',
          dbConnected
            ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
            : 'border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]',
        )}
        title={dbConnected ? 'Oracle DB Connected' : 'DB Not Configured (Running in Mock / Fallback Mode)'}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', dbConnected ? 'bg-[#16a34a]' : 'bg-[#94a3b8]')} />
        {dbConnected ? 'DB Connected' : 'DB Mock'}
      </span>
    </div>
  );
}

/** Top-level section nav (inview .tabnav-group): segmented control next to the
 * brand — both sections always visible, active one raised on a white surface. */
function SectionNav({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const onPrompts = pathname.startsWith('/nodes');
  // No Models entry: which model a run uses is part of that run, so it is asked
  // inside the Single / Compare forms. A section of its own read as a second,
  // competing place to set the same thing.
  const items = [
    { href: '/', label: 'Test', active: !onPrompts },
    { href: '/nodes', label: 'Prompts', active: onPrompts },
  ];
  return (
    <nav className={cn('inline-flex h-9 items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-1', className)}>
      {items.map((it) => (
        <button
          key={it.href}
          onClick={() => router.push(it.href)}
          className={cn(
            'inline-flex h-full items-center rounded-md px-3.5 text-[13px] font-semibold transition-colors',
            it.active
              ? 'bg-surface text-accent shadow-[0_1px_2px_rgba(17,24,39,0.10),0_0_0_1px_rgba(37,99,235,0.08)]'
              : 'text-muted hover:bg-surface hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}

/** Brand mark: a score gauge — track arc, the scored portion of it, and the
 * needle. The name is about the score a run comes back with, so the mark says
 * that rather than the generic rising line it replaced. */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#2563eb] to-[#4f46e5] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_2px_8px_rgba(37,99,235,0.28)]"
    >
      <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
        <path
          d="M4.6 16.6 A7.6 7.6 0 0 1 19.4 16.6"
          stroke="#fff"
          strokeOpacity="0.42"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M4.6 16.6 A7.6 7.6 0 0 1 16.9 10.4"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path d="M12 16.6 L15.4 11.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** App top bar: gradient brand mark + pill nav (inview tone). */
export default function TopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();

  return (
    <header className="border-b border-line bg-gradient-to-b from-surface to-[#fbfcfe] shadow-[0_1px_0_rgba(17,24,39,0.02),0_10px_22px_-20px_rgba(17,24,39,0.25)]">
      {/* Bar spans the window; its contents line up with the page below. */}
      <div className={cn(SHELL, 'relative flex h-16 items-center justify-between gap-4 px-6')}>
        <button onClick={() => router.push('/')} className="flex items-center gap-2.5">
          <BrandMark />
          <span className="flex items-baseline gap-1.5">
            {/* The X carries the accent so the wordmark has one point of colour
                without turning the whole name blue. */}
            <span className="whitespace-nowrap text-base font-bold tracking-tight text-ink">
              Score<span className="text-accent">X</span>
            </span>
            {/* What the app does, as a subtitle — it only appears once there is
                room for it beside the centred section nav. */}
            <span className="hidden whitespace-nowrap text-xs font-medium text-muted lg:inline">· AI Agent Test</span>
          </span>
        </button>

        {/* Centred on the bar itself rather than on the gap between the brand and
            the badges, so the tabs hold their place however wide those two grow.
            Below `md` there is nothing to centre into — it just trails the brand. */}
        <SectionNav className="md:absolute md:left-1/2 md:-translate-x-1/2" />

        <div className="flex items-center gap-3">
          {title && <span className="text-sm text-muted">{title}</span>}
          {right}
          <StatusBadges />
        </div>
      </div>
    </header>
  );
}
