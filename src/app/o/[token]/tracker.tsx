'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OrderChannel, OrderStatus } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { CUSTOMER_STEPS } from '@/lib/order-state';
import { Icon, type IconName } from '@/components/ui/icons';
import { JourneySteps, sfButton } from '@/components/storefront/ui';

type Initial = {
  number: number;
  channel: OrderChannel;
  status: OrderStatus;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  cancelReason: string | null;
  tableLabel: string | null;
  pickupPoint?: string | null;
  /** "Today 13:30", already formatted in the restaurant's time zone. */
  pickupWhen?: string | null;
  payment?: string | null;
  restaurant?: { name: string; address: string | null; phone: string | null; mapsHref: string | null };
  items: { name: string; variant: string | null; quantity: number; lineTotalCents: number; modifiers: string[] }[];
};

/**
 * Order confirmation and status. Two blocks: what happened (number, real status from the
 * restaurant, refreshed every 6 s) and what was ordered (method, payment, items, total, contact).
 * No location tracking and no invented progress.
 */
export function OrderTracker({ token, tag, m, initial, orderMoreHref, feedbackHref, loyalty }: { token: string; tag: string; m: Pick<Messages, 'customer' | 'orderStatus' | 'common' | 'ordering'>; initial: Initial; orderMoreHref: string; feedbackHref: string; loyalty?: React.ReactNode }) {
  const [status, setStatus] = useState<OrderStatus>(initial.status);
  const [cancelReason, setCancelReason] = useState(initial.cancelReason);
  const [offline, setOffline] = useState(false);
  const done = status === 'COMPLETED' || status === 'CANCELLED' || status === 'DELIVERED';
  const o = m.ordering;

  useEffect(() => {
    if (done) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/public/orders/${token}`, { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          if (!stop) {
            setStatus(d.status);
            setCancelReason(d.cancelReason);
            setOffline(false);
          }
        }
      } catch {
        if (!stop) setOffline(true);
      }
    };
    const id = setInterval(tick, 6000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token, done]);

  const steps = CUSTOMER_STEPS[initial.channel];
  const idx = steps.indexOf(status);
  const label = (s: OrderStatus) => (s === 'READY' && initial.channel === 'TAKEAWAY' ? m.orderStatus.READY_PICKUP : m.orderStatus[s as keyof typeof m.orderStatus]);
  const money = (c: number) => formatCents(c, tag);
  const cancelled = status === 'CANCELLED';
  const remote = initial.channel !== 'TABLE';
  const r = initial.restaurant;

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6 sm:py-10">
      {remote && !cancelled && <JourneySteps label={o.stepsLabel} current={2} steps={[{ label: o.stepMenu }, { label: o.stepCheckout }, { label: o.stepDone }]} className="px-1 pb-1" />}
      {/* 1 — What happened, and where the order is now. */}
      <section className="rounded-3xl bg-sf-card p-6 ring-1 ring-sf-line sm:p-8" data-testid="order-confirmation">
        <div className="text-center">
          {cancelled ? (
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-100 text-red-700" aria-hidden>
              <Icon name="x" className="size-8" strokeWidth={2.4} />
            </span>
          ) : (
            <span className="animate-pop-in mx-auto flex size-16 items-center justify-center rounded-full bg-sf-primary text-sf-on-primary motion-reduce:animate-none" aria-hidden>
              <Icon name="check" className="size-8" strokeWidth={2.6} />
            </span>
          )}
          <h2 className="mt-4 font-serif text-[1.85rem] leading-tight">{cancelled ? label('CANCELLED') : remote ? o.confirmedTitle : m.customer.orderSent}</h2>
          {!cancelled && remote && <p className="mt-1 text-[15px] text-sf-muted">{o.confirmedBody}</p>}
          {cancelled && cancelReason && <p className="mt-2 text-[15px] text-sf-muted">{cancelReason}</p>}
          <p className="mt-4 text-sm text-sf-muted">
            {o.orderNumber}{' '}
            <span className="ms-1 font-serif text-2xl font-semibold text-sf-text tabular-nums" data-testid="order-number">
              #{initial.number}
            </span>
          </p>
          {initial.tableLabel && <p className="mt-1 text-sm text-sf-muted">{fmt(m.customer.table, { label: initial.tableLabel })}</p>}
        </div>

        <div className="mt-6 border-t border-sf-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{o.orderProgress}</h3>
            <p className={cn('rounded-full px-3 py-1 text-sm font-semibold', cancelled ? 'bg-red-100 text-red-800' : 'bg-sf-soft text-sf-primary-ink')} data-testid="order-status" data-status={status}>
              {label(status)}
            </p>
          </div>
          {status === 'NEW' && <p className="mt-1.5 text-sm text-sf-muted">{m.customer.awaitingAcceptance}</p>}
          {offline && <p className="mt-1.5 text-xs text-amber-700">{m.common.connectionLost}</p>}
          {!cancelled && (
            <ol className="mt-4 space-y-0">
              {steps.map((s, i) => {
                const reached = i <= idx;
                const current = i === idx && !done;
                return (
                  <li key={s} className="relative flex items-center gap-3 pb-3 last:pb-0">
                    {i < steps.length - 1 && <span aria-hidden className={cn('absolute start-[11px] top-6 -bottom-0 w-0.5', i < idx ? 'bg-sf-primary' : 'bg-sf-line')} />}
                    <span className={cn('relative flex size-6 shrink-0 items-center justify-center rounded-full', reached ? 'bg-sf-primary text-sf-on-primary' : 'bg-sf-card ring-2 ring-sf-line', current && 'ring-4 ring-sf-primary/20')}>
                      {i < idx || (i === idx && done) ? <Icon name="check" className="size-3.5" strokeWidth={3} /> : current ? <span className="size-2 rounded-full bg-current" /> : null}
                    </span>
                    <span className={cn('text-[15px]', current ? 'font-semibold' : reached ? 'text-sf-text' : 'text-sf-muted')}>{label(s)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      {/* 2 — What was ordered, and how to reach the restaurant. */}
      <section className="rounded-3xl bg-sf-card ring-1 ring-sf-line">
        {remote && (
          <div className="space-y-4 p-6 sm:px-8">
            {initial.channel === 'TAKEAWAY' ? (
              <Row icon="bag" title={initial.pickupWhen ? fmt(o.pickupAtTime, { when: initial.pickupWhen }) : m.customer.pickup} testId="confirmation-mode">
                {initial.pickupPoint && <span data-testid="pickup-point">{fmt(m.customer.pickupPoint, { place: initial.pickupPoint })}</span>}
              </Row>
            ) : (
              <Row icon="truck" title={o.deliveryToYou} testId="confirmation-mode" />
            )}
            {initial.payment && <Row icon="card" title={initial.payment} />}
          </div>
        )}
        <div className={cn('p-6 sm:px-8', remote && 'border-t border-sf-line')}>
          <ul className="space-y-2.5 text-[15px]">
            {initial.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-semibold tabular-nums">{i.quantity}×</span> {i.name}
                  {(i.variant || i.modifiers.length > 0) && <span className="block text-[13px] text-sf-muted">{[i.variant, ...i.modifiers].filter(Boolean).join(' · ')}</span>}
                </span>
                <span className="shrink-0 tabular-nums">{money(i.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-sf-line pt-4 text-[15px]">
            {initial.discountCents > 0 && (
              <div className="flex justify-between text-emerald-800">
                <dt>{m.customer.discount}</dt>
                <dd>−{money(initial.discountCents)}</dd>
              </div>
            )}
            {initial.channel === 'DELIVERY' && (
              <div className="flex justify-between">
                <dt className="text-sf-muted">{m.customer.deliveryFee}</dt>
                <dd className="tabular-nums">{initial.deliveryFeeCents > 0 ? money(initial.deliveryFeeCents) : m.customer.deliveryFee0}</dd>
              </div>
            )}
            <div className="flex justify-between text-lg font-semibold">
              <dt>{m.customer.total}</dt>
              <dd className="tabular-nums" data-testid="confirmation-total">
                {money(initial.totalCents)}
              </dd>
            </div>
            <p className="text-xs text-sf-muted">{m.customer.billNotInvoice}</p>
          </dl>
        </div>
        {remote && r && (
          <div className="space-y-3 border-t border-sf-line p-6 sm:flex sm:items-center sm:gap-4 sm:space-y-0 sm:px-8">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.name}</p>
              {r.address && <p className="text-sm text-sf-muted">{r.address}</p>}
              <p className="mt-1 text-[13px] text-sf-muted">{o.contactRestaurant}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {r.mapsHref && (
                <a href={r.mapsHref} target="_blank" rel="noopener noreferrer" className={sfButton('secondary', 'md', 'size-12 px-0')} aria-label={m.customer.directions} title={m.customer.directions}>
                  <Icon name="map" className="size-5" />
                </a>
              )}
              {r.phone && (
                <a href={`tel:${r.phone.replace(/\s/g, '')}`} className={sfButton('secondary', 'md', 'px-4')} data-testid="call-restaurant" title={o.contactRestaurant}>
                  <Icon name="phone" className="size-5" />
                  <span dir="ltr">{r.phone}</span>
                </a>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-col items-center gap-1 pt-2">
        <Link href={orderMoreHref} className={sfButton(!remote && !done ? 'primary' : 'secondary', 'lg', 'w-full')} data-testid="order-more">
          {!remote && !done ? m.customer.orderMore : o.backToMenu}
        </Link>
        {feedbackHref && (
          // Not prefetched: every guest lands here right after ordering, when the server is busiest, and
          // each prefetch was three server requests per phone (final QA, 12-phone test) for a link few tap at once.
          <Link href={feedbackHref} prefetch={false} className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-sf-muted underline-offset-2 hover:underline">
            {m.customer.leaveFeedback}
          </Link>
        )}
      </div>
      {!cancelled && loyalty}
    </div>
  );
}

function Row({ icon, title, children, testId }: { icon: IconName; title: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-start gap-3.5" data-testid={testId}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sf-soft text-sf-primary-ink" aria-hidden>
        <Icon name={icon} className="size-5" />
      </span>
      <div className="min-w-0 pt-0.5 text-[15px]">
        <p className="font-semibold">{title}</p>
        {children && <p className="text-sm text-sf-muted">{children}</p>}
      </div>
    </div>
  );
}
