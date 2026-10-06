'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * 실행 조건을 '폼' 대신 '화면 머리띠'로 두는 프로토타입(E안)의 뼈대.
 *
 * 조건 네 개가 각자 한 줄을 쓰면 카드가 화면의 절반을 먹고, 결과는 스크롤 아래로
 * 밀린다. 여기서는 48px 한 줄이 값만 이름표와 함께 보여 주고, 실제 컨트롤은
 * 누를 때만 그 아래로 열린다 — 컨트롤 자체는 지금 쓰던 것을 그대로 담으므로
 * 동작이 달라지는 곳은 없다.
 *
 * 임시 코드다. 실제 폼과 토글해서 보기 위한 것이고, 고르고 나면 한쪽을 지운다.
 */

export type FormSkin = 'card' | 'toolbar' | 'cart';

const SKIN_KEY = 'ptx.protoFormSkin';

/** 고른 폼을 새로고침 뒤에도 유지한다 — 두 디자인을 번갈아 보려면 매번 다시
 * 누르게 만들면 안 된다. 첫 렌더는 서버와 같은 값이어야 하므로 effect 에서 읽는다. */
export function useFormSkin(): [FormSkin, (v: FormSkin) => void] {
  const [skin, setSkin] = useState<FormSkin>('card');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SKIN_KEY);
      if (saved === 'toolbar' || saved === 'card' || saved === 'cart') setSkin(saved);
    } catch {
      // 사생활 보호 모드 등 — 기본값으로 둔다.
    }
  }, []);
  const pick = (v: FormSkin) => {
    setSkin(v);
    try { window.localStorage.setItem(SKIN_KEY, v); } catch { /* 저장은 편의일 뿐 */ }
  };
  return [skin, pick];
}

export function FormSkinToggle({ value, onChange }: { value: FormSkin; onChange: (v: FormSkin) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">폼</span>
      <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
        {([['card', '현재'], ['toolbar', 'E · 툴바'], ['cart', 'O · 바구니']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cn(
              'rounded-sm px-3 py-1 text-[13px] font-medium transition-colors',
              value === id ? 'bg-primary text-primary-fg' : 'text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 머리띠 한 줄.
 *
 * 띠 자체는 눌러 둔 면(surface-3)이고 그 위의 칸들이 흰 컨트롤로 뜬다 —
 * 흰 바탕에 흰 칸을 올리면 테두리 한 겹만 남아 띠가 글자 네 덩어리로 보였다.
 * 테두리도 카드보다 한 단 진한 line-strong 을 쓴다: 이 줄은 내용이 아니라
 * 조작하는 자리라서, 결과 카드와 같은 굵기로 두면 같은 종류로 읽힌다.
 */
export function RunToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // 한 줄에 다 들어가면 56px, 좁은 화면에서 접히면 그만큼만 자란다.
        'flex min-h-[56px] flex-wrap items-center gap-x-2 gap-y-1.5',
        'rounded-md border border-line-strong bg-surface-3 px-2.5 py-2 shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarSep() {
  return <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />;
}

/**
 * 머리띠의 한 칸: 작은 이름표 + 지금 값, 누르면 실제 컨트롤이 아래로 열린다.
 *
 * 값을 버튼에 그대로 적는 게 핵심이다 — 셀렉트를 늘어놓으면 값을 읽기 위해 컨트롤
 * 네 개를 훑어야 하는데, 조건은 바꾸는 일보다 확인하는 일이 훨씬 많다.
 */
export function ToolbarMenu({
  label, value, width = 260, muted, lead, badge, children,
}: {
  label: string;
  value: string;
  /** 열리는 판의 너비(px). 모델 표처럼 넓은 것은 늘려 준다. */
  width?: number;
  /** 아직 고르지 않은 값 — 자리만 잡고 있다는 뜻으로 흐리게 적는다. */
  muted?: boolean;
  /** 이 줄에서 가장 중요한 칸(= 무엇을 시험하는가). 네 칸이 같은 무게면 눈이 어디서
   * 시작해야 할지 모른다. */
  lead?: boolean;
  /** 값 뒤에 붙는 작은 수 — 건수처럼 값의 일부가 아니면서 같이 읽혀야 하는 것. */
  badge?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          // 앱의 Select 와 같은 치수·테두리·포커스 — 이 칸은 '열리는 셀렉트' 라서,
          // 생긴 것도 셀렉트와 같아야 눌러 볼 수 있는 것으로 읽힌다.
          'inline-flex h-9 max-w-[340px] items-center gap-2 rounded-sm border px-2.5 transition',
          open
            ? 'border-accent bg-accent-soft shadow-ring'
            : 'border-line-strong bg-surface hover:border-muted-soft',
        )}
      >
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.6px] text-muted">{label}</span>
        <span
          className={cn(
            'truncate',
            lead ? 'text-[14.5px] font-bold' : 'text-[13.5px] font-semibold',
            muted ? 'text-muted-soft' : 'text-ink',
          )}
        >
          {value}
        </span>
        {badge && (
          <span className="inline-flex h-[18px] shrink-0 items-center rounded-full border border-accent-line bg-accent-soft px-1.5 text-[10.5px] font-bold text-accent-deep">
            {badge}
          </span>
        )}
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 self-center text-muted-soft">
          <path d="M4 6.5 8 10.5l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          style={{ width }}
          className="absolute left-0 top-11 z-20 rounded-md border border-line-strong bg-surface p-3 shadow-modal"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** 머리띠 오른쪽 끝의 실행 단추에 붙는 ▶. 버튼 하나뿐인 줄에서 '여기가 시작'을
 * 글자보다 먼저 말한다. */
export function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.8v10.4L13 8z" />
    </svg>
  );
}
