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

// 'chip' — the run forms' look, TraceX 필터의 ACTION_TYP 셀렉트(.flt-field): 흰 면 ·
// 진한 한 줄 테두리 · 8px 모서리 · 34px, 화살표는 직접 그린다(브라우저 기본 화살표는
// 칸 끝에 딱 붙는다).
const chipBase =
  'h-[34px] appearance-none rounded-[8px] border border-line-strong bg-surface bg-no-repeat pl-[11px] pr-8 text-[13.5px] text-ink ' +
  'transition-[border-color,box-shadow] duration-100 hover:border-muted-soft focus:outline-none focus:border-accent focus:shadow-ring ' +
  'disabled:opacity-50 disabled:bg-surface-2';
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a929c' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")";

export function Select({
  className,
  children,
  variant = 'field',
  style,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { variant?: 'field' | 'chip' }) {
  if (variant === 'chip') {
    return (
      <select
        className={cn(chipBase, className)}
        style={{ backgroundImage: CHEVRON, backgroundPosition: 'right 10px center', backgroundSize: '12px 12px', ...style }}
        {...props}
      >
        {children}
      </select>
    );
  }
  return (
    <select className={cn(fieldBase, 'h-9 px-2.5', className)} style={style} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'px-3 py-2.5 leading-relaxed', className)} {...props} />;
}
