import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm', className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  // Header sits on the canvas and is marked by an uppercase, positively-tracked
  // eyebrow over a hairline rule — the brand's data-table chrome.
  return (
    <thead className="border-b border-line bg-surface text-left text-[11.5px] font-[550] uppercase tracking-[0.6px] text-muted">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="[&>tr:hover]:bg-surface-2">{children}</tbody>;
}

export function TR({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-line last:border-0', className)} {...rest}>
      {children}
    </tr>
  );
}

export function TH({
  className,
  colSpan,
  children,
}: {
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  return (
    <th colSpan={colSpan} className={cn('px-4 py-2.5 font-[550]', className)}>
      {children}
    </th>
  );
}

export function TD({
  className,
  colSpan,
  rowSpan,
  title,
  children,
}: {
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} title={title} className={cn('px-4 py-3 align-top', className)}>
      {children}
    </td>
  );
}
