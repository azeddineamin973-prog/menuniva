'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { pickSuggestions, type UpsellRuleView } from '@/lib/upsell';
import type { PublicCategory, PublicProduct } from '@/server/services/public-menu';

export type CartLine = {
  lineId: string;
  productId: string;
  variantId: string | null;
  modifiers: { optionId: string; quantity: number }[];
  quantity: number;
  notes: string;
  // display-only estimates; the server recalculates everything
  name: string;
  detail: string;
  unitCents: number;
};

type Msg = Pick<Messages, 'customer' | 'common' | 'allergens' | 'validation'>;
type QuoteIssue = { index: number; code: string; name?: string; group?: string };

/** Channel-specific checkout data computed on the server (slots, payment options, WhatsApp). */
export type CheckoutConfig = {
  country: 'PT' | 'ES';
  pickup?: { asapAllowed: boolean; asapMinutes: number; slots: { value: string; label: string }[]; minOrderCents: number; pickupPoint?: string | null };
  delivery?: { cash: boolean; card: boolean; pickupHref?: string };
  whatsapp?: { number: string; restaurant: string; only?: boolean };
};
type DeliveryQuote = { valid: boolean; covered: boolean; zoneName?: string; feeCents: number; minOrderCents: number; freeFromCents: number | null; subtotalCents: number; totalCents: number; meetsMinimum: boolean; estimatedMinutes: number };

/** Prefilled WhatsApp text. Opening WhatsApp does NOT send anything; the guest presses send. */
export function buildWhatsAppText(m: Msg, restaurant: string, lines: CartLine[], total: string, opts: { name?: string; address?: string; pickup: boolean }) {
  const c = m.customer;
  const out = [fmt(c.waIntro, { restaurant }), ...lines.map((l) => `• ${l.quantity} × ${l.name}${l.detail ? ` (${l.detail})` : ''}${l.notes ? ` — ${l.notes}` : ''}`), ''];
  out.push(opts.pickup ? c.waPickup : fmt(c.waDelivery, { address: opts.address ?? '' }));
  if (opts.name) out.push(fmt(c.waName, { name: opts.name }));
  out.push(fmt(c.waTotal, { total }));
  return out.join('\n');
}

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function useCart(storageKey: string) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setLines(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (loaded) localStorage.setItem(storageKey, JSON.stringify(lines));
  }, [lines, loaded, storageKey]);
  return { lines, setLines };
}

export function MenuApp({
  channel,
  scope,
  lang,
  tag,
  menu,
  canOrder,
  orderingMessage,
  m,
  allergyNotice,
  pricesIncludeVat,
  tableLabel,
  upsellRules,
  tableCodeRequired = false,
  checkout,
}: {
  channel: OrderChannel;
  scope: { qrToken?: string; orgSlug: string; locationSlug: string; locationId: string };
  lang: LanguageCode;
  tag: string;
  menu: PublicCategory[];
  canOrder: boolean;
  orderingMessage?: string;
  m: Msg;
  allergyNotice: string;
  pricesIncludeVat: boolean;
  tableLabel?: string;
  upsellRules?: UpsellRuleView[];
  tableCodeRequired?: boolean;
  checkout?: CheckoutConfig;
}) {
  const router = useRouter();
  const c = m.customer;
  const money = useCallback((cents: number) => formatCents(cents, tag), [tag]);
  const { lines, setLines } = useCart(`mn_cart_v1:${scope.locationId}:${channel}:${scope.qrToken ?? ''}`);
  const [open, setOpen] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(menu[0]?.id);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const estimate = lines.reduce((n, l) => n + l.unitCents * l.quantity, 0);
  const featured = useMemo(() => menu.flatMap((cat) => cat.products.filter((p) => p.isFeatured)), [menu]);

  const addLine = (line: CartLine) => {
    setLines((ls) => [...ls, line]);
    setOpen(null);
  };
  // Polite cart suggestions: shown only on request (cart open), never added automatically.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const suggestions = useMemo(() => (canOrder ? pickSuggestions(upsellRules ?? [], menu, lines.map((l) => l.productId), dismissed) : []), [canOrder, upsellRules, menu, lines, dismissed]);
  const acceptSuggestion = (ruleId: string, p: PublicProduct) => {
    trackUpsell(ruleId, 'ACCEPTED');
    const simple = p.variants.length === 0 && p.modifierGroups.every((g) => g.minSelect === 0);
    if (simple) {
      setLines((ls) => [...ls, { lineId: uid(), productId: p.id, variantId: null, modifiers: [], quantity: 1, notes: '', name: p.name, detail: '', unitCents: p.priceCents }]);
    } else {
      setCartOpen(false);
      setOpen(p); // the guest still chooses options and taps "add" themselves
    }
  };

  return (
    <div className="mx-auto max-w-3xl pb-32">
      {tableLabel && (
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-black/5 bg-sf-bg/95 px-4 py-2 backdrop-blur" data-testid="table-banner">
          <span className="rounded-full bg-sf-primary px-3 py-1 text-sm font-medium text-white">{fmt(c.table, { label: tableLabel })}</span>
          {scope.qrToken && <TableActions qrToken={scope.qrToken} m={m} />}
        </div>
      )}
      {!canOrder && orderingMessage && <div className="mx-4 mt-4 rounded-2xl border border-sf-accent/40 bg-white/70 p-3 text-sm" role="status">{orderingMessage}</div>}

      <nav className={cn('z-10 flex gap-2 overflow-x-auto bg-sf-bg/95 px-4 py-3 backdrop-blur', tableLabel ? 'sticky top-[49px]' : 'sticky top-0')} aria-label={c.menu}>
        {menu.map((cat) => (
          <a
            key={cat.id}
            href={`#cat-${cat.id}`}
            onClick={() => setActiveCat(cat.id)}
            className={cn('shrink-0 rounded-full border px-4 py-1.5 text-sm whitespace-nowrap', activeCat === cat.id ? 'border-sf-primary bg-sf-primary text-white' : 'border-black/10 bg-white/70')}
          >
            {cat.name}
          </a>
        ))}
      </nav>

      {menu.length === 0 && <p className="px-4 py-10 text-center opacity-70">{c.unavailable}</p>}

      {featured.length > 0 && (
        <section className="px-4 pt-2">
          <h2 className="mb-2 font-serif text-xl">{c.featured}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {featured.map((p) => (
              <button key={p.id} type="button" onClick={() => setOpen(p)} className="w-56 shrink-0 overflow-hidden rounded-2xl bg-white text-start shadow-sm">
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-32 w-full object-cover" /> : <div className="h-2 bg-sf-accent" />}
                <div className="p-3">
                  <p className="line-clamp-1 font-medium">{p.name}</p>
                  <p className="text-sm font-semibold text-sf-primary">{money(p.priceCents)}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {menu.map((cat) => (
        <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-28 px-4 pt-6">
          <h2 className="font-serif text-2xl">{cat.name}</h2>
          {cat.description && <p className="mt-1 text-sm opacity-70">{cat.description}</p>}
          <ul className="mt-3 space-y-3">
            {cat.products.map((p) => {
              const blocked = p.soldOut || !p.available;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => setOpen(p)}
                    className="flex w-full gap-3 rounded-2xl bg-white/85 p-3 text-start shadow-sm ring-1 ring-black/5 transition hover:bg-white disabled:opacity-60"
                    data-testid="customer-product"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.name}</p>
                      {p.description && <p className="mt-0.5 line-clamp-2 text-sm opacity-70">{p.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sf-primary">
                          {p.variants.length > 1 && <span className="text-xs font-normal opacity-70">{c.from} </span>}
                          {money(p.priceCents + Math.min(0, ...p.variants.map((v) => v.priceDeltaCents)))}
                        </span>
                        {p.soldOut && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{c.soldOut}</span>}
                        {!p.soldOut && !p.available && <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">{c.unavailable}</span>}
                        {p.isPopular && <span className="rounded-full bg-sf-accent/20 px-2 py-0.5 text-xs">{c.popular}</span>}
                      </div>
                    </div>
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover" loading="lazy" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {count > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-4">
          <button type="button" onClick={() => setCartOpen(true)} className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-sf-primary px-5 py-4 text-white shadow-lg" data-testid="view-cart">
            <span className="font-medium">{fmt(c.viewCart, { count })}</span>
            <span className="font-semibold tabular-nums">{money(estimate)}</span>
          </button>
        </div>
      )}

      {open && <ProductSheet product={open} m={m} money={money} canOrder={canOrder} onClose={() => setOpen(null)} onAdd={addLine} />}
      {cartOpen && (
        <CartSheet
          channel={channel}
          scope={scope}
          lang={lang}
          lines={lines}
          setLines={setLines}
          m={m}
          money={money}
          canOrder={canOrder}
          allergyNotice={allergyNotice}
          pricesIncludeVat={pricesIncludeVat}
          upsell={suggestions.length > 0 ? <UpsellBox suggestions={suggestions} m={m} money={money} onAdd={acceptSuggestion} onDismiss={(id) => setDismissed((d) => [...d, id])} /> : null}
          tableCodeRequired={tableCodeRequired}
          checkout={checkout}
          onClose={() => setCartOpen(false)}
          onSubmitted={(token) => {
            setLines([]);
            try {
              const list = JSON.parse(localStorage.getItem('mn_orders_v1') ?? '[]') as string[];
              localStorage.setItem('mn_orders_v1', JSON.stringify([token, ...list.filter((t) => t !== token)].slice(0, 10)));
            } catch {}
            router.push(`/o/${token}`);
          }}
        />
      )}
    </div>
  );
}

function trackUpsell(ruleId: string, type: 'SHOWN' | 'ACCEPTED') {
  fetch('/api/public/upsell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruleId, type }), keepalive: true }).catch(() => undefined);
}
function UpsellBox({ suggestions, m, money, onAdd, onDismiss }: { suggestions: { ruleId: string; product: PublicProduct }[]; m: Msg; money: (c: number) => string; onAdd: (ruleId: string, p: PublicProduct) => void; onDismiss: (ruleId: string) => void }) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const s of suggestions) {
      if (seen.current.has(s.ruleId)) continue;
      seen.current.add(s.ruleId);
      trackUpsell(s.ruleId, 'SHOWN');
    }
  }, [suggestions]);
  return (
    <section className="rounded-2xl bg-white/70 p-3 ring-1 ring-black/5" aria-label={m.customer.youMightAlsoLike} data-testid="upsell">
      <p className="mb-2 text-sm font-medium">{m.customer.youMightAlsoLike}</p>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.ruleId} className="flex items-center gap-3" data-testid="upsell-item">
            {s.product.imageUrl && <img src={s.product.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.product.name}</span>
              <span className="block text-xs tabular-nums opacity-70">{money(s.product.priceCents)}</span>
            </span>
            <button type="button" onClick={() => onAdd(s.ruleId, s.product)} className="h-9 rounded-xl bg-sf-primary px-3 text-sm font-medium text-white" data-testid="upsell-add">{m.customer.addSuggestion}</button>
            <button type="button" onClick={() => onDismiss(s.ruleId)} className="h-9 rounded-xl px-2 text-xs underline opacity-70" data-testid="upsell-dismiss">{m.customer.noThanks}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
function Sheet({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-sf-bg shadow-xl sm:rounded-3xl">{children}</div>
    </div>
  );
}

function ProductSheet({ product: p, m, money, canOrder, onClose, onAdd }: { product: PublicProduct; m: Msg; money: (c: number) => string; canOrder: boolean; onClose: () => void; onAdd: (l: CartLine) => void }) {
  const c = m.customer;
  const [variantId, setVariantId] = useState<string | null>(p.variants.find((v) => v.isDefault)?.id ?? p.variants[0]?.id ?? null);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [sel, setSel] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const variant = p.variants.find((v) => v.id === variantId);
  const modsUnit = p.modifierGroups.flatMap((g) => g.options).reduce((s, o) => s + (sel[o.id] ?? 0) * o.priceDeltaCents, 0);
  const unit = p.priceCents + (variant?.priceDeltaCents ?? 0) + modsUnit;

  const toggle = (groupId: string, optionId: string) => {
    const g = p.modifierGroups.find((x) => x.id === groupId)!;
    const inGroup = g.options.reduce((n, o) => n + (sel[o.id] ?? 0), 0);
    setSel((s) => {
      const cur = s[optionId] ?? 0;
      if (g.maxSelect === 1) {
        const next = { ...s };
        g.options.forEach((o) => delete next[o.id]);
        if (!cur) next[optionId] = 1;
        return next;
      }
      if (cur) {
        const next = { ...s };
        delete next[optionId];
        return next;
      }
      if (inGroup >= g.maxSelect) return s;
      return { ...s, [optionId]: 1 };
    });
  };

  const add = () => {
    for (const g of p.modifierGroups) {
      const n = g.options.reduce((k, o) => k + (sel[o.id] ?? 0), 0);
      if (n < g.minSelect || n > g.maxSelect) return setError(fmt(m.validation.chooseOption, { group: g.name }));
    }
    const chosen = p.modifierGroups.flatMap((g) => g.options.filter((o) => sel[o.id]).map((o) => o.name));
    onAdd({
      lineId: uid(),
      productId: p.id,
      variantId,
      modifiers: Object.entries(sel).map(([optionId, quantity]) => ({ optionId, quantity })),
      quantity: qty,
      notes: notes.trim(),
      name: p.name,
      detail: [variant?.name, ...chosen].filter(Boolean).join(' · '),
      unitCents: unit,
    });
  };

  const allergenList = (codes: string[]) => codes.map((x) => m.allergens[x as keyof Msg['allergens']]).join(', ');

  return (
    <Sheet onClose={onClose} label={p.name}>
      {p.imageUrl && <img src={p.imageUrl} alt="" className="h-56 w-full object-cover" />}
      <div className="space-y-5 p-5">
        <div>
          <h3 className="font-serif text-2xl">{p.name}</h3>
          {p.description && <p className="mt-1 opacity-80">{p.description}</p>}
          {p.ingredients && <p className="mt-2 text-sm opacity-70">{p.ingredients}</p>}
        </div>
        <div className="rounded-2xl bg-white/70 p-3 text-sm">
          <p className="font-medium">{c.allergens}</p>
          {p.allergens ? (
            <>
              {p.allergens.contains.length > 0 && <p>{fmt(c.containsAllergens, { list: allergenList(p.allergens.contains) })}</p>}
              {p.allergens.mayContain.length > 0 && <p>{fmt(c.mayContain, { list: allergenList(p.allergens.mayContain) })}</p>}
              {p.allergens.contains.length === 0 && p.allergens.mayContain.length === 0 && <p className="opacity-70">—</p>}
            </>
          ) : (
            <p className="opacity-70">{c.allergenInfoNotVerified}</p>
          )}
        </div>
        {p.variants.length > 0 && (
          <fieldset>
            <legend className="mb-2 font-medium">{c.chooseOne} <span className="text-xs opacity-60">· {c.requiredChoice}</span></legend>
            <div className="space-y-2">
              {p.variants.map((v) => (
                <label key={v.id} className={cn('flex cursor-pointer items-center justify-between rounded-xl border bg-white/70 px-3 py-2.5', variantId === v.id ? 'border-sf-primary' : 'border-black/10')}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} className="accent-[var(--sf-primary)]" />
                    {v.name}
                  </span>
                  <span className="text-sm tabular-nums">{money(p.priceCents + v.priceDeltaCents)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {p.modifierGroups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-2 font-medium">
              {g.name}{' '}
              <span className="text-xs opacity-60">
                · {g.maxSelect === 1 ? c.chooseOne : g.minSelect > 0 ? fmt(c.chooseBetween, { min: g.minSelect, max: g.maxSelect }) : fmt(c.chooseUpTo, { n: g.maxSelect })}
                {g.minSelect > 0 && ` · ${c.requiredChoice}`}
              </span>
            </legend>
            <div className="space-y-2">
              {g.options.map((o) => (
                <label key={o.id} className={cn('flex cursor-pointer items-center justify-between rounded-xl border bg-white/70 px-3 py-2.5', sel[o.id] ? 'border-sf-primary' : 'border-black/10')}>
                  <span className="flex items-center gap-2">
                    <input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={`g-${g.id}`} checked={!!sel[o.id]} onChange={() => toggle(g.id, o.id)} className="accent-[var(--sf-primary)]" />
                    {o.name}
                  </span>
                  {o.priceDeltaCents !== 0 && <span className="text-sm tabular-nums">{o.priceDeltaCents > 0 ? '+' : ''}{money(o.priceDeltaCents)}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="block">
          <span className="mb-1 block font-medium">{c.notesForKitchen} <span className="text-xs opacity-60">({m.common.optional})</span></span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 200))} placeholder={c.notesPlaceholder} className="min-h-[70px] w-full rounded-xl border border-black/10 bg-white/80 p-3 text-sm" />
        </label>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 border-t border-black/5 bg-sf-bg p-4">
          <div className="flex items-center rounded-xl border border-black/10 bg-white">
            <button type="button" className="h-11 w-11 text-xl" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">−</button>
            <span className="w-8 text-center tabular-nums" aria-label={c.quantity}>{qty}</span>
            <button type="button" className="h-11 w-11 text-xl" onClick={() => setQty(Math.min(50, qty + 1))} aria-label="+">+</button>
          </div>
          <button type="button" disabled={!canOrder || p.soldOut} onClick={add} className="h-12 flex-1 rounded-xl bg-sf-primary font-medium text-white disabled:opacity-50" data-testid="add-to-cart">
            {fmt(c.addToCartPrice, { price: money(unit * qty) })}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function CartSheet({
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
  tableCodeRequired,
  checkout,
  onClose,
  onSubmitted,
}: {
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
  tableCodeRequired?: boolean;
  checkout?: CheckoutConfig;
  onClose: () => void;
  onSubmitted: (trackingToken: string) => void;
}) {
  const c = m.customer;
  const [quote, setQuote] = useState<{ subtotalCents: number; discountCents?: number; totalCents?: number; discounts?: { description: string; amountCents: number }[]; couponStatus?: string; issues: QuoteIssue[] } | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState('');
  const [notes, setNotes] = useState('');
  const [tableCode, setTableCode] = useState('');
  const [contact, setContact] = useState({ name: '', phone: '', address: '', postalCode: '', city: '', deliveryNotes: '' });
  const [pickup, setPickup] = useState(() => (checkout?.pickup?.asapAllowed ? 'asap' : checkout?.pickup?.slots[0]?.value ?? ''));
  const [payMethod, setPayMethod] = useState<'CASH_ON_DELIVERY' | 'CARD_TERMINAL'>(checkout?.delivery?.cash === false ? 'CARD_TERMINAL' : 'CASH_ON_DELIVERY');
  const [dq, setDq] = useState<DeliveryQuote | null>(null);
  const field = (k: keyof typeof contact) => ({ value: contact[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setContact({ ...contact, [k]: e.target.value }) });
  const inputCls = 'h-11 w-full rounded-xl border border-black/10 bg-white/80 px-3 text-sm';
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => {
    const k = `mn_idem:${scope.qrToken ?? scope.locationSlug}`;
    const existing = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(k) : null;
    const v = existing ?? uid();
    try {
      sessionStorage.setItem(k, v);
    } catch {}
    return v;
  });
  const items = lines.map((l) => ({ productId: l.productId, variantId: l.variantId, modifiers: l.modifiers, quantity: l.quantity, notes: l.notes || undefined }));

  useEffect(() => {
    if (lines.length === 0) return setQuote(null);
    const ctrl = new AbortController();
    fetch('/api/public/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, language: lang, qrToken: scope.qrToken, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, items, couponCode: coupon || undefined }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => q && setQuote(q))
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), channel, lang, coupon]);

  useEffect(() => {
    if (channel !== 'DELIVERY' || contact.postalCode.replace(/\D/g, '').length < 5 || lines.length === 0) return setDq(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch('/api/public/delivery/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, postalCode: contact.postalCode, language: lang, items, couponCode: coupon || undefined }),
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((q) => q && setDq(q))
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.postalCode, JSON.stringify(items), channel, coupon]);

  const issueText = (i: QuoteIssue) => (i.code === 'selection_rules' && i.group ? fmt(m.validation.chooseOption, { group: i.group }) : fmt(c.itemNoLongerAvailable, { name: i.name ?? lines[i.index]?.name ?? '' }));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const common = { idempotencyKey: idemKey, language: lang, items, notes: notes.trim() || undefined, couponCode: coupon || undefined };
    const body = JSON.stringify(
      channel === 'TABLE'
        ? { ...common, qrToken: scope.qrToken, tableCode: tableCode.trim() || undefined }
        : channel === 'TAKEAWAY'
          ? { ...common, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, pickup, customerName: contact.name, phone: contact.phone }
          : { ...common, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, customerName: contact.name, phone: contact.phone, address: contact.address, postalCode: contact.postalCode, city: contact.city, deliveryNotes: contact.deliveryNotes || undefined, paymentMethod: payMethod },
    );
    const endpoint = channel === 'TABLE' ? '/api/public/orders/table' : channel === 'TAKEAWAY' ? '/api/public/orders/pickup' : '/api/public/orders/delivery';
    // Retries reuse the same idempotency key, so a flaky connection can never create two orders.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.trackingToken) {
          sessionStorage.removeItem(`mn_idem:${scope.qrToken ?? scope.locationSlug}`);
          return onSubmitted(data.trackingToken);
        }
        if (res.status === 422 && data.issues?.length) {
          setQuote((q) => (q ? { ...q, issues: data.issues } : { subtotalCents: 0, issues: data.issues }));
          setError(c.priceChanged);
        } else if (res.status === 429) setError(c.tooManyOrders);
        else if (typeof data.error === 'string' && data.error.startsWith('ordering_')) setError(c.orderingPaused);
        else if (data.error === 'qr_invalid') setError(c.qrInvalid);
        else if (data.error === 'table_code_invalid') setError(c.tableCodeInvalid);
        else if (data.error === 'table_not_open') setError(c.tableNotOpen);
        else if (data.error === 'below_minimum') setError(fmt(c.minimumOrder, { amount: money(data.minOrderCents ?? 0) }));
        else if (data.error === 'pickup_unavailable') setError(c.pickupUnavailable);
        else if (data.error === 'outside_delivery_zone') setError(c.outsideDeliveryZone);
        else if (data.error === 'invalid_postal_code') setError(checkout?.country === 'ES' ? m.validation.invalidPostalCodeES : m.validation.invalidPostalCodePT);
        else if (data.error === 'delivery_busy') setError(c.deliveryBusy);
        else if (data.error === 'validation_failed') setError(m.validation.required);
        else if (data.error === 'coupon_invalid' || data.error === 'promotion_unavailable') setError(c.promoInvalid);
        else if (res.status >= 500) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        } else setError(m.common.retry);
        setSubmitting(false);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    setError(m.common.connectionLost);
    setSubmitting(false);
  };

  return (
    <Sheet onClose={onClose} label={c.cart}>
      <div className="space-y-4 p-5" data-testid="cart-sheet">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-2xl">{c.cart}</h3>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm ring-1 ring-black/10">{m.common.close}</button>
        </div>
        {lines.length === 0 && <p className="opacity-70">{c.cartEmpty}</p>}
        <ul className="space-y-2">
          {lines.map((l, i) => {
            const issue = quote?.issues.find((x) => x.index === i);
            return (
              <li key={l.lineId} className={cn('rounded-2xl bg-white/80 p-3 ring-1', issue ? 'ring-red-300' : 'ring-black/5')} data-testid="cart-line">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{l.name}</p>
                    {l.detail && <p className="text-xs opacity-70">{l.detail}</p>}
                    {l.notes && <p className="text-xs italic opacity-70">“{l.notes}”</p>}
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{money(l.unitCents * l.quantity)}</p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" className="h-8 w-8 rounded-lg ring-1 ring-black/10" onClick={() => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} aria-label="−">−</button>
                  <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                  <button type="button" className="h-8 w-8 rounded-lg ring-1 ring-black/10" onClick={() => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? { ...x, quantity: Math.min(50, x.quantity + 1) } : x)))} aria-label="+">+</button>
                  <button type="button" className="ms-auto h-8 px-2 text-sm underline opacity-70" onClick={() => setLines((ls) => ls.filter((x) => x.lineId !== l.lineId))}>{m.common.remove}</button>
                </div>
                {issue && <p className="mt-2 text-sm text-red-700" role="alert">{issueText(issue)}</p>}
              </li>
            );
          })}
        </ul>
        {upsell}
        {lines.length > 0 && (
          <>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{c.notesForKitchen} <span className="text-xs opacity-60">({m.common.optional})</span></span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 300))} className="min-h-[60px] w-full rounded-xl border border-black/10 bg-white/80 p-3 text-sm" placeholder={c.notesPlaceholder} />
            </label>
            {tableCodeRequired && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium">{c.tableCode}</span>
                <input value={tableCode} onChange={(e) => setTableCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" className="h-12 w-full rounded-xl border border-black/10 bg-white/80 px-3 text-center text-xl tracking-[0.5em]" data-testid="table-code-input" />
                <span className="mt-1 block text-xs opacity-70">{c.tableCodeHint}</span>
              </label>
            )}
            {channel !== 'TABLE' && (
              <fieldset className="space-y-2 rounded-2xl bg-white/60 p-3" data-testid="checkout-fields">
                <legend className="px-1 text-sm font-medium">{channel === 'TAKEAWAY' ? c.checkoutPickup : c.checkoutDelivery}</legend>
                <input {...field('name')} placeholder={channel === 'DELIVERY' ? c.recipientName : c.yourName} aria-label={channel === 'DELIVERY' ? c.recipientName : c.yourName} autoComplete="name" className={inputCls} required maxLength={80} />
                <input {...field('phone')} placeholder={c.phone} aria-label={c.phone} type="tel" autoComplete="tel" className={inputCls} required maxLength={20} />
                {channel === 'TAKEAWAY' && checkout?.pickup && (
                  <label className="block text-sm">
                    <span className="mb-1 block">{c.pickupTime}</span>
                    {!checkout.pickup.asapAllowed && checkout.pickup.slots.length === 0 ? (
                      <span className="block rounded-xl bg-amber-50 p-2 text-amber-900">{c.noPickupSlots}</span>
                    ) : (
                      <select value={pickup} onChange={(e) => setPickup(e.target.value)} className={inputCls} data-testid="pickup-select">
                        {checkout.pickup.asapAllowed && <option value="asap">{c.asap} (~{checkout.pickup.asapMinutes} min)</option>}
                        {checkout.pickup.slots.map((sl) => <option key={sl.value} value={sl.value}>{sl.label}</option>)}
                      </select>
                    )}
                    {checkout.pickup.pickupPoint && <span className="mt-1 block text-xs opacity-80" data-testid="checkout-pickup-point">{fmt(c.pickupPoint, { place: checkout.pickup.pickupPoint })}</span>}
                  </label>
                )}
                {channel === 'DELIVERY' && (
                  <>
                    <input {...field('address')} placeholder={c.address} aria-label={c.address} autoComplete="street-address" className={inputCls} required maxLength={200} />
                    <div className="grid grid-cols-2 gap-2">
                      <input {...field('postalCode')} placeholder={checkout?.country === 'ES' ? '00000' : '0000-000'} aria-label={c.postalCode} autoComplete="postal-code" inputMode="numeric" className={inputCls} maxLength={10} data-testid="postal-input" />
                      <input {...field('city')} placeholder={c.city} aria-label={c.city} autoComplete="address-level2" className={inputCls} maxLength={80} />
                    </div>
                    <textarea {...field('deliveryNotes')} placeholder={c.deliveryNotes} aria-label={c.deliveryNotes} className="min-h-[50px] w-full rounded-xl border border-black/10 bg-white/80 p-3 text-sm" maxLength={300} />
                    {dq && !dq.valid && <p className="text-sm text-red-700" role="alert">{checkout?.country === 'ES' ? m.validation.invalidPostalCodeES : m.validation.invalidPostalCodePT}</p>}
                    {dq && dq.valid && !dq.covered && (
                      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert" data-testid="outside-zone">
                        {c.outsideDeliveryZone}
                        {checkout?.delivery?.pickupHref && <a href={checkout.delivery.pickupHref} className="mt-1 block font-medium underline">{c.choosePickupInstead}</a>}
                      </div>
                    )}
                    {dq?.covered && (
                      <p className="text-xs opacity-70" data-testid="delivery-zone">
                        {dq.zoneName} · {fmt(c.estimatedTime, { minutes: dq.estimatedMinutes })}
                        {dq.freeFromCents !== null && ` · ${fmt(c.freeDeliveryFrom, { amount: money(dq.freeFromCents) })}`}
                        {!dq.meetsMinimum && <span className="block font-medium text-red-700">{fmt(c.minimumOrder, { amount: money(dq.minOrderCents) })}</span>}
                      </p>
                    )}
                    <fieldset className="text-sm">
                      <legend className="mb-1">{c.paymentMethod}</legend>
                      {checkout?.delivery?.cash && <label className="flex items-center gap-2"><input type="radio" checked={payMethod === 'CASH_ON_DELIVERY'} onChange={() => setPayMethod('CASH_ON_DELIVERY')} />{c.cashOnDelivery}</label>}
                      {checkout?.delivery?.card && <label className="flex items-center gap-2"><input type="radio" checked={payMethod === 'CARD_TERMINAL'} onChange={() => setPayMethod('CARD_TERMINAL')} />{c.cardOnDelivery}</label>}
                    </fieldset>
                  </>
                )}
              </fieldset>
            )}
            <div className="rounded-2xl border border-sf-accent/40 bg-white/60 p-3 text-sm">
              <p className="font-medium">{c.allergyNoticeTitle}</p>
              <p className="opacity-80">{allergyNotice}</p>
            </div>
            {!checkout?.whatsapp?.only && (
              <div className="flex gap-2">
                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase().slice(0, 30))} placeholder={c.promoCode} aria-label={c.promoCode} className="h-11 flex-1 rounded-xl border border-black/10 bg-white/80 px-3 text-sm uppercase" data-testid="coupon-input" />
                <button type="button" onClick={() => setCoupon(couponInput.trim())} className="rounded-xl px-4 text-sm font-medium ring-1 ring-black/10" data-testid="coupon-apply">{c.apply}</button>
              </div>
            )}
            {coupon && quote?.couponStatus && quote.couponStatus !== 'valid' && <p className="text-sm text-red-700" role="alert" data-testid="coupon-error">{c.promoInvalid}</p>}
            <div className="space-y-1 rounded-2xl bg-white/80 p-4">
              <div className="flex justify-between text-sm"><span>{c.subtotal}</span><span className="tabular-nums">{quote ? money(quote.subtotalCents) : '…'}</span></div>
              {quote?.discounts?.map((d, i) => (
                <div key={i} className="flex justify-between text-sm text-emerald-800" data-testid="discount-line"><span>{c.discount}: {d.description}</span><span className="tabular-nums">−{money(d.amountCents)}</span></div>
              ))}
              {channel === 'DELIVERY' && (
                <div className="flex justify-between text-sm"><span>{c.deliveryFee}</span><span className="tabular-nums" data-testid="delivery-fee">{dq?.covered ? (dq.feeCents === 0 ? c.deliveryFee0 : money(dq.feeCents)) : '—'}</span></div>
              )}
              <div className="flex justify-between text-lg font-semibold"><span>{c.total}</span><span className="tabular-nums" data-testid="cart-total">{channel === 'DELIVERY' && dq?.covered ? money(dq.totalCents) : quote ? money(quote.totalCents ?? quote.subtotalCents) : '…'}</span></div>
              {!!quote?.discountCents && <p className="text-sm font-medium text-emerald-800" data-testid="you-save">{fmt(c.youSave, { amount: money(quote.discountCents) })}</p>}
              {pricesIncludeVat && <p className="text-xs opacity-60">{c.pricesIncludeVat}</p>}
              <p className="text-xs opacity-60">{channel === 'DELIVERY' ? `${c.paymentNote}` : `${c.paymentNote} ${channel === 'TABLE' ? c.payToWaiter : c.payAtCounter}.`}</p>
            </div>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
            {!checkout?.whatsapp?.only && (
              <button
                type="button"
                disabled={
                  !canOrder ||
                  submitting ||
                  !quote ||
                  quote.issues.length > 0 ||
                  (channel === 'DELIVERY' && (!dq?.covered || !dq.meetsMinimum)) ||
                  (channel === 'TAKEAWAY' && !pickup)
                }
                onClick={submit}
                className="h-14 w-full rounded-2xl bg-sf-primary text-lg font-medium text-white disabled:opacity-50"
                data-testid="submit-order"
              >
                {submitting ? c.submitting : c.submitOrder}
              </button>
            )}
            {checkout?.whatsapp && (
              <div className="space-y-1">
                <a
                  href={`https://wa.me/${checkout.whatsapp.number}?text=${encodeURIComponent(buildWhatsAppText(m, checkout.whatsapp.restaurant, lines, money(quote ? quote.subtotalCents : lines.reduce((n, l) => n + l.unitCents * l.quantity, 0)), { name: contact.name, pickup: channel !== 'DELIVERY', address: contact.address }))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#1f7a4c] font-medium text-white"
                  data-testid="whatsapp-send"
                >
                  {c.sendViaWhatsApp}
                </a>
                <p className="text-xs opacity-70">{c.whatsappOpenNote} {c.waPricesNote}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function TableActions({ qrToken, m }: { qrToken: string; m: Msg }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (type: 'CALL_WAITER' | 'REQUEST_BILL') => {
    setBusy(true);
    try {
      const r = await fetch('/api/public/table-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken, type }) });
      setMsg(r.ok ? (type === 'CALL_WAITER' ? m.customer.waiterCalled : `${m.customer.billRequested} ${m.customer.billNotInvoice}`) : r.status === 429 ? m.customer.tooManyOrders : m.common.retry);
    } catch {
      setMsg(m.common.connectionLost);
    }
    setBusy(false);
    setTimeout(() => setMsg(null), 7000);
  };
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" disabled={busy} onClick={() => send('CALL_WAITER')} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium ring-1 ring-black/10" data-testid="call-waiter">{m.customer.callWaiter}</button>
      <button type="button" disabled={busy} onClick={() => send('REQUEST_BILL')} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium ring-1 ring-black/10" data-testid="request-bill">{m.customer.requestBill}</button>
      {msg && (
        <p role="status" className="fixed inset-x-4 top-16 z-50 mx-auto max-w-md rounded-2xl bg-sf-primary p-3 text-center text-sm text-white shadow-lg">{msg}</p>
      )}
    </div>
  );
}
