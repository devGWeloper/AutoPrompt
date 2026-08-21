import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

// No default width — callers set it (`w-full` to fill, or a fixed `w-44` etc.).
// 4px radius + hairline chrome = the brand's `text-input`; focus darkens the
// border to ink rather than colouring it, keeping the accent hues for surfaces.
const fieldBase =
  'rounded-sm border border-line bg-surface text-sm text-ink placeholder:text-muted-soft transition ' +
  'hover:border-line-strong focus:outline-none focus:border-ink focus:shadow-ring ' +
  'disabled:opacity-50 disabled:hover:border-line';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-10 px-3.5', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'h-10 px-3', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'px-3.5 py-2.5 leading-relaxed', className)} {...props} />;
}
