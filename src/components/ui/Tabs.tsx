'use client';

import { Fragment } from 'react';
import { cn } from '@/lib/cn';

/** Segmented tab control (inview style): a rounded track with a raised white pill
 *  for the active tab. Items marked `group: 'secondary'` are separated from the
 *  primary actions (eval modes) by a hairline divider (datasets / records). */
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
        // White track, grey hover = inview .btn idiom (surface base, surface-3
        // hover); active stays accent-filled per user preference.
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[9px] border border-line bg-surface p-1',
        className,
      )}
    >
      {items.map((t) => {
        const active = t.id === value;
        const startsSecondary = t.group === 'secondary' && !secondaryStarted;
        if (t.group === 'secondary') secondaryStarted = true;
        return (
          <Fragment key={t.id}>
            {startsSecondary && <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 self-center bg-line-strong" />}
            <button
              onClick={() => onChange(t.id)}
              className={cn(
                'shrink-0 rounded-sm px-3.5 py-1.5 text-[13.5px] font-semibold tracking-[0.2px] transition',
                active
                  ? 'bg-accent text-accent-fg shadow-sm'
                  : 'text-muted hover:bg-surface-3 hover:text-ink',
              )}
            >
              {t.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
