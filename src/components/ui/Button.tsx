'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  // 4px radius, weight 500 — the brand's tight, engineered button geometry.
  // Never a pill, never heavier than semibold.
  'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium tracking-[-0.16px] transition ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:ring-offset-1 ' +
  'disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none';

const variants: Record<Variant, string> = {
  // Near-black is the conversion colour — the chromatic accents are surface
  // fills and never appear as a button background.
  primary: 'bg-primary text-primary-fg hover:bg-ink-strong active:bg-primary',
  secondary: 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-muted hover:bg-surface-3 hover:text-ink',
  danger: 'border border-bad/35 bg-surface text-bad hover:border-bad/60 hover:bg-bad/5',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[13px]',
  md: 'h-9 px-5 text-sm',
  // 카드 하나에 하나뿐인 주 동작(실행/호출)용. 같은 줄의 셀렉트·토글이 모두
  // h-9 라서, 한 단계 큰 이 크기만으로 어디를 눌러야 하는지가 먼저 읽힌다.
  lg: 'h-10 px-6 text-[15px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
