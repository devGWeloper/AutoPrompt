import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Card surface at the brand's 8px radius. Level 1 elevation is the hairline
    border alone — no shadow — so panels read as engineered rather than material.
    Add padding at the call site (`p-4` etc.); left unpadded so tables can sit
    edge-to-edge. `tone="muted"` recesses the panel below the white canvas —
    used for control/settings strips so result cards read as the live surface.
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
        'rounded-md border',
        tone === 'muted' && 'border-line bg-surface-2',
        tone === 'dark' && 'border-primary bg-primary text-primary-fg',
        tone === 'surface' && 'border-line bg-surface',
        className,
      )}
    >
      {children}
    </div>
  );
}
