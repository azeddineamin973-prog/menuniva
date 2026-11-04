'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { uuid } from '@/lib/uuid';
import { buildWhatsAppText } from '@/lib/whatsapp';
import { Icon } from '@/components/ui/icons';
import type { TableAccess } from '@/server/services/table-access';
import { cartItems, useCartQuote, type CartLine, type CheckoutConfig } from './cart';
import { CartLineList } from './cart-panel';
import { Sheet } from './sheet';
import { joinTable, postOrder, refusalMessage, requestOpenTable } from './submit';
import { SF_INPUT, sfButton, SfField } from './ui';

export type { CartLine, CheckoutConfig };
export type Msg = Pick<Messages, 'customer' | 'common' | 'allergens' | 'validation' | 'ordering'>;

const emptyContact = { name: '', phone: '' };

/**
 * One-step order sheet for the guests who have nothing to fill in: a table (QR) order, or a
 * WhatsApp message prepared from the cart. Pickup and delivery use the checkout page instead.
 * The server recalculates every price; the totals shown come from its quote endpoint.
 */
export function CartSheet({
  channel,
  scope,
  lang,
  lines,
  setLines,
  m,
  money,
  canOrder,
  allergyNotice,
  pricesIncludeVat,
  upsell,
  tableAccess,
  onAccessChange,
  checkout,
  images,
  onClose,
  onSubmitted,
}: {
  images?: Map<string, string | null>;
  channel: OrderChannel;
  scope: { qrToken?: string; orgSlug: string; locationSlug: string };
  lang: LanguageCode;
  lines: CartLine[];
  setLines: (fn: (l: CartLine[]) => CartLine[]) => void;
  m: Msg;
  money: (c: number) => string;
  canOrder: boolean;
  allergyNotice: string;
  pricesIncludeVat: boolean;
  upsell?: React.ReactNode;
  tableAccess?: TableAccess;
  onAccessChange?: (a: TableAccess) => void;
  checkout?: CheckoutConfig;
  onClose: () => void;
  onSubmitted: (trackingToken: string) => void;
}) {
  const c = m.customer;
  const waOnly = !!checkout?.whatsapp?.only;
  const country = checkout?.country ?? 'PT';
  const place = scope.qrToken ?? `${scope.orgSlug}/${scope.locationSlug}`;
  const scopeKey = `${channel}:${place}`;
  // What the guest typed survives closing and reopening the cart (audit BUG-09). Kept only in
  // this browser tab (sessionStorage) and cleared once the order is confirmed.
  const draftKey = `mn_checkout:${channel === 'TABLE' ? 'TABLE' : 'REMOTE'}:${place}`;
  const [draft] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as Partial<{ couponInput: string; coupon: string; notes: string; contact: typeof emptyContact }> | null;
    } catch {
      return null;
    }
  });
  const [couponInput, setCouponInput] = useState(draft?.couponInput ?? '');
  const [coupon, setCoupon] = useState(draft?.coupon ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  // The table PIN is typed here once per phone and never kept in the browser: the server answers with
  // an httpOnly authorisation cookie, so a refresh or a second order needs no PIN.
  const [pin, setPin] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const needsPin = channel === 'TABLE' && tableAccess?.policy === 'SESSION_PIN' && tableAccess.open && !tableAccess.authorized;
  const tableClosed = channel === 'TABLE' && !!tableAccess && !tableAccess.open;
  const [contact, setContact] = useState({ ...emptyContact, ...draft?.contact });
  useEffect(() => {
    try {
      const prev = JSON.parse(sessionStorage.getItem(draftKey) ?? '{}');
      sessionStorage.setItem(draftKey, JSON.stringify({ ...prev, couponInput, coupon, notes, contact: { ...prev.contact, ...contact } }));
    } catch {}
  }, [draftKey, couponInput, coupon, notes, contact]);
  const { quote, setQuote, quoting } = useCartQuote({ channel, lang, scope, lines, coupon });
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const idemStorageKey = `mn_idem:${scopeKey}`;
  const pendingKey = `mn_pending:${scopeKey}`;
  // A request whose outcome is unknown (connection lost). Retrying resends exactly this body with the
  // same idempotency key, so the restaurant receives the order at most once (audit BUG-10).
  const [pending, setPending] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(pendingKey);
    } catch {
      return null;
    }
  });
  const [idemKey] = useState(() => {
    const existing = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(idemStorageKey) : null;
    const v = existing ?? uuid();
    try {
      sessionStorage.setItem(idemStorageKey, v);
    } catch {}
    return v;
  });

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    if (needsPin && scope.qrToken) {
      // Enter the PIN once (this phone becomes authorised for the seating), then send the order.
      const j = await joinTable(scope.qrToken, pin);
      if (j.kind === 'ok' || j.kind === 'not_required') {
        setPin('');
        onAccessChange?.({ ...tableAccess!, authorized: true, locked: false });
      } else {
        inFlight.current = false;
        setSubmitting(false);
        if (j.kind === 'closed') onAccessChange?.({ ...tableAccess!, open: false, authorized: false });
        if (j.kind === 'locked') onAccessChange?.({ ...tableAccess!, locked: true });
        setError(j.kind === 'invalid' ? c.pinInvalid : j.kind === 'locked' ? c.pinLocked : j.kind === 'closed' ? c.tableNotOpen : j.kind === 'busy' ? c.tooManyOrders : m.common.retry);
        return;
      }
    }
    const body = pending ?? JSON.stringify({ idempotencyKey: idemKey, language: lang, items: cartItems(lines), notes: notes.trim() || undefined, couponCode: coupon || undefined, qrToken: scope.qrToken });
    try {
      sessionStorage.setItem(pendingKey, body);
    } catch {}
    const r = await postOrder('/api/public/orders/table', body);
    inFlight.current = false;
    setSubmitting(false);
    if (r.kind === 'ok') {
      for (const k of [idemStorageKey, pendingKey, draftKey]) sessionStorage.removeItem(k);
      return onSubmitted(r.token);
    }
    if (r.kind === 'unknown') {
      // Outcome unknown: the order may or may not have reached the restaurant. Say so plainly
      // and offer a safe retry (same body, same key).
      setPending(body);
      setError(c.submitUncertain);
      return;
    }
    try {
      sessionStorage.removeItem(pendingKey);
    } catch {}
    setPending(null);
    if (r.data.error === 'items_unavailable' && Array.isArray(r.data.issues)) setQuote((q) => (q ? { ...q, issues: r.data.issues as never } : { subtotalCents: 0, issues: r.data.issues as never }));
    // The table's state changed since the page loaded (closed, new seating, phone removed).
    if (tableAccess && (r.data.error === 'pin_required' || r.data.error === 'session_ended' || r.data.error === 'table_not_open')) {
      onAccessChange?.({ ...tableAccess, authorized: false, open: r.data.error === 'pin_required', ended: r.data.error === 'session_ended' });
    }
    setError(refusalMessage(m, r, country, money));
  };
  const submitAgain = useEffectEvent(() => void submit());
  // Back online while an order is unconfirmed: check it once automatically (safe, idempotent).
  useEffect(() => {
    if (!pending) return;
    const onOnline = () => submitAgain();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pending]);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const hasIssues = !!quote && quote.issues.length > 0;
  const total = quote ? (quote.totalCents ?? quote.subtotalCents) : null;

  return (
    <Sheet onClose={onClose} label={c.cart} closeLabel={m.common.close}>
      <div data-testid="cart-sheet" data-step="single">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-sf-line bg-sf-bg/95 px-5 pt-5 pb-3 backdrop-blur">
          <h2 className="flex-1 font-serif text-[1.45rem] leading-tight">
            {c.cart}
            {count > 0 && <span className="ms-2 align-middle font-sans text-sm font-medium text-sf-muted tabular-nums">({count})</span>}
          </h2>
          <button type="button" onClick={onClose} aria-label={m.common.close} className="-me-2 flex size-11 items-center justify-center rounded-full hover:bg-sf-sunken" data-testid="cart-close">
            <Icon name="x" className="size-5" />
          </button>
        </div>
        <div className="space-y-5 px-5 py-4">
          {lines.length === 0 ? (
            <p className="py-10 text-center text-sm text-sf-muted">{c.cartEmpty}</p>
          ) : (
            <CartLineList lines={lines} setLines={setLines} images={images} money={money} m={m} issues={quote?.issues} disabled={!!pending} />
          )}
          {upsell}
          {lines.length > 0 && (
            <>
              <SfField label={`${c.notesForKitchen} (${m.common.optional})`}>
                {(id) => <textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 300))} className={cn(SF_INPUT, 'h-auto min-h-[3.25rem] py-3')} rows={2} placeholder={c.notesPlaceholder} />}
              </SfField>
              {needsPin && (
                <div className="rounded-2xl bg-sf-sunken p-4" data-testid="table-pin-box">
                  <SfField label={c.pinTitle} hint={tableAccess?.locked ? c.pinLocked : c.pinHint}>
                    {(id) => (
                      <input
                        id={id}
                        value={pin}
                        onChange={(e) => {
                          setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                          if (error) setError(null); // the guest is correcting it
                        }}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        enterKeyHint="send"
                        maxLength={6}
                        disabled={!!tableAccess?.locked || !!pending}
                        aria-invalid={!!error && /PIN/i.test(error)}
                        className={cn(SF_INPUT, 'text-center font-mono text-2xl tracking-[0.5em]')}
                        data-testid="table-pin-input"
                      />
                    )}
                  </SfField>
                </div>
              )}
              {tableClosed && (
                <div className="space-y-2 rounded-2xl bg-sf-sunken p-4" data-testid="table-closed-box">
                  <p className="text-sm">{tableAccess?.ended ? c.sessionEnded : c.tableClosedBanner}</p>
                  {scope.qrToken && (
                    <button
                      type="button"
                      className={sfButton('secondary', 'md', 'w-full')}
                      data-testid="ask-open-table"
                      onClick={async () => {
                        const r = await requestOpenTable(scope.qrToken!);
                        if (r === 'open') onAccessChange?.({ ...tableAccess!, open: true, ended: false });
                        setNotice(r === 'open' ? c.tableAlreadyOpen : r === 'ok' ? c.openTableRequested : r === 'limited' ? c.tooManyOrders : m.common.connectionLost);
                      }}
                    >
                      {c.askOpenTable}
                    </button>
                  )}
                  {notice && <p className="text-sm font-medium" role="status" data-testid="open-table-notice">{notice}</p>}
                </div>
              )}
              {waOnly && (
                <>
                  <SfField label={c.yourName}>{(id) => <input id={id} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" className={SF_INPUT} maxLength={80} />}</SfField>
                  <SfField label={c.phone}>{(id) => <input id={id} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} type="tel" autoComplete="tel" className={SF_INPUT} maxLength={20} />}</SfField>
                </>
              )}
              {!waOnly && (
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase().slice(0, 30))} placeholder={c.promoCode} aria-label={c.promoCode} className={cn(SF_INPUT, 'h-12 min-w-0 flex-1 uppercase')} data-testid="coupon-input" />
                    <button type="button" onClick={() => setCoupon(couponInput.trim())} className={sfButton('secondary', 'md')} data-testid="coupon-apply">
                      {c.apply}
                    </button>
                  </div>
                  {coupon && quote?.forCoupon !== coupon && <p className="text-sm text-sf-muted" role="status" data-testid="coupon-checking">{c.checkingCode}</p>}
                  {coupon && quote?.forCoupon === coupon && quote.couponStatus && quote.couponStatus !== 'valid' && (
                    <p className="text-sm text-red-700" role="alert" data-testid="coupon-error">
                      {quote.couponStatus === 'not_applicable' ? c.promoNotApplicable : c.promoInvalid}
                    </p>
                  )}
                </div>
              )}
              <details className="text-sm">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium text-sf-muted [&::-webkit-details-marker]:hidden">
                  <Icon name="info" className="size-4 shrink-0" />
                  {c.allergyNoticeTitle}
                </summary>
                <p className="pb-2 text-sf-muted">{allergyNotice}</p>
              </details>
              <dl className={cn('space-y-1.5 border-t border-sf-line pt-4 transition-opacity', quoting && 'opacity-50')} aria-busy={quoting} data-testid="cart-totals">
                {quote?.discounts?.map((d, i) => (
                  <div key={i} className="flex justify-between text-emerald-800" data-testid="discount-line">
                    <dt>
                      {c.discount}: {d.description}
                    </dt>
                    <dd className="tabular-nums">−{money(d.amountCents)}</dd>
                  </div>
                ))}
                <div className="flex justify-between text-lg font-semibold">
                  <dt>{c.total}</dt>
                  <dd className="tabular-nums" data-testid="cart-total">{total !== null ? money(total) : '…'}</dd>
                </div>
                {!!quote?.discountCents && <p className="text-sm font-medium text-emerald-800" data-testid="you-save">{fmt(c.youSave, { amount: money(quote.discountCents) })}</p>}
                <p className="text-xs text-sf-muted">
                  {pricesIncludeVat && `${c.pricesIncludeVat} `}
                  {channel === 'TABLE' && `${c.paymentNote} ${c.payToWaiter}.`}
                </p>
              </dl>
            </>
          )}
        </div>
        {lines.length > 0 && (
          <div className="sticky bottom-0 z-10 space-y-2 border-t border-sf-line bg-sf-bg/95 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
            {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" data-testid="submit-error">{error}</p>}
            {pending && !error && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" data-testid="submit-pending">{c.submitUncertain}</p>}
            {!waOnly && (
              <button
                type="button"
                disabled={!canOrder || submitting || tableClosed || (needsPin && (pin.length < 4 || !!tableAccess?.locked)) || (!pending && (!quote || quoting || hasIssues))}
                onClick={submit}
                className={sfButton('primary', 'lg', 'w-full')}
                data-testid="submit-order"
              >
                {submitting && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />}
                {submitting ? c.submitting : pending ? c.retrySubmit : needsPin ? c.pinConfirmAndSend : c.submitOrder}
              </button>
            )}
            {checkout?.whatsapp && (
              <>
                <a
                  // The total quoted must be the one the guest sees above, discounts included.
                  href={`https://wa.me/${checkout.whatsapp.number}?text=${encodeURIComponent(
                    buildWhatsAppText(m, checkout.whatsapp.restaurant, lines, money(total ?? lines.reduce((n, l) => n + l.unitCents * l.quantity, 0)), { name: contact.name, phone: contact.phone, pickup: true }),
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(sfButton('primary', 'lg', 'w-full'), 'bg-[#1a7f4b] text-white')}
                  data-testid="whatsapp-send"
                >
                  {c.sendViaWhatsApp}
                </a>
                <p className="text-xs text-sf-muted">
                  {c.whatsappOpenNote} {c.waPricesNote}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Pickup / Delivery switch. The current method is shown pressed; the other is a link that keeps
 * the cart (and its prices are checked again there).
 */
export function ModeSwitch({ current, hrefs, labels, testId, size = 'md' }: { current: 'pickup' | 'delivery'; hrefs: { pickup?: string; delivery?: string }; labels: Pick<Msg['ordering'], 'modeLabel' | 'modePickup' | 'modeDelivery'>; testId?: string; size?: 'sm' | 'md' }) {
  const items = [
    { key: 'pickup' as const, label: labels.modePickup, icon: 'bag' as const, href: hrefs.pickup },
    { key: 'delivery' as const, label: labels.modeDelivery, icon: 'truck' as const, href: hrefs.delivery },
  ].filter((x) => x.key === current || x.href);
  if (items.length < 2) return null;
  const cls = (active: boolean) =>
    cn(
      'flex flex-1 items-center justify-center gap-2 rounded-full px-4 font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sf-primary',
      size === 'sm' ? 'h-10 text-sm' : 'h-11 text-[15px]',
      active ? 'bg-sf-card text-sf-text shadow-[0_1px_3px_rgb(0_0_0/0.12)]' : 'text-sf-muted hover:text-sf-text',
    );
  return (
    <nav aria-label={labels.modeLabel} className="flex gap-1 rounded-full bg-sf-sunken p-1 ring-1 ring-sf-line" data-testid={testId}>
      {items.map((x) =>
        x.key === current ? (
          <span key={x.key} aria-current="page" className={cls(true)} data-mode={x.key}>
            <Icon name={x.icon} className="size-[18px] text-sf-primary-ink" />
            {x.label}
          </span>
        ) : (
          <a key={x.key} href={x.href} className={cls(false)} data-mode={x.key}>
            <Icon name={x.icon} className="size-[18px]" />
            {x.label}
          </a>
        ),
      )}
    </nav>
  );
}
