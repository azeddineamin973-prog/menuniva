import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export type OrderMode = { key: string; label: string; href: string; icon: IconName; external?: boolean; active?: boolean };

/**
 * How to order: one segmented, horizontally scrollable control with only the channels the
 * restaurant enabled. The active channel is filled; external platforms are marked as such.
 */
export function OrderModeBar({ modes, label, className }: { modes: OrderMode[]; label: string; className?: string }) {
  if (modes.length === 0) return null;
  return (
    <nav aria-label={label} className={cn('relative -mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} data-testid="order-modes">
      <ul className="flex w-max min-w-full gap-1 rounded-2xl bg-sf-card p-1 shadow-sm ring-1 ring-sf-text/[0.07] sm:w-full">
        {modes.map((m) => {
          const cls = cn(
            'flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sf-primary',
            m.active ? 'bg-sf-primary text-sf-on-primary shadow-sm' : 'hover:bg-sf-text/[0.05]',
          );
          return (
            <li key={m.key} className="flex-1">
              {m.external ? (
                <a href={m.href} target="_blank" rel="noopener noreferrer" className={cls} data-mode={m.key}>
                  {m.label}
                  <Icon name="external" className="size-3.5 opacity-60" />
                  <span className="sr-only">(opens another website)</span>
                </a>
              ) : (
                <Link href={m.href} aria-current={m.active ? 'page' : undefined} className={cls} data-mode={m.key}>
                  <Icon name={m.icon} className="size-[18px] shrink-0" />
                  {m.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Small "Open now / Closed" pill for the storefront header. */
export function OpenStatus({ open, labels }: { open: boolean | null; labels: { openNow: string; closedNow: string } }) {
  if (open === null) return null;
  return (
    // Uses the header's own text colour, so it reads on a photo, a dark or a light brand colour.
    <span className="inline-flex items-center gap-1.5 rounded-full bg-current/12 px-2.5 py-1 text-xs font-semibold ring-1 ring-current/25 backdrop-blur" data-testid="hero-open-status" data-open={open}>
      <span className={cn('size-2 rounded-full', open ? 'bg-emerald-400 shadow-[0_0_0_3px_rgb(52_211_153/0.25)]' : 'bg-current opacity-50')} aria-hidden />
      <span className="text-current">
        {open ? labels.openNow : labels.closedNow}
      </span>
    </span>
  );
}
