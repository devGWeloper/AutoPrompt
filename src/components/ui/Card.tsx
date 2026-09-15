import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Panel surface at 8px radius with a hairline border and the barely-there
    level-1 lift — inview's `.panel` / `.dash-card`. Add padding at the call site
    (`p-4` etc.); left unpadded so tables can sit edge-to-edge.
    `tone="muted"` recesses the panel below the white canvas — used for
    control/settings strips so result cards read as the live surface.
    `tone="dark"` is the polarity-flipped near-black card. */
export function Card({
  className,
  tone = 'surface',
  children,
}: {
  className?: string;
  tone?: 'surface' | 'muted' | 'dark';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-md border shadow-card',
        tone === 'muted' && 'border-line bg-surface-2',
        tone === 'dark' && 'border-ink-strong bg-ink-strong text-white',
        tone === 'surface' && 'border-line bg-surface',
        className,
      )}
    >
      {children}
    </div>
  );
}
