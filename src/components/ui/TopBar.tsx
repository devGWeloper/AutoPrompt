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

/** Prompt-management nav chip (inview nav-agent styling: gradient border +
 * soft tinted background). One button that toggles by location — on the RAGAS
 * home it leads to prompt management, on /nodes pages it leads back home. */
export function PromptsNavChip() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const onPrompts = pathname.startsWith('/nodes');
  return (
    <button
      onClick={() => router.push(onPrompts ? '/' : '/nodes')}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-transparent px-3.5 text-[13px] font-semibold text-ink shadow-sm transition hover:shadow-seg active:translate-y-px"
      style={{
        background:
          'linear-gradient(135deg, #f7f9ff, #faf6ff) padding-box, linear-gradient(135deg, rgba(37,99,235,0.45), rgba(124,58,237,0.45)) border-box',
      }}
    >
      {onPrompts ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="text-accent">
          <path d="M9.5 3.5 5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="text-accent">
          <path d="M9.5 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5.5L9.5 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M9.5 2v3.5H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M5.5 9h5M5.5 11.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      {onPrompts ? 'RAGAS Eval' : 'Prompts'}
    </button>
  );
}

/** App top bar: gradient brand mark + pill nav (inview tone). */
export default function TopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();

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
