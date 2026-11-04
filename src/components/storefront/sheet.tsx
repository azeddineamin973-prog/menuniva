'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Bottom sheet (phones) / centred card (larger screens). Behaves as a modal dialog: focus moves
 * into it and back to the dish or cart button afterwards, Tab stays inside, Escape and the
 * backdrop close it, and the menu behind does not scroll.
 */
export function Sheet({ children, onClose, label, closeLabel, panelRef, wide = false, testId }: { children: React.ReactNode; onClose: () => void; label: string; closeLabel: string; panelRef?: React.RefObject<HTMLDivElement | null>; wide?: boolean; testId?: string }) {
  const own = useRef<HTMLDivElement>(null);
  const panel = panelRef ?? own;
  // Always the latest onClose, without re-running the effect (which would move the focus).
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea')];
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
      {/* Tapping outside closes the sheet; keyboard and screen-reader users have Escape and the close button. */}
      <button type="button" aria-hidden tabIndex={-1} title={closeLabel} className="animate-fade-in absolute inset-0 bg-black/45 backdrop-blur-[2px] motion-reduce:animate-none" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={cn(
          'animate-slide-up relative max-h-[94dvh] w-full overflow-y-auto overscroll-contain rounded-t-[1.75rem] bg-sf-bg shadow-2xl outline-none motion-reduce:animate-none sm:rounded-[1.75rem]',
          wide ? 'sm:max-w-xl lg:max-w-4xl lg:overflow-hidden' : 'max-w-lg sm:max-w-xl',
        )}
      >
        {/* Grab handle: shows on phones that this is a sheet over the menu. */}
        <span aria-hidden className="pointer-events-none absolute start-1/2 top-2 z-20 h-1 w-10 -translate-x-1/2 rounded-full bg-white/70 shadow-sm ring-1 ring-black/10 sm:hidden rtl:translate-x-1/2" />
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClick, label, className, testId = 'sheet-close' }: { onClick: () => void; label: string; className?: string; testId?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn('flex size-10 items-center justify-center rounded-full bg-sf-card/95 text-xl leading-none shadow-md ring-1 ring-sf-text/10 backdrop-blur transition-transform hover:scale-105 motion-reduce:transition-none', className)} data-testid={testId}>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
