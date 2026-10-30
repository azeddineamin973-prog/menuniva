'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
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
  upsell,
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
  upsell?: React.ReactNode;
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
          upsell={upsell}
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
  onClose: () => void;
  onSubmitted: (trackingToken: string) => void;
}) {
  const c = m.customer;
  const [quote, setQuote] = useState<{ subtotalCents: number; issues: QuoteIssue[] } | null>(null);
  const [notes, setNotes] = useState('');
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
      body: JSON.stringify({ channel, language: lang, qrToken: scope.qrToken, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, items }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => q && setQuote(q))
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), channel, lang]);

  const issueText = (i: QuoteIssue) => (i.code === 'selection_rules' && i.group ? fmt(m.validation.chooseOption, { group: i.group }) : fmt(c.itemNoLongerAvailable, { name: i.name ?? lines[i.index]?.name ?? '' }));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const body = JSON.stringify({ qrToken: scope.qrToken, idempotencyKey: idemKey, language: lang, items, notes: notes.trim() || undefined });
    // Retries reuse the same idempotency key, so a flaky connection can never create two orders.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(channel === 'TABLE' ? '/api/public/orders/table' : '/api/public/orders/pickup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
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
              <li key={l.lineId} className={cn('rounded-2xl bg-white/80 p-3 ring-1', issue ? 'ring-red-300' : 'ring-black/5')}>
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
                  <button type="button" className="ms-auto text-sm underline opacity-70" onClick={() => setLines((ls) => ls.filter((x) => x.lineId !== l.lineId))}>{m.common.remove}</button>
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
            <div className="rounded-2xl border border-sf-accent/40 bg-white/60 p-3 text-sm">
              <p className="font-medium">{c.allergyNoticeTitle}</p>
              <p className="opacity-80">{allergyNotice}</p>
            </div>
            <div className="space-y-1 rounded-2xl bg-white/80 p-4">
              <div className="flex justify-between text-sm"><span>{c.subtotal}</span><span className="tabular-nums">{quote ? money(quote.subtotalCents) : '…'}</span></div>
              <div className="flex justify-between text-lg font-semibold"><span>{c.total}</span><span className="tabular-nums" data-testid="cart-total">{quote ? money(quote.subtotalCents) : '…'}</span></div>
              {pricesIncludeVat && <p className="text-xs opacity-60">{c.pricesIncludeVat}</p>}
              <p className="text-xs opacity-60">{c.paymentNote} {channel === 'TABLE' ? c.payToWaiter : c.payAtCounter}.</p>
            </div>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
            <button
              type="button"
              disabled={!canOrder || submitting || !quote || quote.issues.length > 0}
              onClick={submit}
              className="h-14 w-full rounded-2xl bg-sf-primary text-lg font-medium text-white disabled:opacity-50"
              data-testid="submit-order"
            >
              {submitting ? c.submitting : c.submitOrder}
            </button>
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
