import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-separate border-spacing-0 text-[14.5px]', className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  // The header is a recessed strip carrying an uppercase, positively-tracked
  // eyebrow over a hairline rule — inview's `.trace-list thead th`.
  return (
    <thead className="bg-surface-2 text-left text-caption uppercase tracking-[0.7px] text-muted">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="[&>tr:hover]:bg-surface-2">{children}</tbody>;
}

export function TR({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors', className)} {...rest}>
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
    <th
      colSpan={colSpan}
      className={cn('whitespace-nowrap border-b border-line px-4 py-2.5 font-semibold', className)}
    >
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
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      title={title}
      className={cn('border-b border-line px-4 py-2.5 align-top', className)}
    >
      {children}
    </td>
  );
}
