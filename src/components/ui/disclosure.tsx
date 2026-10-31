'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icons';

/**
 * Progressive disclosure for settings that are rarely changed: a card whose body opens on demand.
 * Uses <details>, so it works without JavaScript and keeps form state when toggled.
 */
export function Disclosure({ title, description, icon, defaultOpen = false, children, className, testId }: { title: ReactNode; description?: ReactNode; icon?: IconName; defaultOpen?: boolean; children: ReactNode; className?: string; testId?: string }) {
  // Only the first render decides: saving a form inside (which re-renders the page) never
  // collapses it under the owner's hands.
  const [initial] = useState(defaultOpen);
  return (
    <details open={initial} className={cn('group rounded-[var(--radius-card)] border border-line bg-surface shadow-xs', className)} data-testid={testId}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 hover:bg-surface-2/40 sm:px-5 [&::-webkit-details-marker]:hidden">
        {icon && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2" aria-hidden>
            <Icon name={icon} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{title}</span>
          {description && <span className="block text-[13px] text-muted">{description}</span>}
        </span>
        <Icon name="chevronDown" className="shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-line p-4 sm:p-5">{children}</div>
    </details>
  );
}

