import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'bad';

const tones: Record<Tone, string> = {
  neutral: 'bg-bg text-muted border-line',
  accent: 'bg-accent/10 text-accent border-accent/20',
  ok: 'bg-ok/10 text-ok border-ok/20',
  bad: 'bg-bad/10 text-bad border-bad/20',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
