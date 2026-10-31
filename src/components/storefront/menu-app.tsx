'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { pickSuggestions, type UpsellRuleView } from '@/lib/upsell';
import { buildWhatsAppText } from '@/lib/whatsapp';
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

export { buildWhatsAppText };

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
  orderActions = [],
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
  /** Ways to order, offered inside a dish when this page is browse-only. */
  orderActions?: { label: string; href: string }[];
}) {
  const router = useRouter();
  const c = m.customer;
  const money = useCallback((cents: number) => formatCents(cents, tag), [tag]);
  const { lines, setLines } = useCart(`mn_cart_v1:${scope.locationId}:${channel}:${scope.qrToken ?? ''}`);
  const [open, setOpen] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(menu[0]?.id);
  const [search, setSearch] = useState('');
  // The table banner can wrap to two lines on small phones; the sticky category bar sits right
  // under it, so its offset follows the banner's real height instead of a fixed pixel value.
  const bannerRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLElement>(null);
  const [bannerHeight, setBannerHeight] = useState(0);
  const [chipsHeight, setChipsHeight] = useState(60);
  useEffect(() => {
    const update = () => {
      setBannerHeight(bannerRef.current?.getBoundingClientRect().height ?? 0);
      if (chipsRef.current) setChipsHeight(chipsRef.current.getBoundingClientRect().height);
    };
    update();
    const ro = new ResizeObserver(update);
    for (const el of [bannerRef.current, chipsRef.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** Height covered by the sticky bars: category jumps land just below it. */
  const stickyOffset = bannerHeight + chipsHeight;
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const estimate = lines.reduce((n, l) => n + l.unitCents * l.quantity, 0);
  const featured = useMemo(() => menu.flatMap((cat) => cat.products.filter((p) => p.isFeatured)), [menu]);

  // Searching filters the same data the page already has, so it works offline and instantly.
  // Accents are stripped so "cha" finds "Chá".
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const needle = fold(search.trim());
  const shownMenu = useMemo(() => {
    if (!needle) return menu;
    return menu
      .map((cat) => ({ ...cat, products: cat.products.filter((p) => fold(p.name).includes(needle) || fold(p.description ?? '').includes(needle)) }))
      .filter((cat) => cat.products.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, needle]);
  const matches = shownMenu.reduce((n, cat) => n + cat.products.length, 0);

  // Scroll-spy: the chip of the category being read is highlighted and kept in view.
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let current = shownMenu[0]?.id;
        for (const cat of shownMenu) {
          const el = document.getElementById(`cat-${cat.id}`);
          if (el && el.getBoundingClientRect().top - (stickyOffset + 16) <= 0) current = cat.id;
        }
        if (current) setActiveCat(current);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [shownMenu, stickyOffset]);
  useEffect(() => {
    const nav = chipsRef.current;
    const chip = nav?.querySelector<HTMLElement>(`[data-cat="${activeCat}"]`);
    if (!nav || !chip) return;
    const n = nav.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    // scrollBy with a physical delta works the same in right-to-left (Arabic) menus.
    if (r.left < n.left + 8 || r.right > n.right - 8) nav.scrollBy({ left: r.left + r.width / 2 - (n.left + n.width / 2), behavior: 'smooth' });
  }, [activeCat]);

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
        <div ref={bannerRef} className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-1.5 border-b border-black/5 bg-sf-bg/95 px-4 py-2 backdrop-blur" data-testid="table-banner">
          <span className="shrink-0 rounded-full bg-sf-primary px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-white">{fmt(c.table, { label: tableLabel })}</span>
          {scope.qrToken && <TableActions qrToken={scope.qrToken} m={m} />}
        </div>
      )}
      {!canOrder && orderingMessage && (
        <div className="mx-4 mt-4 rounded-2xl border border-sf-accent/40 bg-white/70 p-3 text-sm" role="status">
          {orderingMessage}
        </div>
      )}

      {menu.length > 0 && (
        <div className="px-4 pt-3">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-3.5 flex items-center opacity-50" aria-hidden>
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
            </span>
            {/* 16 px text: iOS Safari zooms the page into smaller fields. */}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={c.searchMenu}
              aria-label={c.searchMenu}
              enterKeyHint="search"
              className="h-11 w-full rounded-full border border-black/10 bg-white/90 ps-10 pe-11 text-base shadow-sm focus:border-sf-primary focus:ring-2 focus:ring-sf-primary/20 focus:outline-none"
              data-testid="menu-search"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label={c.clearSearch} className="absolute inset-y-0 end-1 flex w-10 items-center justify-center text-xl opacity-60" data-testid="menu-search-clear">
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {/* Category chips stay under the table banner, whatever height the banner wraps to. */}
      <div className="sticky z-10 bg-sf-bg/95 backdrop-blur" style={{ top: bannerHeight }}>
        <nav ref={chipsRef} className="flex gap-2 overflow-x-auto scroll-smooth px-4 py-2.5 [scrollbar-width:none]" aria-label={c.menu}>
          {shownMenu.map((cat) => (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              onClick={() => setActiveCat(cat.id)}
              aria-current={activeCat === cat.id ? 'true' : undefined}
              data-cat={cat.id}
              className={cn(
                'flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition',
                activeCat === cat.id ? 'border-sf-primary bg-sf-primary text-white shadow-sm' : 'border-black/10 bg-white/70 hover:bg-white',
              )}
            >
              {cat.name}
            </a>
          ))}
        </nav>
      </div>

      {menu.length === 0 && <p className="px-4 py-10 text-center opacity-70">{c.unavailable}</p>}
      {menu.length > 0 && matches === 0 && (
        <p className="px-4 py-10 text-center opacity-70" role="status" data-testid="menu-no-results">
          {c.noDishesFound}
        </p>
      )}

      {featured.length > 0 && !needle && (
        <section className="px-4 pt-2">
          <h2 className="mb-2 font-serif text-xl">{c.featured}</h2>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {featured.map((p) => (
              <button key={p.id} type="button" onClick={() => setOpen(p)} className="w-56 shrink-0 overflow-hidden rounded-3xl bg-white text-start shadow-sm ring-1 ring-black/5 transition hover:shadow-md">
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-36 w-full bg-sf-accent/10 object-cover" decoding="async" /> : <NoPhoto className="h-36 w-full" />}
                <div className="p-3">
                  <p className="line-clamp-1 font-medium">{p.name}</p>
                  <p className="text-sm font-semibold text-sf-primary">{money(p.priceCents)}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {shownMenu.map((cat) => (
        <section key={cat.id} id={`cat-${cat.id}`} className="px-4 pt-7" style={{ scrollMarginTop: stickyOffset + 8 }}>
          <h2 className="font-serif text-2xl">{cat.name}</h2>
          {cat.description && <p className="mt-1 text-sm opacity-70">{cat.description}</p>}
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {cat.products.map((p) => {
              const blocked = p.soldOut || !p.available;
              const from = p.priceCents + Math.min(0, ...p.variants.map((v) => v.priceDeltaCents));
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => setOpen(p)}
                    className="group flex h-full w-full gap-3 rounded-3xl bg-white/90 p-3 text-start shadow-sm ring-1 ring-black/5 transition hover:shadow-md disabled:opacity-55"
                    data-testid="customer-product"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="font-medium leading-snug">{p.name}</p>
                      {p.description && <p className="mt-1 line-clamp-2 text-sm opacity-70">{p.description}</p>}
                      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                        <span className="rounded-full bg-sf-primary/10 px-2.5 py-1 text-sm font-semibold text-sf-primary tabular-nums">
                          {p.variants.length > 1 && <span className="text-xs font-normal opacity-70">{c.from} </span>}
                          {money(from)}
                        </span>
                        {p.soldOut && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{c.soldOut}</span>}
                        {!p.soldOut && !p.available && <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">{c.unavailable}</span>}
                        {p.isPopular && <span className="rounded-full bg-sf-accent/20 px-2 py-0.5 text-xs">{c.popular}</span>}
                      </div>
                    </div>
                    {/* A dish with no photo gets a neutral brand-coloured tile rather than a
                        broken-image frame, so rows stay the same height either way. */}
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="h-24 w-24 shrink-0 rounded-2xl bg-sf-accent/10 object-cover sm:h-28 sm:w-28" loading="lazy" decoding="async" width={112} height={112} />
                    ) : (
                      <NoPhoto className="h-24 w-24 rounded-2xl sm:h-28 sm:w-28" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {count > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => setCartOpen(true)} className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-sf-primary px-5 py-4 text-white shadow-lg active:scale-[0.99]" data-testid="view-cart">
            <span className="font-medium">{fmt(c.viewCart, { count })}</span>
            <span className="font-semibold tabular-nums">{money(estimate)}</span>
          </button>
        </div>
      )}

      {open && <ProductSheet product={open} m={m} money={money} canOrder={canOrder} orderActions={orderActions} onClose={() => setOpen(null)} onAdd={addLine} />}
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

/**
 * Tile for a dish without a photo: a quiet serving-cloche mark in the restaurant's accent colour,
 * so the card looks finished rather than like an image that failed to load.
 */
function NoPhoto({ className }: { className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center bg-sf-accent/15 text-sf-accent', className)} aria-hidden data-testid="no-photo">
      <svg viewBox="0 0 48 48" className="size-9 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 32a15 15 0 0 1 30 0z" />
        <path d="M6 36h36M24 14v3" />
        <circle cx="24" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
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
/**
 * Bottom sheet (phones) / centred card (larger screens). Behaves as a modal dialog: focus moves
 * into it and back to the dish or cart button afterwards, Tab stays inside, Escape and the
 * backdrop close it, and the menu behind does not scroll.
 */
function Sheet({ children, onClose, label, closeLabel }: { children: React.ReactNode; onClose: () => void; label: string; closeLabel: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeRef.current();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea')];
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={label}>
      {/* Tapping outside closes the sheet; keyboard and screen-reader users have Escape and the close button. */}
      <button type="button" aria-hidden tabIndex={-1} title={closeLabel} className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl bg-sf-bg shadow-xl outline-none sm:rounded-3xl">
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn('flex size-10 items-center justify-center rounded-full bg-white/90 text-xl leading-none shadow-sm ring-1 ring-black/10', className)} data-testid="sheet-close">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

function ProductSheet({
  product: p,
  m,
  money,
  canOrder,
  orderActions = [],
  onClose,
  onAdd,
}: {
  product: PublicProduct;
  m: Msg;
  money: (c: number) => string;
  canOrder: boolean;
  orderActions?: { label: string; href: string }[];
  onClose: () => void;
  onAdd: (l: CartLine) => void;
}) {
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
    <Sheet onClose={onClose} label={p.name} closeLabel={m.common.close}>
      <div className="sticky top-0 z-10 h-0">
        <CloseButton onClick={onClose} label={m.common.close} className="absolute end-3 top-3" />
      </div>
      {p.imageUrl && <img src={p.imageUrl} alt="" className="aspect-[4/3] max-h-64 w-full bg-sf-accent/10 object-cover sm:aspect-[16/9]" />}
      <div className="space-y-5 p-5">
        <div className={cn(!p.imageUrl && 'pe-12')}>
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
                    <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} className="size-5 shrink-0 accent-[var(--sf-primary)]" />
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
                    <input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={`g-${g.id}`} checked={!!sel[o.id]} onChange={() => toggle(g.id, o.id)} className="size-5 shrink-0 accent-[var(--sf-primary)]" />
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
          <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 200))} placeholder={c.notesPlaceholder} className="min-h-[70px] w-full rounded-xl border border-black/10 bg-white/80 p-3 text-base" />
        </label>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {/* On a browse-only page (the public storefront) there is nothing to add to, so the
            quantity stepper and a permanently greyed-out "Add" button are replaced by the ways
            the guest can actually order. */}
        {canOrder ? (
          <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 border-t border-black/5 bg-sf-bg p-4">
            <div className="flex items-center rounded-xl border border-black/10 bg-white">
              <button type="button" className="h-11 w-11 text-xl" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">−</button>
              <span className="w-8 text-center tabular-nums" aria-label={c.quantity}>{qty}</span>
              <button type="button" className="h-11 w-11 text-xl" onClick={() => setQty(Math.min(50, qty + 1))} aria-label="+">+</button>
            </div>
            <button type="button" disabled={p.soldOut} onClick={add} className="h-12 flex-1 rounded-xl bg-sf-primary font-medium text-white disabled:opacity-50" data-testid="add-to-cart">
              {fmt(c.addToCartPrice, { price: money(unit * qty) })}
            </button>
          </div>
        ) : (
          orderActions.length > 0 && (
            <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2 border-t border-black/5 bg-sf-bg p-4" data-testid="sheet-order-actions">
              <p className="text-sm font-medium">{c.howToOrder}</p>
              <div className="grid gap-2">
                {orderActions.map((a) => (
                  <a key={a.href} href={a.href} className="flex h-12 items-center justify-center rounded-xl bg-sf-primary font-medium text-white">
                    {a.label}
                  </a>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </Sheet>
  );
}

const emptyContact = { name: '', phone: '', address: '', postalCode: '', city: '', deliveryNotes: '' };

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
  // `forCoupon`: the code this quote was computed with — an error is only shown for the current code
  // (audit BUG-08: a valid code briefly showed "not valid" from the previous quote).
  const [quote, setQuote] = useState<{ subtotalCents: number; discountCents?: number; totalCents?: number; discounts?: { description: string; amountCents: number }[]; couponStatus?: string; forCoupon?: string; issues: QuoteIssue[] } | null>(null);
  // What the guest typed survives closing and reopening the cart (audit BUG-09). Kept only in this
  // browser tab (sessionStorage) and cleared once the order is confirmed.
  const scopeKey = `${channel}:${scope.qrToken ?? `${scope.orgSlug}/${scope.locationSlug}`}`;
  const draftKey = `mn_checkout:${scopeKey}`;
  const [draft] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as Partial<{ couponInput: string; coupon: string; notes: string; tableCode: string; contact: typeof emptyContact; pickup: string; payMethod: 'CASH_ON_DELIVERY' | 'CARD_TERMINAL' }> | null;
    } catch {
      return null;
    }
  });
  const [couponInput, setCouponInput] = useState(draft?.couponInput ?? '');
  const [coupon, setCoupon] = useState(draft?.coupon ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [tableCode, setTableCode] = useState(draft?.tableCode ?? '');
  const [contact, setContact] = useState({ ...emptyContact, ...draft?.contact });
  const [pickup, setPickup] = useState(() => {
    const options = [...(checkout?.pickup?.asapAllowed ? ['asap'] : []), ...(checkout?.pickup?.slots.map((x) => x.value) ?? [])];
    return draft?.pickup && options.includes(draft.pickup) ? draft.pickup : options[0] ?? '';
  });
  const [payMethod, setPayMethod] = useState<'CASH_ON_DELIVERY' | 'CARD_TERMINAL'>(draft?.payMethod ?? (checkout?.delivery?.cash === false ? 'CARD_TERMINAL' : 'CASH_ON_DELIVERY'));
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ couponInput, coupon, notes, tableCode, contact, pickup, payMethod }));
    } catch {}
  }, [draftKey, couponInput, coupon, notes, tableCode, contact, pickup, payMethod]);
  const [dq, setDq] = useState<DeliveryQuote | null>(null);
  const field = (k: keyof typeof contact) => ({ value: contact[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setContact({ ...contact, [k]: e.target.value }) });
  const inputCls = 'h-11 w-full rounded-xl border border-black/10 bg-white/80 px-3 text-base';
  const [submitting, setSubmitting] = useState(false);
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
    const k = idemStorageKey;
    const existing = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(k) : null;
    const v = existing ?? uid();
    try {
      sessionStorage.setItem(k, v);
    } catch {}
    return v;
  });
  const items = lines.map((l) => ({ productId: l.productId, variantId: l.variantId, modifiers: l.modifiers, quantity: l.quantity, notes: l.notes || undefined }));

  // While the server re-prices a changed cart, the previous totals are dimmed rather than shown as
  // if they were current (e.g. a subtotal for two dishes right after removing one).
  const [quoting, setQuoting] = useState(false);
  useEffect(() => {
    if (lines.length === 0) return setQuote(null);
    const ctrl = new AbortController();
    setQuoting(true);
    fetch('/api/public/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, language: lang, qrToken: scope.qrToken, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, items, couponCode: coupon || undefined }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => q && setQuote({ ...q, forCoupon: coupon }))
      .catch(() => {})
      .finally(() => !ctrl.signal.aborted && setQuoting(false));
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

  const submitRef = useRef<(() => Promise<void>) | null>(null);
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const common = { idempotencyKey: idemKey, language: lang, items, notes: notes.trim() || undefined, couponCode: coupon || undefined };
    const body = pending ?? JSON.stringify(
      channel === 'TABLE'
        ? { ...common, qrToken: scope.qrToken, tableCode: tableCode.trim() || undefined }
        : channel === 'TAKEAWAY'
          ? { ...common, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, pickup, customerName: contact.name, phone: contact.phone }
          : { ...common, orgSlug: scope.orgSlug, locationSlug: scope.locationSlug, customerName: contact.name, phone: contact.phone, address: contact.address, postalCode: contact.postalCode, city: contact.city, deliveryNotes: contact.deliveryNotes || undefined, paymentMethod: payMethod },
    );
    const endpoint = channel === 'TABLE' ? '/api/public/orders/table' : channel === 'TAKEAWAY' ? '/api/public/orders/pickup' : '/api/public/orders/delivery';
    // Retries reuse the same idempotency key, so a flaky connection can never create two orders.
    try {
      sessionStorage.setItem(pendingKey, body);
    } catch {}
    const settle = () => {
      // The server answered definitively (accepted or refused): nothing is pending any more.
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {}
      setPending(null);
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.trackingToken) {
          for (const k of [idemStorageKey, pendingKey, draftKey]) sessionStorage.removeItem(k);
          return onSubmitted(data.trackingToken);
        }
        // Only `items_unavailable` carries price/availability issues. Validation errors (e.g. missing
        // name or phone) also return an `issues` array and must not be shown as "prices changed" (BUG-04).
        if (res.status === 422 && data.error === 'items_unavailable' && data.issues?.length) {
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
        settle();
        setSubmitting(false);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    // Outcome unknown: the order may or may not have reached the restaurant. Say so plainly and
    // offer a safe retry (same body, same key) instead of a misleading "reconnecting…".
    setPending(body);
    setError(c.submitUncertain);
    setSubmitting(false);
  };
  submitRef.current = submit;
  // Back online while an order is unconfirmed: check it once automatically (safe, idempotent).
  useEffect(() => {
    if (!pending) return;
    const onOnline = () => void submitRef.current?.();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pending]);

  return (
    <Sheet onClose={onClose} label={c.cart} closeLabel={m.common.close}>
      <div className="space-y-4 p-5" data-testid="cart-sheet">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-2xl">{c.cart}</h3>
          <button type="button" onClick={onClose} className="h-10 rounded-full bg-white/80 px-4 text-sm font-medium ring-1 ring-black/10" data-testid="cart-close">{m.common.close}</button>
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
                  <button type="button" disabled={!!pending} className="size-10 rounded-xl bg-white text-lg ring-1 ring-black/10 disabled:opacity-40" onClick={() => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} aria-label="−">−</button>
                  <span className="w-8 text-center font-medium tabular-nums" aria-live="polite">{l.quantity}</span>
                  <button type="button" disabled={!!pending} className="size-10 rounded-xl bg-white text-lg ring-1 ring-black/10 disabled:opacity-40" onClick={() => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? { ...x, quantity: Math.min(50, x.quantity + 1) } : x)))} aria-label="+">+</button>
                  <button type="button" disabled={!!pending} className="ms-auto h-10 rounded-xl px-3 text-sm underline underline-offset-2 opacity-75 hover:bg-black/5 disabled:opacity-30" onClick={() => setLines((ls) => ls.filter((x) => x.lineId !== l.lineId))}>{m.common.remove}</button>
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
              <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 300))} className="min-h-[60px] w-full rounded-xl border border-black/10 bg-white/80 p-3 text-base" placeholder={c.notesPlaceholder} />
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
                    <textarea {...field('deliveryNotes')} placeholder={c.deliveryNotes} aria-label={c.deliveryNotes} className="min-h-[50px] w-full rounded-xl border border-black/10 bg-white/80 p-3 text-base" maxLength={300} />
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
                      {checkout?.delivery?.cash && <label className="flex min-h-10 items-center gap-2"><input type="radio" className="size-5 accent-[var(--sf-primary)]" checked={payMethod === 'CASH_ON_DELIVERY'} onChange={() => setPayMethod('CASH_ON_DELIVERY')} />{c.cashOnDelivery}</label>}
                      {checkout?.delivery?.card && <label className="flex min-h-10 items-center gap-2"><input type="radio" className="size-5 accent-[var(--sf-primary)]" checked={payMethod === 'CARD_TERMINAL'} onChange={() => setPayMethod('CARD_TERMINAL')} />{c.cardOnDelivery}</label>}
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
                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase().slice(0, 30))} placeholder={c.promoCode} aria-label={c.promoCode} className="h-11 min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-3 text-base uppercase" data-testid="coupon-input" />
                <button type="button" onClick={() => setCoupon(couponInput.trim())} className="h-11 shrink-0 rounded-xl bg-white/80 px-4 text-sm font-medium ring-1 ring-black/10" data-testid="coupon-apply">{c.apply}</button>
              </div>
            )}
            {coupon && quote?.forCoupon !== coupon && <p className="text-sm opacity-70" role="status" data-testid="coupon-checking">{c.checkingCode}</p>}
            {coupon && quote?.forCoupon === coupon && quote.couponStatus && quote.couponStatus !== 'valid' && (
              <p className="text-sm text-red-700" role="alert" data-testid="coupon-error">{quote.couponStatus === 'not_applicable' ? c.promoNotApplicable : c.promoInvalid}</p>
            )}
            <div className={cn('space-y-1 rounded-2xl bg-white/80 p-4 transition-opacity', quoting && 'opacity-50')} aria-busy={quoting} data-testid="cart-totals">
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
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="submit-error">{error}</p>}
            {pending && !error && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid="submit-pending">{c.submitUncertain}</p>}
            {!checkout?.whatsapp?.only && (
              <button
                type="button"
                disabled={
                  !canOrder ||
                  submitting ||
                  (!pending && (!quote ||
                  quote.issues.length > 0 ||
                  (channel === 'DELIVERY' && (!dq?.covered || !dq.meetsMinimum)) ||
                  (channel === 'TAKEAWAY' && !pickup)))
                }
                onClick={submit}
                className="h-14 w-full rounded-2xl bg-sf-primary text-lg font-medium text-white disabled:opacity-50"
                data-testid="submit-order"
              >
                {submitting ? c.submitting : pending ? c.retrySubmit : c.submitOrder}
              </button>
            )}
            {checkout?.whatsapp && (
              <div className="space-y-1">
                <a
                  // The total quoted must be the one the guest sees above, discounts included —
                  // quoting the pre-discount subtotal here made the message disagree with the cart.
                  href={`https://wa.me/${checkout.whatsapp.number}?text=${encodeURIComponent(
                    buildWhatsAppText(m, checkout.whatsapp.restaurant, lines, money(quote?.totalCents ?? quote?.subtotalCents ?? lines.reduce((n, l) => n + l.unitCents * l.quantity, 0)), {
                      name: contact.name,
                      phone: contact.phone,
                      pickup: channel !== 'DELIVERY',
                      address: contact.address,
                    }),
                  )}`}
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
    // Sized so table, "call waiter" and "bill" share one row on a 375 px phone; smaller phones wrap.
    <div className="ms-auto flex flex-wrap items-center justify-end gap-1">
      <button type="button" disabled={busy} onClick={() => send('CALL_WAITER')} className="h-10 rounded-full bg-white px-2.5 text-[13px] font-medium whitespace-nowrap ring-1 ring-black/10 active:scale-[0.98] disabled:opacity-60" data-testid="call-waiter">{m.customer.callWaiter}</button>
      <button type="button" disabled={busy} onClick={() => send('REQUEST_BILL')} className="h-10 rounded-full bg-white px-2.5 text-[13px] font-medium whitespace-nowrap ring-1 ring-black/10 active:scale-[0.98] disabled:opacity-60" data-testid="request-bill">{m.customer.requestBill}</button>
      {msg && (
        <p role="status" className="fixed inset-x-4 top-16 z-50 mx-auto max-w-md rounded-2xl bg-sf-primary p-3 text-center text-sm text-white shadow-lg">{msg}</p>
      )}
    </div>
  );
}
