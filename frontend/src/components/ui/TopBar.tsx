'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const NAV: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: 'RAGAS 평가', href: '/', match: (p) => p === '/' },
  { label: '프롬프트 관리', href: '/nodes', match: (p) => p.startsWith('/nodes') },
];

export default function TopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';

  return (
    <header className="border-b border-line bg-surface">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <button
            onClick={() => router.push('/')}
            className="text-sm font-semibold tracking-tight text-ink"
          >
            AutoPrompt
          </button>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => {
              const active = n.match(pathname);
              return (
                <button
                  key={n.href}
                  onClick={() => router.push(n.href)}
                  className={cn(
                    'relative px-3 py-2 text-sm font-medium transition-colors',
                    active ? 'text-ink' : 'text-muted hover:text-ink',
                  )}
                >
                  {n.label}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {title && <span className="text-sm text-muted">{title}</span>}
          {right}
        </div>
      </div>
    </header>
  );
}
