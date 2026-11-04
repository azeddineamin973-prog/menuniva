'use client';

import Link from 'next/link';
import type { OrderChannel } from '@/generated/prisma/enums';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icons';
import { MediaImage } from '@/components/ui/media-image';
import type { CartLine, Quote, QuoteIssue } from './cart';
import { NoPhoto } from './dish-card';
import type { Msg } from './cart-sheet';
import { sfButton, SfNote, Stepper } from './ui';

export function issueText(m: Msg, lines: CartLine[], i: QuoteIssue) {
  return i.code === 'selection_rules' && i.group ? fmt(m.validation.chooseOption, { group: i.group }) : fmt(m.customer.itemNoLongerAvailable, { name: i.name ?? lines[i.index]?.name ?? '' });
}

/** Cart lines: photo, name, choices, price and a − n + control (− on 1 removes the line). */
export function CartLineList({ lines, setLines, images, money, m, issues, disabled, readOnly = false }: { lines: CartLine[]; setLines?: (fn: (l: CartLine[]) => CartLine[]) => void; images?: Map<string, string | null>; money: (c: number) => string; m: Msg; issues?: QuoteIssue[]; disabled?: boolean; readOnly?: boolean }) {
  const setQty = (lineId: string, n: number) => setLines?.((ls) => (n <= 0 ? ls.filter((x) => x.lineId !== lineId) : ls.map((x) => (x.lineId === lineId ? { ...x, quantity: n } : x))));
  return (
    <ul className="divide-y divide-sf-line">
      {lines.map((l, i) => {
        const issue = issues?.find((x) => x.index === i);
        const img = images?.get(l.productId);
        return (
          <li key={l.lineId} className="py-3.5 first:pt-0 last:pb-0" data-testid="cart-line">
            <div className="flex items-start gap-3">
              {readOnly && <span className="mt-0.5 min-w-6 text-sm font-semibold tabular-nums">{l.quantity}×</span>}
              {!readOnly &&
                (img ? (
                  <MediaImage src={img} sizes="56px" widths={[160]} className="size-14 shrink-0 rounded-xl bg-sf-sunken object-cover" loading="lazy" decoding="async" width={56} height={56} />
                ) : (
                  <NoPhoto className="size-14 rounded-xl [&_svg]:size-6" />
                ))}
              <div className="min-w-0 flex-1">
                <p className={cn('leading-snug font-medium break-words', !readOnly && 'text-[15px]')}>{l.name}</p>
                {l.detail && <p className="mt-0.5 text-[13px] leading-snug wrap-anywhere text-sf-muted">{l.detail}</p>}
                {l.notes && <p className="text-[13px] wrap-anywhere text-sf-muted italic">“{l.notes}”</p>}
                {!readOnly && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Stepper
                      compact
                      min={0}
                      value={l.quantity}
                      disabled={disabled}
                      onChange={(n) => setQty(l.lineId, n)}
                      labels={{ minus: l.quantity <= 1 ? `${m.common.remove} ${l.name}` : `− ${l.name}`, plus: `+ ${l.name}`, quantity: m.customer.quantity }}
                    />
                    <span className="text-[15px] font-semibold tabular-nums">{money(l.unitCents * l.quantity)}</span>
                  </div>
                )}
              </div>
              {readOnly && <span className="shrink-0 text-sm tabular-nums">{money(l.unitCents * l.quantity)}</span>}
            </div>
            {issue && (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {issueText(m, lines, issue)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The order while browsing: lines, server-confirmed subtotal, and the way to checkout.
 * Desktop: a sticky column next to the menu. Phones and tablets: the content of the cart sheet.
 */
export function CartPanel({
  channel,
  lines,
  setLines,
  images,
  money,
  m,
  quote,
  quoting,
  canOrder,
  checkoutHref,
  minOrderCents = 0,
  upsell,
  onClose,
  variant,
}: {
  channel: OrderChannel;
  lines: CartLine[];
  setLines: (fn: (l: CartLine[]) => CartLine[]) => void;
  images: Map<string, string | null>;
  money: (c: number) => string;
  m: Msg;
  quote: Quote | null;
  quoting: boolean;
  canOrder: boolean;
  checkoutHref: string;
  minOrderCents?: number;
  upsell?: React.ReactNode;
  onClose?: () => void;
  variant: 'aside' | 'sheet';
}) {
  const c = m.customer;
  const o = m.ordering;
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const issues = quote?.issues ?? [];
  const short = quote && minOrderCents > 0 && quote.subtotalCents < minOrderCents ? minOrderCents - quote.subtotalCents : 0;
  const total = quote ? (quote.totalCents ?? quote.subtotalCents) : null;
  const ready = canOrder && !!quote && !quoting && issues.length === 0 && short === 0 && lines.length > 0;
  return (
    <div className={cn('flex flex-col', variant === 'aside' ? 'max-h-[calc(100dvh-6.5rem)] rounded-3xl bg-sf-card shadow-[var(--sf-shadow-card)] ring-1 ring-sf-line' : 'min-h-[40dvh]')} data-testid={variant === 'aside' ? 'cart-aside' : 'cart-sheet'} data-step="cart">
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <h2 className="flex-1 font-serif text-[1.45rem] leading-tight">
          {c.cart}
          {count > 0 && <span className="ms-2 align-middle font-sans text-sm font-medium text-sf-muted tabular-nums">({count})</span>}
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={m.common.close} className="-me-2 flex size-11 items-center justify-center rounded-full hover:bg-sf-sunken" data-testid="cart-close">
            <Icon name="x" className="size-5" />
          </button>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pt-4 pb-10 text-center" data-testid="cart-empty">
          <span className="flex size-14 items-center justify-center rounded-full bg-sf-soft text-sf-primary-ink" aria-hidden>
            <Icon name="bag" className="size-6" />
          </span>
          <p className="mt-3 max-w-[16rem] text-sm text-sf-muted">{c.cartEmpty}</p>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-4">
            <CartLineList lines={lines} setLines={setLines} images={images} money={money} m={m} issues={issues} />
            {upsell}
          </div>
          <div className="space-y-3 border-t border-sf-line px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <dl className={cn('space-y-1.5 text-[15px] transition-opacity', quoting && 'opacity-50')} aria-busy={quoting} data-testid="cart-totals">
              {quote?.discounts?.map((d, i) => (
                <div key={i} className="flex justify-between text-emerald-800" data-testid="discount-line">
                  <dt>{d.description}</dt>
                  <dd className="tabular-nums">−{money(d.amountCents)}</dd>
                </div>
              ))}
              <div className="flex justify-between text-lg font-semibold">
                <dt>{channel === 'DELIVERY' ? c.subtotal : c.total}</dt>
                <dd className="tabular-nums" data-testid="cart-total">{total !== null ? money(total) : '…'}</dd>
              </div>
              {channel === 'DELIVERY' && (
                <p className="flex items-center gap-1.5 text-[13px] text-sf-muted">
                  <Icon name="truck" className="size-3.5 shrink-0" />
                  <span data-testid="delivery-fee">{o.feeAtCheckout}</span>
                </p>
              )}
            </dl>
            {short > 0 && (
              <SfNote icon="info" tone="warn" role="status" testId="minimum-notice">
                {fmt(o.addMoreForMinimum, { amount: money(short) })}
              </SfNote>
            )}
            {ready ? (
              <Link href={checkoutHref} className={sfButton('primary', 'lg', 'w-full justify-between')} data-testid="go-checkout">
                <span>{o.goToCheckout}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {total !== null && money(total)}
                  <Icon name="arrowRight" className="size-5 rtl:rotate-180" />
                </span>
              </Link>
            ) : (
              <button type="button" disabled className={sfButton('primary', 'lg', 'w-full')} data-testid="go-checkout">
                {o.goToCheckout}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
