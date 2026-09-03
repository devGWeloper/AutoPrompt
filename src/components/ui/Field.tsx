import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

// No default width — callers set it (`w-full` to fill, or a fixed `w-44` etc.).
// 6px radius + a slightly stronger hairline than a card's, and focus turns the
// border blue under a 3px blue halo — inview's `.filter-grid input:focus`.
const fieldBase =
  'rounded-sm border border-line-strong bg-surface text-sm text-ink placeholder:text-muted-soft transition ' +
  'hover:border-muted-soft focus:outline-none focus:border-accent focus:shadow-ring ' +
  'disabled:opacity-50 disabled:bg-surface-2 disabled:hover:border-line-strong';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-9 px-3', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'h-9 px-2.5', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'px-3 py-2.5 leading-relaxed', className)} {...props} />;
}
