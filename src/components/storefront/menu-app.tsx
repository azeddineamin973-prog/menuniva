'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { pickSuggestions, type UpsellRuleView } from '@/lib/upsell';
import { buildWhatsAppText } from '@/lib/whatsapp';
import { uuid } from '@/lib/uuid';
import type { PublicCategory, PublicProduct } from '@/server/services/public-menu';
import type { TableAccess } from '@/server/services/table-access';
import { Icon } from '@/components/ui/icons';
import { MediaImage } from '@/components/ui/media-image';
import { cartKey, rememberOrder, sameLine, useCart, useCartQuote, usePricedLines, type CartLine, type CheckoutConfig } from './cart';
import { CartPanel } from './cart-panel';
import { CartSheet, type Msg } from './cart-sheet';
import { DishCard, NoPhoto } from './dish-card';
import { ProductSheet } from './product-sheet';
import { Sheet } from './sheet';

export { buildWhatsAppText };
export type { CartLine, CheckoutConfig };
export { useCart };

/**
 * The guest menu: search, categories and dishes, plus the order.
 *
 * Pickup and delivery (`checkoutHref` given): on desktop the order sits in a column on the right
 * and never covers the food; on phones and tablets a bar at the bottom opens it. Checkout is its
 * own page. Table (QR) orders and WhatsApp messages keep a one-step sheet.
 */
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
  tableAccess,
  checkout,
  orderActions = [],
  checkoutHref,
  header,
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
  /** Table (QR) orders: whether this phone may order now (staff-opened table, PIN entered). */
  tableAccess?: TableAccess;
  checkout?: CheckoutConfig;
  /** Ways to order, offered inside a dish when this page is browse-only. */
  orderActions?: { label: string; href: string; icon?: 'bag' | 'truck' }[];
  /** Pickup / delivery: the checkout page. Enables the order column and the cart bar. */
  checkoutHref?: string;
  /** Shown above the search (e.g. the Pickup / Delivery switch). */
  header?: React.ReactNode;
}) {
  const router = useRouter();
  const c = m.customer;
  // Updated by the cart once this phone has entered the PIN (the server set its cookie).
  const [access, setAccess] = useState(tableAccess);
  const o = m.ordering;
  const money = useCallback((cents: number) => formatCents(cents, tag), [tag]);
  const remote = channel !== 'TABLE';
  const withPanel = !!checkoutHref;
  const { lines: storedLines, setLines, loaded } = useCart(cartKey(scope.locationId, channel, scope.qrToken), remote ? `mn_cart_v1:${scope.locationId}:${channel}:` : undefined);
  // Estimates shown before the server quote: always this menu's (this channel's) prices, so the
  // cart does not show pickup prices on the delivery page after switching.
  const { lines, byId, images } = usePricedLines(storedLines, menu);
  const [open, setOpen] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(menu[0]?.id);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((text: string, ms = 2200) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  const { quote, quoting } = useCartQuote({ channel, lang, scope, lines: withPanel ? lines : [] });
  // The order column exists only on desktop, the cart bar and sheet only below it: never both in
  // the page at once (one set of buttons for screen readers and tests).
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => {
      setDesktop(mq.matches);
      if (mq.matches) setCartOpen(false);
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const asideCart = withPanel && desktop;

  // Arriving from the other ordering method with items in the cart: say they were kept and are
  // checked again here. `?add=<dish>` (from the restaurant's home page) opens that dish.
  useEffect(() => {
    if (!loaded) return;
    const url = new URL(window.location.href);
    const add = url.searchParams.get('add');
    if (add) {
      url.searchParams.delete('add');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      const p = byId.get(add);
      if (p && canOrder) setOpen(p);
    }
    if (!remote) return;
    const modeKey = `mn_cart_mode:${scope.locationId}`;
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(modeKey);
      localStorage.setItem(modeKey, channel);
    } catch {}
    if (storedLines.length > 0 && previous && previous !== channel) showToast(o.cartKept, 4500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // The table banner can wrap to two lines on small phones; the sticky category bar sits right
  // under it (and under the page's sticky top bar).
  const bannerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [bannerHeight, setBannerHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(120);
  const [topBar, setTopBar] = useState(0);
  useEffect(() => {
    const update = () => {
      setBannerHeight(bannerRef.current?.getBoundingClientRect().height ?? 0);
      if (barRef.current) setBarHeight(barRef.current.getBoundingClientRect().height);
      const head = document.querySelector<HTMLElement>('[data-testid=storefront] > header.sticky');
      setTopBar(head?.getBoundingClientRect().height ?? 0);
    };
    update();
    const ro = new ResizeObserver(update);
    for (const el of [bannerRef.current, barRef.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stickyTop = topBar + bannerHeight;
  const stickyOffset = stickyTop + barHeight;
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const estimate = lines.reduce((n, l) => n + l.unitCents * l.quantity, 0);
  const inCart = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) map.set(l.productId, (map.get(l.productId) ?? 0) + l.quantity);
    return map;
  }, [lines]);

  // Searching filters the data the page already has, so it works offline and instantly.
  // Accents are stripped so "cha" finds "Chá".
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const needle = fold(search.trim());
  const shownMenu = useMemo(() => {
    const visible = menu.filter((cat) => cat.products.length > 0);
    if (!needle) return visible;
    return visible.map((cat) => ({ ...cat, products: cat.products.filter((p) => fold(p.name).includes(needle) || fold(p.description ?? '').includes(needle)) })).filter((cat) => cat.products.length > 0);
  }, [menu, needle]);
  const matches = shownMenu.reduce((n, cat) => n + cat.products.length, 0);

  // Scroll-spy: the category being read is highlighted and kept in view.
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
  const chipsRef = useRef<HTMLElement>(null);
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
    setLines((ls) => {
      const hit = ls.find((l) => sameLine(l, line));
      return hit ? ls.map((l) => (l === hit ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l)) : [...ls, line];
    });
    setOpen(null);
    showToast(`${o.added} · ${line.quantity} × ${line.name}`);
  };
  /** Dishes with nothing to choose go straight into the cart; the others open their sheet. */
  const isSimple = (p: PublicProduct) => p.variants.length === 0 && p.modifierGroups.every((g) => g.minSelect === 0);
  const quickAdd = (p: PublicProduct) => {
    if (!isSimple(p)) return setOpen(p);
    addLine({ lineId: uuid(), productId: p.id, variantId: null, modifiers: [], quantity: 1, notes: '', name: p.name, detail: '', unitCents: p.priceCents });
  };
  // Polite cart suggestions: shown only on request (cart open), never added automatically.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const suggestions = useMemo(() => (canOrder ? pickSuggestions(upsellRules ?? [], menu, lines.map((l) => l.productId), dismissed) : []), [canOrder, upsellRules, menu, lines, dismissed]);
  const acceptSuggestion = (ruleId: string, p: PublicProduct) => {
    trackUpsell(ruleId, 'ACCEPTED');
    if (isSimple(p)) {
      setLines((ls) => [...ls, { lineId: uuid(), productId: p.id, variantId: null, modifiers: [], quantity: 1, notes: '', name: p.name, detail: '', unitCents: p.priceCents }]);
    } else {
      setCartOpen(false);
      setOpen(p); // the guest still chooses options and taps "add" themselves
    }
  };
  const upsell = suggestions.length > 0 ? <UpsellBox suggestions={suggestions} m={m} money={money} onAdd={acceptSuggestion} onDismiss={(id) => setDismissed((d) => [...d, id])} /> : null;
  const cardLabels = { from: c.from, soldOut: c.soldOut, unavailable: c.unavailable, popular: c.popular, add: c.addToCart, quickAdd: o.quickAdd, remove1: o.remove1, add1: o.add1 };
  /** Takes one plain portion (no choices, no notes) of a dish back out of the order. */
  const removeOne = (p: PublicProduct) =>
    setLines((ls) => {
      const i = ls.findLastIndex((l) => l.productId === p.id && !l.variantId && l.modifiers.length === 0 && !l.notes);
      if (i < 0) return ls;
      return ls[i].quantity <= 1 ? ls.filter((_, k) => k !== i) : ls.map((l, k) => (k === i ? { ...l, quantity: l.quantity - 1 } : l));
    });
  /** Same as quick add, without the toast (the − n + on the tile already shows the change). */
  const addOne = (p: PublicProduct) =>
    setLines((ls) => {
      const line: CartLine = { lineId: uuid(), productId: p.id, variantId: null, modifiers: [], quantity: 1, notes: '', name: p.name, detail: '', unitCents: p.priceCents };
      const hit = ls.find((l) => sameLine(l, line));
      return hit ? ls.map((l) => (l === hit ? { ...l, quantity: Math.min(50, l.quantity + 1) } : l)) : [...ls, line];
    });
  const plainCount = (p: PublicProduct) => lines.filter((l) => l.productId === p.id && !l.variantId && l.modifiers.length === 0 && !l.notes).reduce((n, l) => n + l.quantity, 0);
  const totalNow = withPanel && quote ? (quote.totalCents ?? quote.subtotalCents) : estimate;

  const panel = (variant: 'aside' | 'sheet') =>
    checkoutHref && (
      <CartPanel
        variant={variant}
        channel={channel}
        lines={lines}
        setLines={setLines}
        images={images}
        money={money}
        m={m}
        quote={quote}
        quoting={quoting}
        canOrder={canOrder}
        checkoutHref={checkoutHref}
        minOrderCents={checkout?.pickup?.minOrderCents}
        upsell={upsell}
        onClose={variant === 'sheet' ? () => setCartOpen(false) : undefined}
      />
    );

  return (
    <div className={cn('mx-auto pb-32', withPanel ? 'max-w-7xl lg:grid lg:grid-cols-[minmax(0,1fr)_23.5rem] lg:gap-8 lg:px-6 lg:pb-12' : 'max-w-5xl')}>
      <div className="min-w-0">
        {tableLabel && (
          <div ref={bannerRef} className="sticky z-20 flex flex-wrap items-center justify-between gap-1.5 border-b border-sf-line bg-sf-bg/95 px-4 py-2 backdrop-blur sm:px-6" style={{ top: topBar }} data-testid="table-banner">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sf-primary px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-sf-on-primary">
              <Icon name="tables" className="size-3.5" />
              {fmt(c.table, { label: tableLabel })}
            </span>
            {scope.qrToken && <TableActions qrToken={scope.qrToken} m={m} />}
          </div>
        )}
        {tableLabel && canOrder && access && !access.authorized && (
          <p className="mx-4 mt-4 flex items-start gap-2.5 rounded-2xl bg-sf-soft px-4 py-3 text-sm sm:mx-6" role="status" data-testid="table-access-banner" data-state={!access.open ? 'closed' : access.locked ? 'locked' : 'pin'}>
            <Icon name={!access.open ? 'info' : 'lock'} className="mt-0.5 size-4 shrink-0 text-sf-primary-ink" />
            <span>{!access.open ? (access.ended ? c.sessionEnded : c.tableClosedBanner) : access.locked ? c.pinLocked : c.pinNeededBanner}</span>
          </p>
        )}
        {header && <div className={cn('px-4 pt-4 sm:px-6', withPanel && 'lg:px-0 lg:pt-6')}>{header}</div>}
        {!canOrder && orderingMessage && (
          <p className={cn('mx-4 mt-4 flex items-start gap-2.5 rounded-2xl bg-sf-soft px-4 py-3 text-sm sm:mx-6', withPanel && 'lg:mx-0')} role="status">
            <Icon name="info" className="mt-0.5 size-4 shrink-0 text-sf-primary-ink" />
            <span>{orderingMessage}</span>
          </p>
        )}

        {/* Search and categories stay at hand while scrolling. */}
        <div ref={barRef} className={cn('sticky z-10 bg-sf-bg/95 pt-3 backdrop-blur supports-[backdrop-filter]:bg-sf-bg/85', withPanel && 'lg:-mx-1 lg:px-1')} style={{ top: stickyTop }}>
          {menu.length > 0 && (
            <div className={cn('px-4 sm:px-6', withPanel && 'lg:px-0')}>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-sf-muted" aria-hidden>
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
                  className="h-12 w-full rounded-full border-0 bg-sf-card ps-11 pe-12 text-base ring-1 ring-sf-line placeholder:text-sf-muted focus:ring-2 focus:ring-sf-primary focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                  data-testid="menu-search"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} aria-label={c.clearSearch} className="absolute inset-y-1 end-1 flex w-10 items-center justify-center rounded-full text-sf-muted hover:bg-sf-sunken" data-testid="menu-search-clear">
                    <Icon name="x" className="size-4" />
                  </button>
                )}
              </div>
            </div>
          )}
          <nav ref={chipsRef} className={cn('sf-scroll-x flex gap-1 overflow-x-auto scroll-smooth px-4 py-3 sm:px-6', withPanel && 'lg:px-0')} aria-label={c.menu}>
            {shownMenu.map((cat) => (
              <a
                key={cat.id}
                href={`#cat-${cat.id}`}
                onClick={() => setActiveCat(cat.id)}
                aria-current={activeCat === cat.id ? 'true' : undefined}
                data-cat={cat.id}
                className={cn(
                  'flex h-10 shrink-0 items-center rounded-full px-4 text-[15px] font-medium whitespace-nowrap transition-colors motion-reduce:transition-none',
                  activeCat === cat.id ? 'bg-sf-text text-sf-bg' : 'text-sf-muted hover:bg-sf-sunken hover:text-sf-text',
                )}
              >
                {cat.name}
              </a>
            ))}
          </nav>
        </div>

        {menu.length === 0 && (
          <div className="mx-4 mt-6 flex flex-col items-center rounded-3xl bg-sf-card px-6 py-12 text-center ring-1 ring-sf-line sm:mx-6">
            <NoPhoto className="size-16 rounded-2xl" />
            <p className="mt-4 font-medium">{c.unavailable}</p>
          </div>
        )}
        {menu.length > 0 && matches === 0 && (
          <div className="mx-4 mt-6 flex flex-col items-center px-6 py-10 text-center sm:mx-6" role="status" data-testid="menu-no-results">
            <span className="flex size-12 items-center justify-center rounded-full bg-sf-sunken text-sf-muted" aria-hidden>
              <Icon name="search" className="size-5" />
            </span>
            <p className="mt-3 font-medium">{c.noDishesFound}</p>
            <button type="button" onClick={() => setSearch('')} className="mt-3 min-h-11 rounded-full px-4 text-sm font-semibold text-sf-primary-ink hover:bg-sf-sunken">
              {c.clearSearch}
            </button>
          </div>
        )}

        {shownMenu.map((cat, ci) => (
          <section key={cat.id} id={`cat-${cat.id}`} className={cn('px-4 pt-5 sm:px-6 sm:pt-8', withPanel && 'lg:px-0')} style={{ scrollMarginTop: stickyOffset + 8 }} aria-labelledby={`cat-title-${cat.id}`}>
            <h2 id={`cat-title-${cat.id}`} className="font-serif text-[1.6rem] leading-tight sm:text-[1.85rem]">
              {cat.name}
            </h2>
            {cat.description && <p className="mt-1 max-w-2xl text-sm text-sf-muted">{cat.description}</p>}
            <ul className={cn('mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3', !withPanel && 'lg:grid-cols-4')}>
              {cat.products.map((p, pi) => {
                const simple = isSimple(p);
                const plain = simple ? plainCount(p) : 0;
                return (
                  <li key={p.id}>
                    <DishCard
                      p={p}
                      money={money}
                      labels={cardLabels}
                      canOrder={canOrder}
                      simple={simple}
                      onOpen={() => setOpen(p)}
                      // First tap adds with a confirmation; then − n + changes the quantity quietly.
                      onQuickAdd={() => (simple && plain > 0 ? addOne(p) : quickAdd(p))}
                      onRemoveOne={simple && plain > 0 ? () => removeOne(p) : undefined}
                      priority={ci === 0 && pi < 4}
                      count={simple && plain > 0 ? plain : (inCart.get(p.id) ?? 0)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* Desktop: the order next to the menu. */}
      {withPanel && (
        <aside className="hidden lg:block" aria-label={c.cart}>
          <div className="sticky pt-6" style={{ top: topBar }}>
            {asideCart && panel('aside')}
          </div>
        </aside>
      )}

      {toast && !cartOpen && !open && (
        <div className={cn('pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4', count > 0 ? 'bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5rem)]' : 'bottom-[max(1rem,env(safe-area-inset-bottom))]', withPanel && 'lg:bottom-6')}>
          <p role="status" className="animate-pop-in flex max-w-md items-center gap-2 rounded-full bg-sf-text px-4 py-2.5 text-sm font-medium text-sf-bg shadow-lg motion-reduce:animate-none" data-testid="cart-toast">
            <Icon name="checkCircle" className="size-4 shrink-0" />
            <span className="line-clamp-2">{toast}</span>
          </p>
        </div>
      )}
      {/* Pickup / delivery on phones and tablets: the order button goes STRAIGHT to checkout;
          the round button beside it opens the order to change it. */}
      {count > 0 && !cartOpen && !asideCart && withPanel && checkoutHref && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-sf-bg via-sf-bg/85 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="animate-slide-up pointer-events-auto mx-auto flex max-w-xl items-center gap-2 motion-reduce:animate-none">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label={`${o.editCart} (${count})`}
              className="relative flex size-16 shrink-0 items-center justify-center rounded-full bg-sf-card text-sf-text shadow-[var(--sf-shadow-float)] ring-1 ring-sf-line active:scale-[0.97]"
              data-testid="view-cart"
            >
              <Icon name="bag" className="size-6" />
              <span className="absolute -end-0.5 -top-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-sf-primary px-1.5 text-xs font-bold text-sf-on-primary tabular-nums ring-2 ring-sf-bg">{count}</span>
            </button>
            {!canOrder || quoting || !quote || quote.issues.length > 0 || (checkout?.pickup?.minOrderCents ?? 0) > quote.subtotalCents ? (
              // Not possible yet (price check running, an item changed, minimum not reached):
              // the order opens so the guest sees why.
              <button type="button" onClick={() => setCartOpen(true)} className="flex h-16 min-w-0 flex-1 items-center justify-between gap-3 rounded-full bg-sf-primary px-6 text-sf-on-primary opacity-90 shadow-[var(--sf-shadow-float)]" data-testid="bar-checkout" aria-disabled>
                <span className="truncate text-[16px] font-semibold">{o.goToCheckout}</span>
                <span className="shrink-0 text-[16px] font-semibold tabular-nums">{money(totalNow)}</span>
              </button>
            ) : (
              <a href={checkoutHref} className="flex h-16 min-w-0 flex-1 items-center justify-between gap-3 rounded-full bg-sf-primary ps-6 pe-5 text-sf-on-primary shadow-[var(--sf-shadow-float)] transition-transform active:scale-[0.99]" data-testid="bar-checkout">
                <span className="min-w-0">
                  <span className="block truncate text-[16px] leading-tight font-semibold">{o.goToCheckout}</span>
                  <span className="block text-xs opacity-80">{count === 1 ? o.oneItem : fmt(o.itemsN, { n: count })}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[16px] font-semibold tabular-nums">
                  {money(totalNow)}
                  <Icon name="arrowRight" className="size-5 rtl:rotate-180" />
                </span>
              </a>
            )}
          </div>
        </div>
      )}
      {count > 0 && !cartOpen && !asideCart && !withPanel && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-sf-bg via-sf-bg/85 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="animate-slide-up pointer-events-auto mx-auto flex h-16 w-full max-w-xl items-center gap-3 rounded-full bg-sf-primary ps-2.5 pe-5 text-sf-on-primary shadow-[var(--sf-shadow-float)] transition-transform active:scale-[0.99] motion-reduce:animate-none motion-reduce:transition-none"
            data-testid="view-cart"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/15 text-[15px] font-bold tabular-nums" aria-hidden>
              {count}
            </span>
            <span className="flex-1 text-start text-[16px] font-semibold">{fmt(c.viewCart, { count })}</span>
            <span className="text-[16px] font-semibold tabular-nums">{money(withPanel && quote ? (quote.totalCents ?? quote.subtotalCents) : estimate)}</span>
          </button>
        </div>
      )}

      {open && <ProductSheet product={open} m={m} money={money} canOrder={canOrder} orderActions={orderActions.map((a) => ({ ...a, href: withAdd(a.href, open.id) }))} onClose={() => setOpen(null)} onAdd={addLine} />}
      {cartOpen &&
        (withPanel ? (
          <Sheet onClose={() => setCartOpen(false)} label={c.cart} closeLabel={m.common.close}>
            {panel('sheet')}
          </Sheet>
        ) : (
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
            tableAccess={access}
            onAccessChange={setAccess}
            checkout={checkout}
            images={images}
            onClose={() => setCartOpen(false)}
            onSubmitted={(token) => {
              setLines(() => []);
              rememberOrder(token);
              router.push(`/o/${token}`);
            }}
          />
        ))}
    </div>
  );
}

/** Link to an ordering page that opens this dish there. */
function withAdd(href: string, productId: string) {
  return `${href}${href.includes('?') ? '&' : '?'}add=${encodeURIComponent(productId)}`;
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
    <section className="rounded-2xl bg-sf-sunken p-3" aria-label={m.customer.youMightAlsoLike} data-testid="upsell">
      <p className="mb-2 text-sm font-semibold">{m.customer.youMightAlsoLike}</p>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.ruleId} className="flex items-center gap-3" data-testid="upsell-item">
            {s.product.imageUrl && <MediaImage src={s.product.imageUrl} sizes="48px" widths={[160]} className="size-12 rounded-xl object-cover" loading="lazy" decoding="async" width={48} height={48} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.product.name}</span>
              <span className="block text-xs text-sf-muted tabular-nums">{money(s.product.priceCents)}</span>
            </span>
            <button type="button" onClick={() => onAdd(s.ruleId, s.product)} className="h-10 rounded-full bg-sf-primary px-4 text-sm font-semibold text-sf-on-primary" data-testid="upsell-add">
              {m.customer.addSuggestion}
            </button>
            <button type="button" onClick={() => onDismiss(s.ruleId)} className="h-10 rounded-full px-2 text-xs text-sf-muted underline" data-testid="upsell-dismiss">
              {m.customer.noThanks}
            </button>
          </li>
        ))}
      </ul>
    </section>
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
      <button type="button" disabled={busy} onClick={() => send('CALL_WAITER')} className="h-10 rounded-full bg-sf-card px-2.5 text-[13px] font-medium whitespace-nowrap ring-1 ring-sf-line active:scale-[0.98] disabled:opacity-60" data-testid="call-waiter">
        {m.customer.callWaiter}
      </button>
      <button type="button" disabled={busy} onClick={() => send('REQUEST_BILL')} className="h-10 rounded-full bg-sf-card px-2.5 text-[13px] font-medium whitespace-nowrap ring-1 ring-sf-line active:scale-[0.98] disabled:opacity-60" data-testid="request-bill">
        {m.customer.requestBill}
      </button>
      {msg && <p role="status" className="fixed inset-x-4 top-20 z-50 mx-auto max-w-md rounded-2xl bg-sf-primary p-3 text-center text-sm text-sf-on-primary shadow-lg">{msg}</p>}
    </div>
  );
}
