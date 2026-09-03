'use client';

import { Fragment } from 'react';
import { cn } from '@/lib/cn';

/** Segmented tab control: a recessed grey track holding white "keys", the active
 *  one lifted onto the surface in accent blue with a gradient underline —
 *  inview's `.tabnav-group`.
 *  Items marked `group: 'secondary'` are separated from the primary actions
 *  (eval modes) by a hairline divider (datasets / records). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: { id: T; label: string; group?: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  let secondaryStarted = false;
  return (
    <div
      className={cn(
        'inline-flex max-w-full items-stretch gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface-3 p-1',
        className,
      )}
    >
      {items.map((t) => {
        const active = t.id === value;
        const startsSecondary = t.group === 'secondary' && !secondaryStarted;
        if (t.group === 'secondary') secondaryStarted = true;
        return (
          <Fragment key={t.id}>
            {startsSecondary && <span aria-hidden className="mx-1.5 my-1 w-px shrink-0 bg-line-strong" />}
            <button
              onClick={() => onChange(t.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative shrink-0 rounded-sm px-4 py-1.5 text-[13.5px] font-semibold tracking-[0.2px] transition',
                active
                  ? 'bg-surface text-accent shadow-seg'
                  : 'text-muted hover:bg-surface hover:text-ink',
              )}
            >
              {t.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3.5 -bottom-1 h-0.5 rounded-full bg-gradient-to-r from-accent to-chroma-purple"
                />
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
