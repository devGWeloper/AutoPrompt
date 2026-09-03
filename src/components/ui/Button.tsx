'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  // 6px radius, weight 500, hairline chrome — inview's `.btn`. Never a pill.
  'inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium transition ' +
  'focus:outline-none focus-visible:border-accent focus-visible:shadow-ring ' +
  'disabled:opacity-45 disabled:pointer-events-none disabled:shadow-none';

const variants: Record<Variant, string> = {
  // The blue accent is the conversion colour; secondary sits on white with a
  // hairline, and hover only deepens the grey behind it.
  primary: 'border-accent bg-accent text-accent-fg hover:border-accent-deep hover:bg-accent-deep',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-surface-3',
  ghost: 'border-transparent text-body hover:bg-surface-3 hover:text-ink',
  danger: 'border-bad-line bg-bad-soft text-bad hover:border-bad hover:bg-bad hover:text-white',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[13px]',
  md: 'h-9 px-4 text-sm',
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
