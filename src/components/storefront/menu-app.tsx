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
import { Icon } from '@/components/ui/icons';
import { DishCard, lowestPrice, NoPhoto } from './dish-card';
import { MediaImage } from '@/components/ui/media-image';

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
  // Photos for the cart lines (the cart only stores ids and names).
  const images = useMemo(() => new Map(menu.flatMap((cat) => cat.products.map((p) => [p.id, p.imageUrl] as const))), [menu]);

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

  const cardLabels = { from: c.from, soldOut: c.soldOut, unavailable: c.unavailable, popular: c.popular, add: c.addToCart ?? '+' };
  return (
    <div className="mx-auto max-w-5xl pb-36">
      {tableLabel && (
        <div ref={bannerRef} className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-1.5 border-b border-sf-text/5 bg-sf-bg/95 px-4 py-2 backdrop-blur sm:px-6" data-testid="table-banner">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sf-primary px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-sf-on-primary">
            <Icon name="tables" className="size-3.5" />
            {fmt(c.table, { label: tableLabel })}
          </span>
          {scope.qrToken && <TableActions qrToken={scope.qrToken} m={m} />}
        </div>
      )}
      {!canOrder && orderingMessage && (
        <div className="mx-4 mt-4 flex items-start gap-2.5 rounded-2xl bg-sf-card p-3.5 text-sm shadow-sm ring-1 ring-sf-accent/30 sm:mx-6" role="status">
          <Icon name="info" className="mt-0.5 size-4 shrink-0 text-sf-accent" />
          <span>{orderingMessage}</span>
        </div>
      )}

      {/* Search and categories stay at hand while scrolling (under the table banner, if any). */}
      <div className="sticky z-10 bg-sf-bg/95 pt-3 backdrop-blur supports-[backdrop-filter]:bg-sf-bg/80" style={{ top: bannerHeight }}>
        {menu.length > 0 && (
          <div className="px-4 sm:px-6">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center opacity-50" aria-hidden>
                <Icon name="search" className="size-[18px]" />
              </span>
              {/* 16 px text: iOS Safari zooms the page into smaller fields. */}
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={c.searchMenu}
                aria-label={c.searchMenu}
                enterKeyHint="search"
                className="h-12 w-full rounded-2xl border-0 bg-sf-card ps-11 pe-12 text-base shadow-sm ring-1 ring-sf-text/[0.08] placeholder:opacity-60 focus:ring-2 focus:ring-sf-primary focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                data-testid="menu-search"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label={c.clearSearch} className="absolute inset-y-1 end-1 flex w-10 items-center justify-center rounded-xl opacity-60 hover:bg-sf-text/5 hover:opacity-100" data-testid="menu-search-clear">
                  <Icon name="x" className="size-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <nav ref={chipsRef} className="flex gap-2 overflow-x-auto scroll-smooth px-4 py-3 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden" aria-label={c.menu}>
          {shownMenu.map((cat) => (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              onClick={() => setActiveCat(cat.id)}
              aria-current={activeCat === cat.id ? 'true' : undefined}
              data-cat={cat.id}
              className={cn(
                'flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none',
                activeCat === cat.id ? 'bg-sf-primary text-sf-on-primary shadow-sm' : 'bg-sf-card ring-1 ring-sf-text/[0.08] hover:ring-sf-text/20',
              )}
            >
              {cat.name}
              <span className={cn('text-xs tabular-nums', activeCat === cat.id ? 'opacity-80' : 'opacity-50')}>{cat.products.length}</span>
            </a>
          ))}
        </nav>
      </div>

      {menu.length === 0 && (
        <div className="mx-4 mt-6 flex flex-col items-center rounded-3xl bg-sf-card px-6 py-12 text-center shadow-sm ring-1 ring-sf-text/5 sm:mx-6">
          <NoPhoto className="size-16 rounded-2xl" />
          <p className="mt-4 font-medium">{c.unavailable}</p>
        </div>
      )}
      {menu.length > 0 && matches === 0 && (
        <div className="mx-4 mt-6 flex flex-col items-center rounded-3xl bg-sf-card px-6 py-10 text-center shadow-sm ring-1 ring-sf-text/5 sm:mx-6" role="status" data-testid="menu-no-results">
          <span className="flex size-12 items-center justify-center rounded-full bg-sf-text/5" aria-hidden>
            <Icon name="search" className="size-5 opacity-60" />
          </span>
          <p className="mt-3 font-medium">{c.noDishesFound}</p>
          <button type="button" onClick={() => setSearch('')} className="mt-3 rounded-full px-4 py-2 text-sm font-medium text-sf-primary-ink ring-1 ring-sf-text/10 hover:bg-sf-text/5">
            {c.clearSearch}
          </button>
        </div>
      )}

      {featured.length > 0 && !needle && (
        <section className="pt-3" aria-labelledby="featured-title">
          <h2 id="featured-title" className="px-4 font-serif text-2xl sm:px-6">{c.featured}</h2>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pt-3 pb-3 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
            {featured.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpen(p)}
                className="group w-64 shrink-0 snap-start overflow-hidden rounded-3xl bg-sf-card text-start shadow-[0_1px_2px_rgb(0_0_0/0.04),0_10px_24px_-14px_rgb(0_0_0/0.3)] ring-1 ring-sf-text/5 transition-shadow hover:shadow-[0_2px_4px_rgb(0_0_0/0.05),0_18px_32px_-16px_rgb(0_0_0/0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-primary sm:w-72"
              >
                <span className="relative block">
                  {p.imageUrl ? (
                    // The 640 px copy is at least 2.2× the card on every screen; larger ones would only cost bandwidth.
                    <MediaImage src={p.imageUrl} sizes="(min-width: 640px) 288px, 256px" widths={[320, 480, 640]} className="aspect-[4/3] w-full bg-sf-accent/10 object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" loading={i < 2 ? 'eager' : 'lazy'} decoding="async" width={288} height={216} />
                  ) : (
                    <NoPhoto className="aspect-[4/3] w-full" />
                  )}
                  {p.isPopular && <span className="absolute start-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">{c.popular}</span>}
                </span>
                <span className="flex items-end justify-between gap-2 p-3.5">
                  <span className="line-clamp-2 leading-snug font-semibold">{p.name}</span>
                  <span className="shrink-0 font-bold text-sf-primary-ink tabular-nums">{money(lowestPrice(p))}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {shownMenu.map((cat, ci) => (
        <section key={cat.id} id={`cat-${cat.id}`} className="px-4 pt-6 sm:px-6 sm:pt-8" style={{ scrollMarginTop: stickyOffset + 8 }} aria-labelledby={`cat-title-${cat.id}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={`cat-title-${cat.id}`} className="font-serif text-2xl sm:text-[1.7rem]">{cat.name}</h2>
            <span className="text-xs tabular-nums opacity-55">{cat.products.length}</span>
          </div>
          {cat.description && <p className="mt-1 max-w-2xl text-sm opacity-70">{cat.description}</p>}
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {cat.products.map((p, pi) => (
              <li key={p.id}>
                <DishCard p={p} money={money} labels={cardLabels} canOrder={canOrder} onOpen={() => setOpen(p)} priority={ci === 0 && pi < 2} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {count > 0 && !cartOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-sf-bg via-sf-bg/80 to-transparent p-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="animate-slide-up pointer-events-auto mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl bg-sf-primary px-4 py-3.5 text-sf-on-primary shadow-[0_12px_30px_-10px_rgb(0_0_0/0.5)] transition-transform active:scale-[0.99] motion-reduce:animate-none motion-reduce:transition-none"
            data-testid="view-cart"
          >
            <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-current/15" aria-hidden>
              <Icon name="bag" className="size-[18px]" />
              <span className="absolute -end-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-sf-accent px-1 text-[11px] leading-5 font-bold text-white tabular-nums">{count}</span>
            </span>
            <span className="flex-1 text-start font-semibold">{fmt(c.viewCart, { count })}</span>
            <span className="font-bold tabular-nums">{money(estimate)}</span>
            <Icon name="chevronRight" className="size-4 opacity-70 rtl:rotate-180" />
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
          images={images}
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
    <section className="rounded-2xl bg-sf-card/70 p-3 ring-1 ring-sf-text/5" aria-label={m.customer.youMightAlsoLike} data-testid="upsell">
      <p className="mb-2 text-sm font-medium">{m.customer.youMightAlsoLike}</p>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.ruleId} className="flex items-center gap-3" data-testid="upsell-item">
            {s.product.imageUrl && <MediaImage src={s.product.imageUrl} sizes="48px" widths={[160]} className="h-12 w-12 rounded-lg object-cover" loading="lazy" decoding="async" width={48} height={48} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.product.name}</span>
              <span className="block text-xs tabular-nums opacity-70">{money(s.product.priceCents)}</span>
            </span>
            <button type="button" onClick={() => onAdd(s.ruleId, s.product)} className="h-9 rounded-xl bg-sf-primary px-3 text-sm font-medium text-sf-on-primary" data-testid="upsell-add">{m.customer.addSuggestion}</button>
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
      <button type="button" aria-hidden tabIndex={-1} title={closeLabel} className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px] motion-reduce:animate-none" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="animate-slide-up relative max-h-[94dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[1.75rem] bg-sf-bg shadow-2xl outline-none motion-reduce:animate-none sm:max-w-xl sm:rounded-[1.75rem]">
        {/* Grab handle: shows on phones that this is a sheet over the menu. */}
        <span aria-hidden className="pointer-events-none absolute start-1/2 top-2 z-20 h-1 w-10 -translate-x-1/2 rounded-full bg-white/70 shadow-sm sm:hidden rtl:translate-x-1/2" />
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn('flex size-10 items-center justify-center rounded-full bg-sf-card/95 text-xl leading-none shadow-md ring-1 ring-sf-text/10 backdrop-blur transition-transform hover:scale-105 motion-reduce:transition-none', className)} data-testid="sheet-close">
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
      {p.imageUrl ? (
        <MediaImage src={p.imageUrl} sizes="(min-width: 640px) 576px, min(100vw, 512px)" widths={[480, 640, 960, 1280, 1920]} phoneWidths={[480, 640, 960]} className="aspect-[4/3] max-h-[22rem] w-full bg-sf-accent/10 object-cover sm:aspect-[16/10]" decoding="async" />
      ) : (
        <div className="h-6" aria-hidden />
      )}
      <div className="space-y-5 p-5 sm:p-6">
        <div className={cn(!p.imageUrl && 'pe-12')}>
          {(p.isPopular || p.tags.length > 0) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {p.isPopular && <span className="inline-flex items-center gap-1 rounded-full bg-sf-accent/15 px-2.5 py-0.5 text-xs font-semibold"><Icon name="star" className="size-3" />{c.popular}</span>}
              {p.tags.map((t) => <span key={t} className="rounded-full bg-sf-text/[0.06] px-2.5 py-0.5 text-xs font-medium capitalize">{t}</span>)}
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-serif text-[1.65rem] leading-tight">{p.name}</h3>
            <p className="shrink-0 pt-1 text-lg font-bold text-sf-primary-ink tabular-nums">{money(p.priceCents + (variant?.priceDeltaCents ?? 0))}</p>
          </div>
          {p.description && <p className="mt-2 leading-relaxed opacity-80">{p.description}</p>}
          {p.ingredients && <p className="mt-2 text-sm opacity-70">{p.ingredients}</p>}
        </div>
        <div className="flex gap-3 rounded-2xl bg-sf-card p-3.5 text-sm shadow-sm ring-1 ring-sf-text/5">
          <Icon name="info" className="mt-0.5 size-4 shrink-0 text-sf-accent" />
          <div className="min-w-0">
          <p className="font-semibold">{c.allergens}</p>
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
        </div>
        {p.variants.length > 0 && (
          <fieldset>
            <legend className="mb-2.5 text-[15px] font-semibold">{c.chooseOne} <span className="text-xs opacity-60">· {c.requiredChoice}</span></legend>
            <div className="space-y-2">
              {p.variants.map((v) => (
                <label key={v.id} className={cn('flex min-h-13 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-sf-card px-4 py-3 ring-1 transition-shadow motion-reduce:transition-none', variantId === v.id ? 'shadow-sm ring-2 ring-sf-primary' : 'ring-sf-text/10 hover:ring-sf-text/20')}>
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
            <legend className="mb-2.5 text-[15px] font-semibold">
              {g.name}{' '}
              <span className="text-xs opacity-60">
                · {g.maxSelect === 1 ? c.chooseOne : g.minSelect > 0 ? fmt(c.chooseBetween, { min: g.minSelect, max: g.maxSelect }) : fmt(c.chooseUpTo, { n: g.maxSelect })}
                {g.minSelect > 0 && ` · ${c.requiredChoice}`}
              </span>
            </legend>
            <div className="space-y-2">
              {g.options.map((o) => (
                <label key={o.id} className={cn('flex min-h-13 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-sf-card px-4 py-3 ring-1 transition-shadow motion-reduce:transition-none', sel[o.id] ? 'shadow-sm ring-2 ring-sf-primary' : 'ring-sf-text/10 hover:ring-sf-text/20')}>
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
          <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 200))} placeholder={c.notesPlaceholder} className="min-h-[76px] w-full rounded-2xl border-0 bg-sf-card p-3.5 text-base ring-1 ring-sf-text/10 focus:ring-2 focus:ring-sf-primary focus:outline-none" />
        </label>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {/* On a browse-only page (the public storefront) there is nothing to add to, so the
            quantity stepper and a permanently greyed-out "Add" button are replaced by the ways
            the guest can actually order. */}
        {canOrder ? (
          <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 border-t border-sf-text/[0.06] bg-sf-bg/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6">
            <div className="flex items-center gap-1 rounded-2xl bg-sf-card p-1 ring-1 ring-sf-text/10">
              <button type="button" className="flex size-10 items-center justify-center rounded-xl hover:bg-sf-text/5 disabled:opacity-35" disabled={qty <= 1} onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">
                <Icon name="minus" className="size-4" />
              </button>
              <span className="w-7 text-center font-semibold tabular-nums" aria-label={c.quantity} aria-live="polite">{qty}</span>
              <button type="button" className="flex size-10 items-center justify-center rounded-xl bg-sf-primary text-sf-on-primary disabled:opacity-35" disabled={qty >= 50} onClick={() => setQty(Math.min(50, qty + 1))} aria-label="+">
                <Icon name="plus" className="size-4" />
              </button>
            </div>
            <button type="button" disabled={p.soldOut} onClick={add} className="h-12 flex-1 rounded-2xl bg-sf-primary px-4 font-semibold text-sf-on-primary shadow-[0_8px_20px_-10px_rgb(0_0_0/0.5)] transition-transform active:scale-[0.99] disabled:opacity-50 motion-reduce:transition-none" data-testid="add-to-cart">
              {fmt(c.addToCartPrice, { price: money(unit * qty) })}
            </button>
          </div>
        ) : (
          orderActions.length > 0 && (
            <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2 border-t border-sf-text/[0.06] bg-sf-bg/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6" data-testid="sheet-order-actions">
              <p className="text-sm font-semibold">{c.howToOrder}</p>
              <div className={cn('grid gap-2', orderActions.length > 1 && 'sm:grid-cols-2')}>
                {orderActions.map((a) => (
                  <a key={a.href} href={a.href} className="flex h-12 items-center justify-center rounded-2xl bg-sf-primary px-3 text-center font-semibold text-sf-on-primary">
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
  images,
  onClose,
  onSubmitted,
}: {
  /** Dish photos by product id, for the cart lines. */
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
  const inputCls = 'h-11 w-full rounded-xl border border-sf-text/10 bg-sf-card/80 px-3 text-base';
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
      <div className="space-y-4 p-5 pt-6 sm:p-6" data-testid="cart-sheet">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2.5 font-serif text-2xl">
            {c.cart}
            {lines.length > 0 && <span className="rounded-full bg-sf-text/[0.07] px-2 py-0.5 font-sans text-xs font-semibold tabular-nums">{lines.reduce((n, l) => n + l.quantity, 0)}</span>}
          </h3>
          <button type="button" onClick={onClose} className="h-10 rounded-full bg-sf-card px-4 text-sm font-medium shadow-sm ring-1 ring-sf-text/10 hover:bg-sf-text/5" data-testid="cart-close">{m.common.close}</button>
        </div>
        {lines.length === 0 && (
          <div className="flex flex-col items-center rounded-2xl bg-sf-card px-6 py-10 text-center ring-1 ring-sf-text/5">
            <span className="flex size-12 items-center justify-center rounded-full bg-sf-text/5" aria-hidden><Icon name="bag" className="size-5 opacity-60" /></span>
            <p className="mt-3 opacity-75">{c.cartEmpty}</p>
          </div>
        )}
        <ul className="space-y-2">
          {lines.map((l, i) => {
            const issue = quote?.issues.find((x) => x.index === i);
            return (
              <li key={l.lineId} className={cn('rounded-2xl bg-sf-card p-3 shadow-sm ring-1', issue ? 'ring-red-300' : 'ring-sf-text/5')} data-testid="cart-line">
                <div className="flex items-start gap-3">
                  {images?.get(l.productId) ? (
                    <MediaImage src={images.get(l.productId)!} sizes="56px" widths={[160]} className="size-14 shrink-0 rounded-xl bg-sf-accent/10 object-cover" loading="lazy" decoding="async" width={56} height={56} />
                  ) : (
                    <NoPhoto className="size-14 rounded-xl [&_svg]:size-6" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="leading-snug font-semibold break-words">{l.name}</p>
                    {l.detail && <p className="text-xs opacity-70">{l.detail}</p>}
                    {l.notes && <p className="text-xs italic opacity-70">“{l.notes}”</p>}
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums">{money(l.unitCents * l.quantity)}</p>
                </div>
                <div className="mt-2.5 flex items-center gap-2 ps-[4.25rem]">
                  <div className="flex items-center gap-1 rounded-xl bg-sf-bg p-0.5 ring-1 ring-sf-text/10">
                    <button type="button" disabled={!!pending || l.quantity <= 1} className="flex size-9 items-center justify-center rounded-lg hover:bg-sf-text/5 disabled:opacity-35" onClick={() => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} aria-label="−">
                      <Icon name="minus" className="size-4" />
                    </button>
                    <span className="w-7 text-center font-semibold tabular-nums" aria-live="polite">{l.quantity}</span>
                    <button type="button" disabled={!!pending || l.quantity >= 50} className="flex size-9 items-center justify-center rounded-lg hover:bg-sf-text/5 disabled:opacity-35" onClick={() => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? { ...x, quantity: Math.min(50, x.quantity + 1) } : x)))} aria-label="+">
                      <Icon name="plus" className="size-4" />
                    </button>
                  </div>
                  <button type="button" disabled={!!pending} className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm opacity-75 hover:bg-sf-text/5 hover:opacity-100 disabled:opacity-30" onClick={() => setLines((ls) => ls.filter((x) => x.lineId !== l.lineId))}>
                    <Icon name="trash" className="size-4" />
                    {m.common.remove}
                  </button>
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
              <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 300))} className="min-h-[64px] w-full rounded-2xl border-0 bg-sf-card p-3.5 text-base ring-1 ring-sf-text/10 focus:ring-2 focus:ring-sf-primary focus:outline-none" placeholder={c.notesPlaceholder} />
            </label>
            {tableCodeRequired && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium">{c.tableCode}</span>
                <input value={tableCode} onChange={(e) => setTableCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" className="h-12 w-full rounded-xl border border-sf-text/10 bg-sf-card/80 px-3 text-center text-xl tracking-[0.5em]" data-testid="table-code-input" />
                <span className="mt-1 block text-xs opacity-70">{c.tableCodeHint}</span>
              </label>
            )}
            {channel !== 'TABLE' && (
              <fieldset className="space-y-2 rounded-2xl bg-sf-card/60 p-3" data-testid="checkout-fields">
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
                    <textarea {...field('deliveryNotes')} placeholder={c.deliveryNotes} aria-label={c.deliveryNotes} className="min-h-[50px] w-full rounded-xl border border-sf-text/10 bg-sf-card/80 p-3 text-base" maxLength={300} />
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
            <div className="rounded-2xl border border-sf-accent/40 bg-sf-card/60 p-3 text-sm">
              <p className="font-medium">{c.allergyNoticeTitle}</p>
              <p className="opacity-80">{allergyNotice}</p>
            </div>
            {!checkout?.whatsapp?.only && (
              <div className="flex gap-2">
                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase().slice(0, 30))} placeholder={c.promoCode} aria-label={c.promoCode} className="h-11 min-w-0 flex-1 rounded-xl border border-sf-text/10 bg-sf-card/80 px-3 text-base uppercase" data-testid="coupon-input" />
                <button type="button" onClick={() => setCoupon(couponInput.trim())} className="h-11 shrink-0 rounded-xl bg-sf-card/80 px-4 text-sm font-medium ring-1 ring-sf-text/10" data-testid="coupon-apply">{c.apply}</button>
              </div>
            )}
            {coupon && quote?.forCoupon !== coupon && <p className="text-sm opacity-70" role="status" data-testid="coupon-checking">{c.checkingCode}</p>}
            {coupon && quote?.forCoupon === coupon && quote.couponStatus && quote.couponStatus !== 'valid' && (
              <p className="text-sm text-red-700" role="alert" data-testid="coupon-error">{quote.couponStatus === 'not_applicable' ? c.promoNotApplicable : c.promoInvalid}</p>
            )}
            <div className={cn('space-y-1 rounded-2xl bg-sf-card/80 p-4 transition-opacity', quoting && 'opacity-50')} aria-busy={quoting} data-testid="cart-totals">
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
                className="h-14 w-full rounded-2xl bg-sf-primary text-lg font-semibold text-sf-on-primary shadow-[0_10px_24px_-12px_rgb(0_0_0/0.55)] transition-transform active:scale-[0.99] disabled:opacity-50 disabled:shadow-none motion-reduce:transition-none"
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
                  className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#1a7f4b] font-semibold text-white shadow-[0_10px_24px_-12px_rgb(0_0_0/0.5)] transition-transform active:scale-[0.99] motion-reduce:transition-none"
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
      <button type="button" disabled={busy} onClick={() => send('CALL_WAITER')} className="h-10 rounded-full bg-sf-card px-2.5 text-[13px] font-medium whitespace-nowrap ring-1 ring-sf-text/10 active:scale-[0.98] disabled:opacity-60" data-testid="call-waiter">{m.customer.callWaiter}</button>
      <button type="button" disabled={busy} onClick={() => send('REQUEST_BILL')} className="h-10 rounded-full bg-sf-card px-2.5 text-[13px] font-medium whitespace-nowrap ring-1 ring-sf-text/10 active:scale-[0.98] disabled:opacity-60" data-testid="request-bill">{m.customer.requestBill}</button>
      {msg && (
        <p role="status" className="fixed inset-x-4 top-16 z-50 mx-auto max-w-md rounded-2xl bg-sf-primary p-3 text-center text-sm text-sf-on-primary shadow-lg">{msg}</p>
      )}
    </div>
  );
}
