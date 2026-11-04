'use client';

import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { PublicProduct } from '@/server/services/public-menu';
import { MediaImage } from '@/components/ui/media-image';

type Labels = { from: string; soldOut: string; unavailable: string; popular: string; add: string; quickAdd: string; remove1: string; add1: string };

export function lowestPrice(p: PublicProduct) {
  return p.priceCents + Math.min(0, ...p.variants.map((v) => v.priceDeltaCents));
}

/**
 * Product tile, shop style: photo on top, name and price below, two per row on phones.
 * The control on the photo adds the dish at once when there is nothing to choose; once it is in
 * the order it becomes − n +. Dishes with sizes or required choices open their sheet instead.
 * Shows only what the restaurant entered: no invented badges, times or prices.
 */
export function DishCard({
  p,
  money,
  labels,
  canOrder,
  onOpen,
  onQuickAdd,
  onRemoveOne,
  simple = false,
  priority = false,
  count = 0,
}: {
  p: PublicProduct;
  money: (c: number) => string;
  labels: Labels;
  canOrder: boolean;
  onOpen: () => void;
  onQuickAdd?: () => void;
  /** Simple dishes: take one back out of the order. */
  onRemoveOne?: () => void;
  /** No sizes and no required choices: can be added from the tile. */
  simple?: boolean;
  priority?: boolean;
  count?: number;
}) {
  const blocked = p.soldOut || !p.available;
  const quick = !blocked && canOrder && onQuickAdd;
  const stepper = quick && simple && count > 0 && onRemoveOne;
  return (
    <div className="group relative h-full">
      <button
        type="button"
        disabled={blocked}
        onClick={onOpen}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-2xl bg-sf-card text-start ring-1 ring-sf-line transition-[box-shadow,transform] duration-200',
          'hover:shadow-[var(--sf-shadow-card)] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-primary disabled:cursor-not-allowed',
          count > 0 && 'ring-2 ring-sf-primary/70',
        )}
        data-testid="customer-product"
      >
        <span className="relative block aspect-square w-full overflow-hidden bg-sf-sunken sm:aspect-[4/3]">
          {p.imageUrl ? (
            <MediaImage
              src={p.imageUrl}
              // Two tiles per row on phones, three from tablets.
              sizes="(min-width: 1024px) 300px, (min-width: 768px) 30vw, 50vw"
              widths={[320, 480, 640, 960]}
              phoneWidths={[320, 480]}
              className={cn('h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none', blocked && 'opacity-60 grayscale-[60%]')}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              width={320}
              height={320}
            />
          ) : (
            <NoPhoto className="h-full w-full" />
          )}
          {p.isPopular && !blocked && (
            <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-sf-card/95 px-2 py-1 text-[11px] font-semibold text-sf-text shadow-sm backdrop-blur">
              <Icon name="star" className="size-3 text-sf-gold" />
              {labels.popular}
            </span>
          )}
          {blocked && (
            <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/70 px-2 py-1 text-center text-xs font-semibold text-white backdrop-blur-sm">{p.soldOut ? labels.soldOut : labels.unavailable}</span>
          )}
          {count > 0 && !stepper && (
            <span className="absolute end-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-sf-primary px-2 text-xs font-bold text-sf-on-primary tabular-nums shadow" data-testid="dish-count">
              {count}
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col p-3 sm:p-4">
          <span className="line-clamp-2 text-[15px] leading-snug font-semibold break-words sm:text-base">{p.name}</span>
          {p.description && <span className="mt-1 line-clamp-1 text-[13px] leading-snug text-sf-muted sm:line-clamp-2 sm:text-sm">{p.description}</span>}
          <span className="mt-auto pt-2.5 text-[15px] font-semibold text-sf-text tabular-nums sm:text-base">
            {p.variants.length > 1 && <span className="me-1 text-xs font-medium text-sf-muted">{labels.from}</span>}
            {money(lowestPrice(p))}
          </span>
        </span>
      </button>

      {/* Add control, on the photo's corner (an overlay the size of the photo). */}
      {quick && (
        <span className="pointer-events-none absolute inset-x-0 top-0 aspect-square sm:aspect-[4/3]">
          <span className="pointer-events-auto absolute end-2 bottom-2">
            {stepper ? (
              <span className="flex items-center rounded-full bg-sf-primary p-1 text-sf-on-primary shadow-[0_6px_16px_-6px_rgb(0_0_0/0.5)]" data-testid="tile-stepper">
                <button type="button" onClick={onRemoveOne} aria-label={labels.remove1.replace('{name}', p.name)} className="flex size-9 items-center justify-center rounded-full hover:bg-black/15" data-testid="tile-dec">
                  <Icon name={count <= 1 ? 'trash' : 'minus'} className="size-4" />
                </button>
                <span className="w-6 text-center text-sm font-bold tabular-nums" aria-live="polite" data-testid="tile-qty">
                  {count}
                </span>
                <button type="button" onClick={onQuickAdd} aria-label={labels.add1.replace('{name}', p.name)} className="flex size-9 items-center justify-center rounded-full hover:bg-black/15" data-testid="quick-add">
                  <Icon name="plus" className="size-4" strokeWidth={2.4} />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={onQuickAdd}
                aria-label={labels.quickAdd.replace('{name}', p.name)}
                className="flex size-11 items-center justify-center rounded-full bg-sf-card text-sf-primary-ink shadow-[0_6px_16px_-6px_rgb(0_0_0/0.45)] ring-1 ring-sf-line transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-primary motion-reduce:transition-none"
                data-testid="quick-add"
              >
                <Icon name="plus" className="size-5" strokeWidth={2.4} />
              </button>
            )}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * Tile for a dish without a photo: a quiet serving-cloche mark in the restaurant's accent colour,
 * so the card looks finished rather than like an image that failed to load.
 */
export function NoPhoto({ className }: { className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center bg-gradient-to-br from-sf-accent/20 to-sf-accent/5 text-sf-accent', className)} aria-hidden data-testid="no-photo">
      <svg viewBox="0 0 48 48" className="size-9 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 32a15 15 0 0 1 30 0z" />
        <path d="M6 36h36M24 14v3" />
        <circle cx="24" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
