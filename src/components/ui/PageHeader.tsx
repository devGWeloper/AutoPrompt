import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The bar at the top of every screen: the name of the screen and its actions,
 * over a hairline. Nothing else — the sidebar already says which section you are
 * in, so repeating it here (a group label, a colour chip) was decoration.
 */
export default function PageHeader({
  title,
  right,
  className,
}: {
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex items-center justify-between gap-4 border-b border-line pb-3.5', className)}>
      <h1 className="min-w-0 truncate text-display-lg text-ink">{title}</h1>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}
