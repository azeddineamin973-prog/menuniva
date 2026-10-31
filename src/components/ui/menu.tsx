'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icons';

export type MenuItem =
  | { type?: 'link'; label: string; href: string; icon?: IconName; external?: boolean; hint?: string }
  | { type: 'button'; label: string; onSelect: () => void; icon?: IconName; danger?: boolean; hint?: string }
  | { type: 'separator' }
  | { type: 'label'; label: string };

/**
 * Dropdown menu (account menu, row actions, switchers). Opens on click, closes on Escape,
 * outside click or selection; arrow keys move between items; focus returns to the trigger.
 */
export function Menu({
  trigger,
  items,
  align = 'end',
  side = 'bottom',
  label,
  className,
  triggerClassName,
  header,
  testId,
}: {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  label: string;
  className?: string;
  triggerClassName?: string;
  header?: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const focusables = () => [...(root.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = focusables();
        const i = list.indexOf(document.activeElement as HTMLElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
      if (e.key === 'Tab') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => focusables()[0]?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemClass = 'flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-sm text-ink-2 outline-none hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink pointer-coarse:min-h-11';
  return (
    <div ref={root} className={cn('relative', className)} data-testid={testId}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={cn(
            'animate-pop-in absolute z-50 min-w-56 rounded-xl border border-line bg-surface p-1.5 shadow-lg',
            align === 'end' ? 'end-0' : 'start-0',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
          )}
        >
          {header && <div className="border-b border-line px-2.5 pt-1.5 pb-2.5 mb-1.5">{header}</div>}
          {items.map((it, i) => {
            if (it.type === 'separator') return <div key={i} className="my-1.5 h-px bg-line" role="separator" />;
            if (it.type === 'label') return <p key={i} className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{it.label}</p>;
            const content = (
              <>
                {it.icon && <Icon name={it.icon} className="text-muted" />}
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-xs text-muted">{it.hint}</span>}
              </>
            );
            if (it.type === 'button')
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                  className={cn(itemClass, it.danger && 'text-danger hover:text-danger focus-visible:text-danger')}
                >
                  {content}
                </button>
              );
            return it.external ? (
              <a key={i} role="menuitem" href={it.href} target="_blank" rel="noreferrer" className={itemClass} onClick={() => setOpen(false)}>
                {content}
                <Icon name="external" className="size-3.5 text-muted" />
              </a>
            ) : (
              <Link key={i} role="menuitem" href={it.href} className={itemClass} onClick={() => setOpen(false)}>
                {content}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
