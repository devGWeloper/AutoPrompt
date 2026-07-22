import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'bad' | 'purple';

const tones: Record<Tone, string> = {
  neutral: 'bg-bg text-muted border-line',
  accent: 'bg-accent/10 text-accent border-accent/20',
  ok: 'bg-ok/10 text-ok border-ok/20',
  bad: 'bg-bad/10 text-bad border-bad/20',
  // = inview .qmodel chip (#7c3aed at an 11%-ish tint)
  purple: 'bg-[#7c3aed]/10 text-[#7c3aed] border-[#7c3aed]/20',
};

const dots: Record<Tone, string> = {
  neutral: 'bg-muted',
  accent: 'bg-accent',
  ok: 'bg-ok',
  bad: 'bg-bad',
  purple: 'bg-[#7c3aed]',
};

/** Pill badge (fully rounded). `dot` prepends a small status dot (inview style). */
export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}
