'use client';

import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Accessible modal for the dashboard: a bottom sheet on phones, a centred card on larger
 * screens. Escape and the backdrop close it, focus moves inside on open and returns to the
 * element that opened it, and the page behind does not scroll.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  testId,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Keep Tab inside the dialog.
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const target = panel.current?.querySelector<HTMLElement>('[autofocus], textarea, input, select') ?? panel.current;
    target?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testId}>
      <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={cn('relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-xl outline-none sm:max-w-md sm:rounded-3xl', className)}
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
