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

/** The one header every card uses: title, then the facts about what is in the
    card (badges, names) in muted small text, then the card's own actions pushed
    to the far end. Same height and padding on every screen, so cards stacked on
    one page — and cards on different pages — start their content on one line. */
export function CardHeader({
  title,
  children,
  right,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-[3.25rem] flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-muted', className)}>
      <h3 className="mr-1 text-sm font-semibold text-ink">{title}</h3>
      {children}
      {right && <span className="ml-auto flex items-center gap-2">{right}</span>}
    </div>
  );
}
