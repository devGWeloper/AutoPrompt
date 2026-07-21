'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Environment pill (inview .env-badge): dev = blue tint, prd = amber tint. */
function EnvBadge() {
  const [env, setEnv] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { env?: string } | null) => setEnv(d?.env ?? null))
      .catch(() => {});
  }, []);
  if (!env) return null;
  const prd = env === 'prd';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.04em]',
        prd
          ? 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
          : 'border-[#bfdbfe] bg-[#eff6ff] text-accent',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', prd ? 'bg-[#b45309]' : 'bg-accent')} />
      {env}
    </span>
  );
}

const NAV: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: 'RAGAS Eval', href: '/', match: (p) => p === '/' },
  { label: 'Prompts', href: '/nodes', match: (p) => p.startsWith('/nodes') },
];

/** App top bar: gradient brand mark + pill nav (inview tone). */
export default function TopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';

  return (
    <header className="border-b border-line bg-gradient-to-b from-surface to-[#fbfcfe] shadow-[0_1px_0_rgba(17,24,39,0.02),0_10px_22px_-20px_rgba(17,24,39,0.25)]">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-7">
          <button onClick={() => router.push('/')} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#2563eb] to-[#7c3aed] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_8px_rgba(37,99,235,0.35)]"
            >
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path
                  d="M4 17 L10 11 L14 14 L20 6"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="4" cy="17" r="1.7" fill="#fff" />
                <circle cx="20" cy="6" r="1.7" fill="#fff" />
              </svg>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-base font-bold tracking-tight text-ink">AutoPrompt</span>
              <span className="hidden text-xs font-medium text-muted sm:inline">· Prompt Management</span>
            </span>
          </button>
          <nav className="flex items-center gap-0.5 rounded-[9px] border border-line bg-surface p-1">
            {NAV.map((n) => {
              const active = n.match(pathname);
              return (
                <button
                  key={n.href}
                  onClick={() => router.push(n.href)}
                  className={cn(
                    'rounded-sm px-4 py-1.5 text-[13.5px] font-semibold tracking-[0.2px] transition-colors',
                    active
                      ? 'bg-accent text-accent-fg shadow-sm'
                      : 'text-muted hover:bg-surface-3 hover:text-ink',
                  )}
                >
                  {n.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {title && <span className="text-sm text-muted">{title}</span>}
          {right}
          <EnvBadge />
        </div>
      </div>
    </header>
  );
}
