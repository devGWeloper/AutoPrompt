'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { SystemConfig } from '@/types';

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
          <TestToggle />
          {right}
        </div>
      </div>
    </header>
  );
}

function TestToggle() {
  const [enabled, setEnabled] = useState<'Y' | 'N' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<SystemConfig>('/system-config')
      .then((r) => setEnabled(r.enabled_yn))
      .catch(() => setEnabled(null));
  }, []);

  async function toggle() {
    if (enabled === null || busy) return;
    setBusy(true);
    try {
      const next: 'Y' | 'N' = enabled === 'Y' ? 'N' : 'Y';
      const r = await api.put<SystemConfig>('/system-config', { enabled_yn: next });
      setEnabled(r.enabled_yn);
    } catch {
      // keep previous state on error
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  const on = enabled === 'Y';
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={on ? '테스트 모드 켜짐 — 클릭하면 끔' : '테스트 모드 꺼짐 — 클릭하면 켬'}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
        'disabled:opacity-60',
        on
          ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/15'
          : 'border-line bg-surface text-muted hover:text-ink',
      )}
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          on ? 'bg-accent' : 'bg-muted/50',
        )}
      />
      TEST {on ? 'ON' : 'OFF'}
    </button>
  );
}
