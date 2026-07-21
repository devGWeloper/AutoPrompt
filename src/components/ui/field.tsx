import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

// No default width — callers set it (`w-full` to fill, or a fixed `w-44` etc.).
const fieldBase =
  // 6px radius + border-strong = inview filter inputs
  'rounded-sm border border-line-strong bg-surface text-sm text-ink placeholder:text-muted transition ' +
  'focus:outline-none focus:border-accent focus:shadow-ring ' +
  'disabled:opacity-50';

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
