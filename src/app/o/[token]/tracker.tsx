'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OrderChannel, OrderStatus } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { CUSTOMER_STEPS } from '@/lib/order-state';

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
  items: { name: string; variant: string | null; quantity: number; lineTotalCents: number; modifiers: string[] }[];
};

/** Polls the real order status every 6 s (no fake progress). */
export function OrderTracker({ token, tag, m, initial, orderMoreHref, feedbackHref, loyalty }: { token: string; tag: string; m: Pick<Messages, 'customer' | 'orderStatus' | 'common'>; initial: Initial; orderMoreHref: string; feedbackHref: string; loyalty?: React.ReactNode }) {
  const [status, setStatus] = useState<OrderStatus>(initial.status);
  const [cancelReason, setCancelReason] = useState(initial.cancelReason);
  const [offline, setOffline] = useState(false);
  const done = status === 'COMPLETED' || status === 'CANCELLED' || status === 'DELIVERED';

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

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-6">
      <div className="rounded-3xl bg-white/85 p-5 text-center shadow-sm ring-1 ring-black/5">
        <p className="text-sm opacity-70">{m.customer.orderSent}</p>
        <p className="mt-1 font-serif text-3xl">{fmt(m.customer.orderNumber, { number: initial.number })}</p>
        {initial.tableLabel && <p className="text-sm opacity-70">{fmt(m.customer.table, { label: initial.tableLabel })}</p>}
        <p className={cn('mt-4 inline-block rounded-full px-4 py-1.5 text-sm font-medium', status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-sf-primary text-white')} data-testid="order-status" data-status={status}>
          {label(status)}
        </p>
        {status === 'NEW' && <p className="mt-2 text-sm opacity-70">{m.customer.awaitingAcceptance}</p>}
        {status === 'CANCELLED' && cancelReason && <p className="mt-2 text-sm opacity-80">{cancelReason}</p>}
        {offline && <p className="mt-2 text-xs text-amber-700">{m.common.connectionLost}</p>}
      </div>

      {status !== 'CANCELLED' && (
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold', i <= idx ? 'bg-sf-primary text-white' : 'bg-black/10')}>{i < idx || (i === idx && done) ? '✓' : i + 1}</span>
              <span className={cn('text-sm', i === idx ? 'font-semibold' : i < idx ? 'opacity-70' : 'opacity-50')}>{label(s)}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="rounded-3xl bg-white/85 p-5 ring-1 ring-black/5">
        <ul className="space-y-2 text-sm">
          {initial.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3">
              <span>
                {i.quantity} × {i.name}
                {(i.variant || i.modifiers.length > 0) && <span className="block text-xs opacity-60">{[i.variant, ...i.modifiers].filter(Boolean).join(' · ')}</span>}
              </span>
              <span className="tabular-nums">{money(i.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-black/5 pt-3 text-sm">
          {initial.discountCents > 0 && <div className="flex justify-between"><span>{m.customer.discount}</span><span>−{money(initial.discountCents)}</span></div>}
          {initial.deliveryFeeCents > 0 && <div className="flex justify-between"><span>{m.customer.deliveryFee}</span><span>{money(initial.deliveryFeeCents)}</span></div>}
          <div className="flex justify-between text-base font-semibold"><span>{m.customer.total}</span><span className="tabular-nums">{money(initial.totalCents)}</span></div>
          <p className="text-xs opacity-60">{m.customer.billNotInvoice}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {!done && initial.channel === 'TABLE' && <Link href={orderMoreHref} className="rounded-2xl bg-sf-primary py-3 text-center font-medium text-white">{m.customer.orderMore}</Link>}
        <Link href={feedbackHref} className="rounded-2xl py-3 text-center font-medium ring-1 ring-black/10">{m.customer.leaveFeedback}</Link>
      </div>
      {status !== 'CANCELLED' && loyalty}
    </div>
  );
}
