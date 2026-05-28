import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Surface panel with hairline border. Add padding at the call site (`p-4` etc.);
    left unpadded so tables can sit edge-to-edge. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)}>{children}</div>;
}
