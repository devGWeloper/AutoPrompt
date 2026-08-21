import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'purple';

// Soft badges: canvas surface, hairline chrome, coloured label — the brand's
// `badge-info-soft`. Set in the signature 12.8px / weight 550 caption.
const tones: Record<Tone, string> = {
  neutral: 'bg-surface text-muted border-line',
  accent: 'bg-accent/[0.07] text-accent border-accent/25',
  ok: 'bg-ok/[0.07] text-ok border-ok/25',
  warn: 'bg-warn/[0.07] text-warn border-warn/25',
  bad: 'bg-bad/[0.07] text-bad border-bad/25',
  purple: 'bg-chroma-purple/[0.07] text-chroma-purple border-chroma-purple/25',
};

// Dots use the full-saturation stop of each hue.
const dots: Record<Tone, string> = {
  neutral: 'bg-muted',
  accent: 'bg-accent',
  ok: 'bg-ok-vivid',
  warn: 'bg-warn-vivid',
  bad: 'bg-bad-vivid',
  purple: 'bg-chroma-purple',
};

/** Badge at the brand's 4px radius (pill is reserved for circular icons).
 *  `dot` prepends a small status dot. */
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
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-caption',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}
