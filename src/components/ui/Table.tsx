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
  // Recessed surface-2 strip = inview .trace-list thead
  return (
    <thead className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  // Row hover = inview .trace-list tbody tr:hover
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
    <th colSpan={colSpan} className={cn('px-3.5 py-2.5 font-semibold', className)}>
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
    <td colSpan={colSpan} rowSpan={rowSpan} title={title} className={cn('px-3.5 py-3 align-top', className)}>
      {children}
    </td>
  );
}
