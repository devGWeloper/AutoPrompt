import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Surface panel with hairline border + soft shadow. Add padding at the call site
    (`p-4` etc.); left unpadded so tables can sit edge-to-edge. `tone="muted"`
    recesses the panel to the page background — used for control/settings strips so
    white `surface` cards (results) read as elevated above them. */
export function Card({
  className,
  tone = 'surface',
  children,
}: {
  className?: string;
  tone?: 'surface' | 'muted';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        // 8px radius = inview .panel
        'rounded-md border border-line',
        tone === 'muted' ? 'bg-bg' : 'bg-surface shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}
