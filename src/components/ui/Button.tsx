'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const base =
  // 6px radius + border-strong controls = inview .btn
  'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 ' +
  'active:translate-y-px disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-sm hover:brightness-[1.06] active:brightness-100',
  secondary: 'border border-line-strong bg-surface text-ink shadow-sm hover:bg-surface-3',
  ghost: 'text-muted hover:bg-surface-3 hover:text-ink',
  danger: 'border border-bad/30 bg-surface text-bad shadow-sm hover:border-bad/50 hover:bg-bad/10',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-xs',
  md: 'h-9 px-4 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
