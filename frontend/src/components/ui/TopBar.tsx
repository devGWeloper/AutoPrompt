'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: '플로우 그래프', href: '/', match: (p) => p === '/' },
  { label: '버전 이력', href: '/versions', match: (p) => p.startsWith('/versions') },
  { label: '전체 테스트', href: '/flow', match: (p) => p.startsWith('/flow') },
];

export default function TopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';

  return (
    <header className="border-b-2 border-slate-300 bg-white">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <button
            onClick={() => router.push('/')}
            className="text-lg font-extrabold tracking-tight text-slate-900"
          >
            AutoPrompt
          </button>
          <nav className="flex items-center gap-2">
            {NAV.map((n) => {
              const active = n.match(pathname);
              return (
                <button
                  key={n.href}
                  onClick={() => router.push(n.href)}
                  className={
                    'rounded-md px-4 py-2 text-sm font-bold transition ' +
                    (active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
                  }
                >
                  {n.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {title && <span className="text-sm font-semibold text-slate-500">{title}</span>}
          {right}
        </div>
      </div>
    </header>
  );
}
