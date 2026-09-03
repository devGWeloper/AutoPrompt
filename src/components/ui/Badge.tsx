import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'fail' | 'purple';

// Status pills: a solid soft tint, a matching hairline and the legible stop of
// the same hue as the label — inview's `.pill`. Solid tints, no alpha, so the
// fill still lands on a browser without CSS Color 4.
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent-line',
  ok: 'bg-ok-soft text-ok border-ok-line',
  warn: 'bg-warn-soft text-warn border-warn-line',
  bad: 'bg-bad-soft text-bad border-bad-line',
  fail: 'bg-fail-soft text-fail border-fail-line',
  purple: 'bg-[#f1e9ff] text-chroma-purple border-[#ddc9fb]',
};

// Dots use the full-saturation stop of each hue.
const dots: Record<Tone, string> = {
  neutral: 'bg-muted-soft',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  fail: 'bg-fail',
  purple: 'bg-chroma-purple',
};

/** Pill-shaped status badge. `dot` prepends a small status dot. */
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
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-caption',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}
