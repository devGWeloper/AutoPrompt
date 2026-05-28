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
  return (
    <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
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
    <th colSpan={colSpan} className={cn('px-3 py-2 font-medium', className)}>
      {children}
    </th>
  );
}

export function TD({
  className,
  colSpan,
  children,
}: {
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  return (
    <td colSpan={colSpan} className={cn('px-3 py-2.5 align-top', className)}>
      {children}
    </td>
  );
}
