'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { isValidPostalCode } from '@/lib/postal';
import { uuid } from '@/lib/uuid';
import { buildWhatsAppText } from '@/lib/whatsapp';
import type { PublicCategory } from '@/server/services/public-menu';
import { Icon } from '@/components/ui/icons';
import { cartItems, cartKey, rememberOrder, useCart, useCartQuote, usePricedLines, type CheckoutConfig } from './cart';
import { CartLineList } from './cart-panel';
import type { Msg } from './cart-sheet';
import { postOrder, refusalMessage } from './submit';
import { JourneySteps, SF_INPUT, sfButton, SfField, SfNote, SfSection } from './ui';

type DeliveryQuote = { valid: boolean; covered: boolean; needsCity?: boolean; zoneName?: string; feeCents: number; minOrderCents: number; freeFromCents: number | null; subtotalCents: number; totalCents: number; meetsMinimum: boolean; estimatedMinutes: number };
type FieldKey = 'name' | 'phone' | 'address' | 'postalCode' | 'city';
const emptyContact = { name: '', phone: '', address: '', postalCode: '', city: '', deliveryNotes: '' };
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

/**
 * Checkout for pickup and the restaurant's own delivery: one page, only what is needed.
 *   Pickup: name, phone, pickup time.  Delivery: name, phone, address (fee shown as soon as the
 *   postal code is known), payment at the door.
 * Phones: one column with the confirm button fixed at the bottom. Desktop: the form on the left,
 * the order and its total on the right.
 *
 * Every figure comes from the server (quote endpoints) and is checked again when the order is
 * placed. A lost answer is retried with the same idempotency key: never two orders.
 */
export function CheckoutForm({
  channel,
  scope,
  lang,
  tag,
  m,
  menu,
  checkout,
  canOrder,
  message,
  allergyNotice,
  pricesIncludeVat,
  menuHref,
  method,
}: {
  channel: Exclude<OrderChannel, 'TABLE'>;
  scope: { orgSlug: string; locationSlug: string; locationId: string };
  lang: LanguageCode;
  tag: string;
  m: Msg;
  menu: PublicCategory[];
  checkout: CheckoutConfig;
  canOrder: boolean;
  message?: string;
  allergyNotice: string;
  pricesIncludeVat: boolean;
  /** The menu of this ordering method (to edit the order). */
  menuHref: string;
  /** How the order is received: title, one-line summary and the link to change method. */
  method: { title: string; summary: string[]; changeHref?: string; changeLabel?: string };
}) {
  const c = m.customer;
  const o = m.ordering;
  const router = useRouter();
  const money = useCallback((cents: number) => formatCents(cents, tag), [tag]);
  const country = checkout.country;
  const delivery = channel === 'DELIVERY';
  const { lines: stored, setLines, loaded } = useCart(cartKey(scope.locationId, channel));
  const { lines, images } = usePricedLines(stored, menu);
  const place = `${scope.orgSlug}/${scope.locationSlug}`;
  // Typed details survive a reload and switching method (same tab only; cleared after the order).
  const draftKey = `mn_checkout:REMOTE:${place}`;
  const [draft] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as Partial<{ couponInput: string; coupon: string; notes: string; contact: typeof emptyContact; pickup: string; payMethod: 'CASH_ON_DELIVERY' | 'CARD_TERMINAL' }> | null;
    } catch {
      return null;
    }
  });
  const [contact, setContact] = useState({ ...emptyContact, ...draft?.contact });
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [showNotes, setShowNotes] = useState(!!draft?.notes);
  const [showDriverNotes, setShowDriverNotes] = useState(!!draft?.contact?.deliveryNotes);
  const [couponInput, setCouponInput] = useState(draft?.couponInput ?? '');
  const [coupon, setCoupon] = useState(draft?.coupon ?? '');
  const [showCoupon, setShowCoupon] = useState(!!draft?.coupon);
  const choices = [...(checkout.pickup?.asapAllowed ? ['asap'] : []), ...(checkout.pickup?.slots.map((x) => x.value) ?? [])];
  const [pickup, setPickup] = useState(() => (draft?.pickup && choices.includes(draft.pickup) ? draft.pickup : (choices[0] ?? '')));
  const [payMethod, setPayMethod] = useState<'CASH_ON_DELIVERY' | 'CARD_TERMINAL'>(() => {
    const wanted = draft?.payMethod ?? 'CASH_ON_DELIVERY';
    if (wanted === 'CASH_ON_DELIVERY' && checkout.delivery?.cash === false) return 'CARD_TERMINAL';
    if (wanted === 'CARD_TERMINAL' && !checkout.delivery?.card) return 'CASH_ON_DELIVERY';
    return wanted;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ couponInput, coupon, notes, contact, pickup, payMethod }));
    } catch {}
  }, [draftKey, couponInput, coupon, notes, contact, pickup, payMethod]);

  const { quote, setQuote, quoting } = useCartQuote({ channel, lang, scope, lines, coupon });
  const [dq, setDq] = useState<DeliveryQuote | null>(null);
  const [dqLoading, setDqLoading] = useState(false);
  const itemsKey = JSON.stringify(cartItems(lines));
  const postalDigits = contact.postalCode.replace(/\D/g, '').length;
  useEffect(() => {
    if (!delivery || postalDigits < 5 || lines.length === 0) {
      setDqLoading(false);
      setDq(null);
      return;
    }
    const ctrl = new AbortController();
    setDqLoading(true);
    const t = setTimeout(() => {
      fetch('/api/public/delivery/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, postalCode: contact.postalCode, city: contact.city.trim().slice(0, 80), language: lang, items: cartItems(lines), couponCode: coupon || undefined }),
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((q) => setDq(q))
        .catch(() => {})
        .finally(() => !ctrl.signal.aborted && setDqLoading(false));
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // The town counts too: a restaurant can deliver to a whole town ("Braga") whatever its postal codes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.postalCode, contact.city, itemsKey, delivery, coupon]);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  // A second tap arrives before React re-renders the disabled button: this ref stops it at once.
  const inFlight = useRef(false);
  const idemKeyName = `mn_idem:${channel}:${place}`;
  const pendingKey = `mn_pending:${channel}:${place}`;
  const [pending, setPending] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(pendingKey);
    } catch {
      return null;
    }
  });
  const [idemKey] = useState(() => {
    const existing = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(idemKeyName) : null;
    const v = existing ?? uuid();
    try {
      sessionStorage.setItem(idemKeyName, v);
    } catch {}
    return v;
  });
  const formRef = useRef<HTMLDivElement>(null);

  const field = (k: keyof typeof contact) => ({
    value: contact[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setContact({ ...contact, [k]: e.target.value });
      if (fieldErrors[k as FieldKey]) {
        const next = { ...fieldErrors };
        delete next[k as FieldKey];
        setFieldErrors(next);
        if (Object.keys(next).length === 0 && error === o.fixFields) setError(null);
      }
    },
    'aria-invalid': fieldErrors[k as FieldKey] ? true : undefined,
  });

  const invalidPostal = country === 'ES' ? m.validation.invalidPostalCodeES : m.validation.invalidPostalCodePT;
  const issues = quote?.issues ?? [];
  const pickupMin = !delivery ? (checkout.pickup?.minOrderCents ?? 0) : 0;
  const shortPickup = quote && pickupMin > 0 && quote.subtotalCents < pickupMin ? pickupMin - quote.subtotalCents : 0;
  const shortDelivery = delivery && dq?.covered && !dq.meetsMinimum ? dq.minOrderCents - dq.subtotalCents : 0;
  const totalCents = delivery ? (dq?.covered ? dq.totalCents : null) : quote ? (quote.totalCents ?? quote.subtotalCents) : null;
  const count = lines.reduce((n, l) => n + l.quantity, 0);

  const validate = () => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (contact.name.trim().length < 2) e.name = o.nameRequired;
    if (!PHONE.test(contact.phone.trim())) e.phone = o.phoneInvalid;
    if (delivery) {
      if (contact.address.trim().length < 4) e.address = o.addressRequired;
      if (!contact.postalCode.trim()) e.postalCode = o.postalRequired;
      else if (!isValidPostalCode(country, contact.postalCode)) e.postalCode = invalidPostal;
      if (contact.city.trim().length < 2) e.city = o.cityRequired;
    }
    return e;
  };

  const submit = async () => {
    if (inFlight.current) return;
    if (!pending) {
      const errs = validate();
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        setError(o.fixFields);
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const common = { idempotencyKey: idemKey, language: lang, items: cartItems(lines), notes: notes.trim() || undefined, couponCode: coupon || undefined, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, customerName: contact.name.trim(), phone: contact.phone.trim() };
    const body =
      pending ??
      JSON.stringify(
        delivery
          ? { ...common, address: contact.address.trim(), postalCode: contact.postalCode.trim(), city: contact.city.trim(), deliveryNotes: contact.deliveryNotes.trim() || undefined, paymentMethod: payMethod }
          : { ...common, pickup },
      );
    try {
      sessionStorage.setItem(pendingKey, body);
    } catch {}
    const r = await postOrder(delivery ? '/api/public/orders/delivery' : '/api/public/orders/pickup', body);
    if (r.kind === 'ok') {
      // Nothing personal is kept once the order is placed (audit BUG-09).
      for (const k of [idemKeyName, pendingKey, draftKey]) sessionStorage.removeItem(k);
      setPlaced(true);
      setLines(() => []);
      rememberOrder(r.token);
      router.push(`/o/${r.token}`);
      return;
    }
    inFlight.current = false;
    setSubmitting(false);
    if (r.kind === 'unknown') {
      setPending(body);
      setError(c.submitUncertain);
      return;
    }
    try {
      sessionStorage.removeItem(pendingKey);
    } catch {}
    setPending(null);
    if (r.data.error === 'items_unavailable' && Array.isArray(r.data.issues)) setQuote((q) => (q ? { ...q, issues: r.data.issues as never } : { subtotalCents: 0, issues: r.data.issues as never }));
    if (r.data.error === 'invalid_postal_code') setFieldErrors((f) => ({ ...f, postalCode: invalidPostal }));
    setError(refusalMessage(m, r, country, money));
  };
  const submitAgain = useEffectEvent(() => void submit());
  useEffect(() => {
    if (!pending) return;
    const onOnline = () => submitAgain();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pending]);

  // Why the button cannot be used yet, in plain words (shown next to it).
  const blocker = !canOrder
    ? (message ?? c.orderingPaused)
    : issues.length
      ? c.priceChanged
      : shortPickup || shortDelivery
        ? fmt(o.addMoreForMinimum, { amount: money(shortPickup || shortDelivery) })
        : delivery && !dq?.covered
          ? postalDigits < 5
            ? o.enterPostal
            : dq && !dq.valid
              ? invalidPostal
              : dq?.needsCity
                ? o.enterCityForDelivery
                : dq
                  ? c.outsideDeliveryZone
                  : o.checkingArea
          : !delivery && !pickup
            ? c.noPickupSlots
            : null;
  const disabled = submitting || (!pending && (!quote || quoting || !!blocker));
  const label = delivery ? o.confirmDelivery : o.confirmPickup;

  if (!loaded || placed) return <div className="min-h-[60dvh]" aria-busy="true" />;
  if (lines.length === 0)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center" data-testid="checkout-empty">
        <span className="flex size-16 items-center justify-center rounded-full bg-sf-soft text-sf-primary-ink" aria-hidden>
          <Icon name="bag" className="size-7" />
        </span>
        <p className="mt-4 text-lg font-semibold">{c.cartEmpty}</p>
        <Link href={menuHref} className={sfButton('primary', 'lg', 'mt-6')}>
          {o.backToMenu}
        </Link>
      </div>
    );

  const p = checkout.pickup;
  const d = checkout.delivery;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 pb-48 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start lg:gap-12 lg:pt-10 lg:pb-16">
      <div ref={formRef} className="space-y-8" data-testid="checkout-step">
        <div className="space-y-5">
          <JourneySteps label={o.stepsLabel} current={1} steps={[{ label: o.stepMenu, href: menuHref }, { label: o.stepCheckout }, { label: o.stepDone }]} className="max-w-md" />
          <h1 className="font-serif text-[2rem] leading-tight sm:text-[2.4rem]">{o.checkoutTitle}</h1>
        </div>

        {/* How the order is received: shown once, changed only on request. */}
        <div className="flex items-start gap-4 rounded-3xl bg-sf-card p-4 ring-1 ring-sf-line sm:items-center" data-testid="checkout-method">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sf-soft text-sf-primary-ink" aria-hidden>
            <Icon name={delivery ? 'truck' : 'bag'} className="size-6" />
          </span>
          <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{method.title}</p>
              <p className="text-sm text-sf-muted">{method.summary.join(' · ')}</p>
            </div>
            {method.changeHref && (
              <a href={method.changeHref} className="-ms-1 mt-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-1 text-[15px] font-semibold text-sf-primary-ink hover:underline sm:mt-0 sm:-me-1 sm:ms-0 sm:px-3" data-testid="checkout-mode-switch">
                <Icon name={delivery ? 'bag' : 'truck'} className="size-4" />
                {method.changeLabel}
              </a>
            )}
          </div>
        </div>
        {!canOrder && message && (
          <SfNote icon="info" tone="brand" role="status">
            {message}
          </SfNote>
        )}

        <SfSection title={o.yourDetails}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SfField label={delivery ? c.recipientName : c.yourName} error={fieldErrors.name}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} {...field('name')} autoComplete="name" className={SF_INPUT} maxLength={80} data-testid="checkout-name" />}
            </SfField>
            <SfField label={c.phone} error={fieldErrors.phone}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} {...field('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder={country === 'ES' ? '+34 600 000 000' : '+351 912 345 678'} className={SF_INPUT} maxLength={20} data-testid="checkout-phone" />}
            </SfField>
          </div>
        </SfSection>

        {!delivery && p && (
          <SfSection title={o.pickupWhen}>
            {choices.length === 0 ? (
              <SfNote icon="clock" tone="warn">
                {c.noPickupSlots}
              </SfNote>
            ) : (
              <div className="relative">
                <Icon name="clock" className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-sf-muted" />
                <select value={pickup} onChange={(e) => setPickup(e.target.value)} className={cn(SF_INPUT, 'cursor-pointer appearance-none ps-12 pe-11 font-medium')} aria-label={c.pickupTime} data-testid="pickup-select">
                  {p.asapAllowed && <option value="asap">{`${o.today} · ${fmt(o.asapShort, { minutes: p.asapMinutes })}`}</option>}
                  {p.slots.map((sl) => (
                    <option key={sl.value} value={sl.value}>
                      {sl.day && sl.time ? `${sl.day} · ${sl.time}` : sl.label}
                    </option>
                  ))}
                </select>
                <Icon name="chevronDown" className="pointer-events-none absolute end-4 top-1/2 size-5 -translate-y-1/2 text-sf-muted" />
              </div>
            )}
            {!p.asapAllowed && (p.slots[0]?.day ?? o.today) !== o.today && <p className="text-sm text-sf-muted">{o.closedOrderLater}</p>}
            {(p.pickupPoint || p.address) && (
              <p className="flex items-start gap-2.5 text-sm text-sf-muted">
                <Icon name="map" className="mt-0.5 size-4 shrink-0" />
                <span>
                  {o.collectAt}: {p.pickupPoint && <span className="font-medium text-sf-text" data-testid="checkout-pickup-point">{p.pickupPoint}</span>}
                  {p.pickupPoint && p.address && ' · '}
                  {p.address}
                </span>
              </p>
            )}
          </SfSection>
        )}

        {delivery && (
          <SfSection title={o.deliveryAddress}>
            <SfField label={c.address} error={fieldErrors.address}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} {...field('address')} autoComplete="street-address" className={SF_INPUT} maxLength={200} data-testid="address-input" />}
            </SfField>
            <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
              <SfField label={c.postalCode} error={fieldErrors.postalCode}>
                {(id, describedBy) => <input id={id} aria-describedby={describedBy} {...field('postalCode')} placeholder={country === 'ES' ? '00000' : '0000-000'} autoComplete="postal-code" inputMode="numeric" className={SF_INPUT} maxLength={10} data-testid="postal-input" />}
              </SfField>
              <SfField label={c.city} error={fieldErrors.city}>
                {(id, describedBy) => <input id={id} aria-describedby={describedBy} {...field('city')} autoComplete="address-level2" className={SF_INPUT} maxLength={80} data-testid="city-input" />}
              </SfField>
            </div>
            {/* Coverage and fee for this postal code, straight from the restaurant's zones. */}
            {postalDigits < 5 ? (
              <SfNote icon="truck" testId="enter-postal">
                {o.enterPostal}
              </SfNote>
            ) : dqLoading && !dq ? (
              <SfNote icon="clock" role="status">
                {o.checkingArea}
              </SfNote>
            ) : dq && !dq.valid ? (
              <SfNote icon="alert" tone="error" role="alert">
                {invalidPostal}
              </SfNote>
            ) : dq && !dq.covered && dq.needsCity ? (
              <SfNote icon="map" testId="enter-city">
                {o.enterCityForDelivery}
              </SfNote>
            ) : dq && !dq.covered ? (
              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert" data-testid="outside-zone">
                {c.outsideDeliveryZone}
                {d?.pickupHref && (
                  <a href={d.pickupHref} className="mt-1 block font-semibold underline underline-offset-2">
                    {c.choosePickupInstead}
                  </a>
                )}
              </div>
            ) : dq?.covered ? (
              <div className={cn('flex items-center gap-3 rounded-2xl bg-sf-soft px-4 py-3 text-sm transition-opacity', dqLoading && 'opacity-60')} data-testid="delivery-zone">
                <Icon name="truck" className="size-5 shrink-0 text-sf-primary-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {c.deliveryFee} · {fmt(c.estimatedTime, { minutes: dq.estimatedMinutes })}
                  </span>
                  {dq.freeFromCents !== null && dq.feeCents > 0 && <span className="block text-sf-muted">{fmt(c.freeDeliveryFrom, { amount: money(dq.freeFromCents) })}</span>}
                </span>
                <span className="shrink-0 text-base font-semibold tabular-nums">{dq.feeCents === 0 ? c.deliveryFee0 : money(dq.feeCents)}</span>
              </div>
            ) : null}
            {showDriverNotes || contact.deliveryNotes ? (
              <SfField label={`${o.driverNotes} (${m.common.optional})`}>
                {(id) => <textarea id={id} autoFocus={showDriverNotes && !contact.deliveryNotes} {...field('deliveryNotes')} placeholder={o.driverNotesPlaceholder} className={cn(SF_INPUT, 'h-auto py-3')} rows={2} maxLength={300} />}
              </SfField>
            ) : (
              <AddLink onClick={() => setShowDriverNotes(true)} label={o.driverNotes} />
            )}
          </SfSection>
        )}

        {delivery && d && (
          <SfSection title={c.paymentMethod}>
            {d.cash && d.card ? (
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={c.paymentMethod}>
                {(['CASH_ON_DELIVERY', 'CARD_TERMINAL'] as const).map((pm) => (
                  <label key={pm} className={cn('flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl bg-sf-card px-4 py-3 ring-1 transition-colors', payMethod === pm ? 'bg-sf-soft font-semibold ring-2 ring-sf-primary' : 'ring-sf-line hover:bg-sf-sunken')}>
                    <input type="radio" name="pay" className="size-5 shrink-0 accent-[var(--sf-primary)]" checked={payMethod === pm} onChange={() => setPayMethod(pm)} />
                    <span className="text-[15px]">{pm === 'CASH_ON_DELIVERY' ? c.cashOnDelivery : c.cardOnDelivery}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[15px] font-medium">{d.card ? c.cardOnDelivery : c.cashOnDelivery}</p>
            )}
            <p className="flex items-center gap-2 text-sm text-sf-muted" data-testid="payment-note">
              <Icon name="card" className="size-4 shrink-0" />
              {o.payOnDelivery}
            </p>
          </SfSection>
        )}
        {!delivery && (
          <SfSection title={c.paymentMethod}>
            <p className="flex items-center gap-2 text-[15px]" data-testid="payment-note">
              <Icon name="card" className="size-4 shrink-0 text-sf-muted" />
              {o.payAtPickup}
            </p>
          </SfSection>
        )}

        {showNotes || notes ? (
          <SfField label={`${o.orderNotes} (${m.common.optional})`}>
            {(id) => <textarea id={id} autoFocus={showNotes && !notes} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 300))} placeholder={c.notesPlaceholder} className={cn(SF_INPUT, 'h-auto py-3')} rows={2} data-testid="order-notes" />}
          </SfField>
        ) : (
          <AddLink onClick={() => setShowNotes(true)} label={o.orderNotes} />
        )}
      </div>

      {/* The order: right column on desktop, end of the page on phones. */}
      <aside className="mt-10 lg:sticky lg:top-24 lg:mt-0" aria-label={c.cart}>
        <div className="rounded-3xl bg-sf-card p-5 ring-1 ring-sf-line lg:shadow-[var(--sf-shadow-card)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-serif text-[1.4rem] leading-tight">
              {c.cart} <span className="font-sans text-sm font-medium text-sf-muted tabular-nums">({count})</span>
            </h2>
            <Link href={menuHref} className="-me-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-sf-primary-ink hover:bg-sf-sunken" data-testid="checkout-edit-order">
              <Icon name="plus" className="size-4" />
              {o.addItems}
            </Link>
          </div>
          {/* Quantities change here; removing the last item leads back to the menu (empty state). */}
          <CartLineList lines={lines} setLines={setLines} images={images} money={money} m={m} issues={issues} disabled={submitting || !!pending} />

          <div className="mt-4 border-t border-sf-line pt-4">
            {showCoupon || coupon ? (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase().slice(0, 30))} placeholder={c.promoCode} aria-label={c.promoCode} className={cn(SF_INPUT, 'h-12 min-w-0 flex-1 uppercase')} data-testid="coupon-input" />
                  <button type="button" onClick={() => setCoupon(couponInput.trim())} className={sfButton('secondary', 'md', 'px-4')} data-testid="coupon-apply">
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
            ) : (
              <AddLink onClick={() => setShowCoupon(true)} label={c.promoCode} />
            )}
          </div>

          <dl className={cn('mt-4 space-y-2 border-t border-sf-line pt-4 text-[15px] transition-opacity', quoting && 'opacity-50')} aria-busy={quoting} data-testid="cart-totals">
            <div className="flex justify-between">
              <dt className="text-sf-muted">{c.subtotal}</dt>
              <dd className="tabular-nums">{quote ? money(quote.subtotalCents) : '…'}</dd>
            </div>
            {quote?.discounts?.map((x, i) => (
              <div key={i} className="flex justify-between text-emerald-800" data-testid="discount-line">
                <dt>{x.description}</dt>
                <dd className="tabular-nums">−{money(x.amountCents)}</dd>
              </div>
            ))}
            {delivery && (
              <div className="flex justify-between gap-3">
                <dt className="text-sf-muted">{c.deliveryFee}</dt>
                <dd className="text-end tabular-nums" data-testid="delivery-fee">
                  {dq?.covered ? (dq.feeCents === 0 ? c.deliveryFee0 : money(dq.feeCents)) : '—'}
                </dd>
              </div>
            )}
            <div className="flex justify-between pt-1 text-xl font-semibold">
              <dt>{o.totalToPay}</dt>
              <dd className="tabular-nums" data-testid="cart-total">{totalCents !== null ? money(totalCents) : '—'}</dd>
            </div>
            {pricesIncludeVat && <p className="text-xs text-sf-muted">{c.pricesIncludeVat}</p>}
          </dl>
          <details className="mt-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sf-muted [&::-webkit-details-marker]:hidden">
              <Icon name="info" className="size-4 shrink-0" />
              {c.allergyNoticeTitle}
            </summary>
            <p className="pb-1 text-sf-muted">{allergyNotice}</p>
          </details>

          {/* One confirm button: fixed at the bottom on phones, in this column on desktop. */}
          <div className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-sf-line bg-sf-bg/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <div className="mx-auto max-w-xl space-y-2 lg:max-w-none">
              {error && (
                <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" data-testid="submit-error">
                  {error}
                </p>
              )}
              {pending && !error && (
                <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" data-testid="submit-pending">
                  {c.submitUncertain}
                </p>
              )}
              {!error && !pending && blocker && quote && (
                <p className="text-center text-[13px] text-sf-muted" data-testid="submit-blocker">
                  {blocker}
                </p>
              )}
              <button type="button" disabled={disabled} onClick={submit} className={sfButton('primary', 'lg', 'w-full justify-between')} data-testid="submit-order" aria-busy={submitting}>
                {submitting ? (
                  <span className="flex w-full items-center justify-center gap-2">
                    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
                    {c.submitting}
                  </span>
                ) : pending ? (
                  <span className="w-full text-center">{c.retrySubmit}</span>
                ) : totalCents !== null ? (
                  <>
                    <span>{label}</span>
                    <span className="tabular-nums">{money(totalCents)}</span>
                  </>
                ) : (
                  <span className="w-full text-center">{label}</span>
                )}
              </button>
              {!delivery && checkout.whatsapp && (
                <a
                  href={`https://wa.me/${checkout.whatsapp.number}?text=${encodeURIComponent(buildWhatsAppText(m, checkout.whatsapp.restaurant, lines, money(totalCents ?? 0), { name: contact.name, phone: contact.phone, pickup: true }))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 text-center text-sm font-medium text-sf-muted underline underline-offset-2"
                  data-testid="whatsapp-send"
                >
                  {c.sendViaWhatsApp}
                </a>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function AddLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="-ms-1 inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-[15px] font-semibold text-sf-primary-ink hover:underline">
      <Icon name="plus" className="size-4" />
      {label}
    </button>
  );
}
