'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { buttonClass } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import type { Cta } from './ui';

/**
 * Phone and tablet navigation for the landing page: a panel under the sticky header. Closes on a
 * link tap, Escape, a tap outside, or when the screen grows to the desktop layout.
 */
export function MobileMenu({ links, cta, showSignIn }: { links: readonly { href: string; label: string }[]; cta: Cta; showSignIn: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onResize = () => desktop.matches && setOpen(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    desktop.addEventListener('change', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      desktop.removeEventListener('change', onResize);
    };
  }, [open]);

  return (
    <div ref={root} className="lg:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
        className="flex size-10 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        data-testid="landing-menu-button"
      >
        <Icon name={open ? 'x' : 'menu'} className="size-5" />
      </button>
      {/* Positioned against the sticky header, so it spans the full width under it. */}
      <div id={panelId} hidden={!open} className="absolute inset-x-0 top-full animate-pop-in border-b border-line bg-bg shadow-lg">
        <nav aria-label="Main" className="mx-auto max-w-6xl px-4 pt-2 pb-5 sm:px-6">
          <ul className="grid gap-0.5">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center justify-between rounded-lg px-3 text-[15px] font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  {l.label}
                  <Icon name="chevronRight" className="size-4 text-muted" />
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
            {showSignIn && (
              <Link href="/login" onClick={() => setOpen(false)} className={buttonClass('secondary', 'lg', 'w-full')}>
                Sign in
              </Link>
            )}
            <Link href={cta.href} onClick={() => setOpen(false)} className={buttonClass('primary', 'lg', 'w-full')}>
              {cta.label}
            </Link>
          </div>
        </nav>
      </div>
    </div>
  );
}
