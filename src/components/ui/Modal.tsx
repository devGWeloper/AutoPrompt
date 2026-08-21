'use client';

import { useEffect, type ReactNode } from 'react';

export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Esc 는 닫는다. 바깥 클릭은 닫지 않는다 — 여기 뜨는 창은 전부 입력 폼이고,
  // 스크롤/드래그가 살짝 빗나간 클릭 한 번에 작성 중이던 내용이 사라졌다.
  // 닫는 길은 ✕ · 취소 · Esc 셋 다 명시적이다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,8,8,0.5)] p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Level 4 elevation — the heavy multi-stop drop reserved for dialogs. */}
      <div className="w-[600px] max-w-full rounded-md border border-line bg-surface shadow-modal">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-display-xs text-ink">{title}</h2>
          {/* Circular icon container — the one place the brand uses a pill radius. */}
          <button
            onClick={onClose}
            aria-label="Close"
            title="닫기 (Esc)"
            className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
