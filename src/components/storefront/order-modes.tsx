import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icons';
import { LinkIcon } from '@/components/ui/link-pending';
import { cn } from '@/lib/cn';

export type OrderChoiceItem = { key: 'pickup' | 'delivery'; title: string; lines: string[]; href: string; icon: IconName; unavailable?: string };

/**
 * "How would you like your order?": one large card per ordering method the restaurant offers
 * (pickup at the restaurant, the restaurant's own delivery). Each card says what to expect
 * (ready time, delivery fee) before the guest starts.
 */
export function OrderChoice({ title, items }: { title: string; items: OrderChoiceItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="order-choice-title" data-testid="order-choice">
      <h2 id="order-choice-title" className="mb-2.5 font-serif text-xl sm:text-2xl">{title}</h2>
      <ul className={cn('grid gap-2.5', items.length > 1 && 'sm:grid-cols-2')}>
        {items.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className="group relative flex min-h-[5.75rem] items-center gap-4 rounded-3xl bg-sf-card p-4 ring-1 ring-sf-line transition-[box-shadow,transform] hover:shadow-[var(--sf-shadow-card)] hover:ring-sf-primary/40 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-primary motion-reduce:transition-none"
              data-mode={it.key}
            >
              <span className="flex size-13 shrink-0 items-center justify-center rounded-2xl bg-sf-primary text-sf-on-primary shadow-sm">
                <LinkIcon icon={it.icon} className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] leading-snug font-semibold">{it.title}</span>
                {it.lines.map((l, i) => (
                  <span key={i} className={cn('block text-sm leading-snug', i === 0 ? 'mt-0.5 text-sf-muted' : 'text-sf-muted')}>
                    {l}
                  </span>
                ))}
                {it.unavailable && <span className="mt-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{it.unavailable}</span>}
              </span>
              <Icon name="chevronRight" className="size-5 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
