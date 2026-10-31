'use client';

import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { PublicProduct } from '@/server/services/public-menu';

type Labels = { from: string; soldOut: string; unavailable: string; popular: string; add: string };

/** Dietary/feature tags worth showing on a card, recognised in the languages MenuNiva supports. */
const TAG_STYLE: { match: RegExp; icon?: 'flame' }[] = [{ match: /^(spicy|picante|piquant|épicé|حار)/i, icon: 'flame' }, { match: /./ }];

export function lowestPrice(p: PublicProduct) {
  return p.priceCents + Math.min(0, ...p.variants.map((v) => v.priceDeltaCents));
}

/**
 * Dish card. Phones: one row, text first and a large photo on the side (easy to scan with a
 * thumb). From `sm`: a photo-first card in a grid. The whole card opens the dish sheet.
 */
export function DishCard({ p, money, labels, canOrder, onOpen, priority = false }: { p: PublicProduct; money: (c: number) => string; labels: Labels; canOrder: boolean; onOpen: () => void; priority?: boolean }) {
  const blocked = p.soldOut || !p.available;
  const tags = p.tags.slice(0, 2);
  return (
    <button
      type="button"
      disabled={blocked}
      onClick={onOpen}
      className={cn(
        'group relative flex h-full w-full gap-3 overflow-hidden rounded-2xl bg-sf-card p-3 text-start ring-1 ring-sf-text/[0.06] transition-[box-shadow,transform] duration-200',
        'shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_16px_-10px_rgb(0_0_0/0.18)] hover:shadow-[0_2px_4px_rgb(0_0_0/0.05),0_14px_28px_-14px_rgb(0_0_0/0.28)] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-primary disabled:cursor-not-allowed sm:flex-col sm:gap-0 sm:p-0',
      )}
      data-testid="customer-product"
    >
      {/* Photo: side tile on phones, top of the card from sm. */}
      <span className="relative order-last shrink-0 sm:order-first">
        {p.imageUrl ? (
          <img
            src={p.imageUrl}
            alt=""
            className={cn('size-28 rounded-xl bg-sf-accent/10 object-cover sm:aspect-[4/3] sm:h-auto sm:w-full sm:rounded-none', blocked && 'grayscale-[60%]')}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            width={320}
            height={240}
          />
        ) : (
          <NoPhoto className="size-28 rounded-xl sm:aspect-[4/3] sm:h-auto sm:w-full sm:rounded-none" />
        )}
        {blocked && (
          <span className="absolute inset-x-1.5 bottom-1.5 rounded-lg bg-black/70 px-2 py-1 text-center text-[11px] font-semibold text-white backdrop-blur-sm sm:inset-x-auto sm:start-3 sm:bottom-3">
            {p.soldOut ? labels.soldOut : labels.unavailable}
          </span>
        )}
        {!blocked && canOrder && (
          <span
            aria-hidden
            className="absolute -end-1 -bottom-1 flex size-9 items-center justify-center rounded-full bg-sf-primary text-sf-on-primary shadow-md ring-[3px] ring-sf-card transition-transform group-hover:scale-105 sm:end-3 sm:bottom-3 sm:ring-0 motion-reduce:transition-none"
          >
            <Icon name="plus" className="size-[18px]" strokeWidth={2.4} />
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col sm:p-4">
        <span className="flex flex-wrap items-center gap-1.5">
          {p.isPopular && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sf-accent/15 px-2 py-0.5 text-[11px] font-semibold">
              <Icon name="star" className="size-3" />
              {labels.popular}
            </span>
          )}
          {tags.map((t) => {
            const style = TAG_STYLE.find((s) => s.match.test(t));
            return (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-sf-text/[0.06] px-2 py-0.5 text-[11px] font-medium capitalize">
                {style?.icon && <Icon name={style.icon} className="size-3" />}
                {t}
              </span>
            );
          })}
        </span>
        <span className={cn('block leading-snug font-semibold break-words', (p.isPopular || tags.length > 0) && 'mt-1.5')}>{p.name}</span>
        {p.description && <span className="mt-1 line-clamp-2 text-sm leading-snug opacity-70">{p.description}</span>}
        <span className="mt-auto flex items-center gap-2 pt-2.5">
          <span className="text-[15px] font-bold text-sf-primary-ink tabular-nums">
            {p.variants.length > 1 && <span className="me-1 text-xs font-medium opacity-70">{labels.from}</span>}
            {money(lowestPrice(p))}
          </span>
        </span>
      </span>
    </button>
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
