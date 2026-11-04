'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
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

/** Channel-specific checkout data computed on the server (slots, payment options, WhatsApp). */
export type CheckoutConfig = {
  country: 'PT' | 'ES';
  pickup?: {
    asapAllowed: boolean;
    asapMinutes: number;
    /** `day` ("Today", "Tomorrow", "Sat 14 Nov") and `time` ("13:30") are display labels in the restaurant's time zone. */
    slots: { value: string; label: string; day?: string; time?: string }[];
    minOrderCents: number;
    pickupPoint?: string | null;
    /** Restaurant address shown where the guest collects the order. */
    address?: string | null;
  };
  delivery?: { cash: boolean; card: boolean; pickupHref?: string };
  whatsapp?: { number: string; restaurant: string; only?: boolean };
  /** Links to the other ordering method; the cart is kept and re-checked there. */
  switchTo?: { pickup?: string; delivery?: string };
};

export type QuoteIssue = { index: number; code: string; name?: string; group?: string };
export type Quote = { subtotalCents: number; discountCents?: number; totalCents?: number; discounts?: { description: string; amountCents: number }[]; couponStatus?: string; forCoupon?: string; issues: QuoteIssue[] };

/**
 * Where the cart lives in this browser. Pickup and delivery share one cart (`REMOTE`), so a guest
 * who switches method keeps their dishes; the new channel's prices are checked by the server.
 */
export function cartKey(locationId: string, channel: OrderChannel, qrToken?: string) {
  return channel === 'TABLE' ? `mn_cart_v1:${locationId}:TABLE:${qrToken ?? ''}` : `mn_cart_v1:${locationId}:REMOTE:`;
}

export function useCart(storageKey: string, legacyKey?: string) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
      if (raw) setLines(JSON.parse(raw));
      if (legacyKey) localStorage.removeItem(legacyKey);
    } catch {}
    setLoaded(true);
  }, [storageKey, legacyKey]);
  useEffect(() => {
    if (loaded) localStorage.setItem(storageKey, JSON.stringify(lines));
  }, [lines, loaded, storageKey]);
  return { lines, setLines, loaded };
}

/** Display price of a cart line from the menu shown now (this channel's prices). Null when the dish is not on this menu. */
export function estimateUnit(byId: Map<string, PublicProduct>, l: CartLine): number | null {
  const p = byId.get(l.productId);
  if (!p) return null;
  const variant = l.variantId ? p.variants.find((v) => v.id === l.variantId) : null;
  if (l.variantId && !variant) return null;
  const options = new Map(p.modifierGroups.flatMap((g) => g.options.map((o) => [o.id, o.priceDeltaCents] as const)));
  let mods = 0;
  for (const x of l.modifiers) {
    const delta = options.get(x.optionId);
    if (delta === undefined) return null;
    mods += delta * x.quantity;
  }
  return p.priceCents + (variant?.priceDeltaCents ?? 0) + mods;
}

/** Cart lines re-estimated with this menu's prices, plus a photo lookup. */
export function usePricedLines(lines: CartLine[], menu: PublicCategory[]) {
  const byId = useMemo(() => new Map(menu.flatMap((cat) => cat.products.map((p) => [p.id, p] as const))), [menu]);
  const priced = useMemo(
    () =>
      lines.map((l) => {
        const u = estimateUnit(byId, l);
        return u === null || u === l.unitCents ? l : { ...l, unitCents: u };
      }),
    [lines, byId],
  );
  const images = useMemo(() => new Map([...byId].map(([id, p]) => [id, p.imageUrl] as const)), [byId]);
  return { lines: priced, byId, images };
}

/** The same dish with the same choices and notes is one line with a higher quantity. */
export function sameLine(a: CartLine, b: CartLine) {
  const key = (l: CartLine) => JSON.stringify([...l.modifiers].sort((x, y) => x.optionId.localeCompare(y.optionId)));
  return a.productId === b.productId && a.variantId === b.variantId && a.notes === b.notes && key(a) === key(b);
}

export const cartItems = (lines: CartLine[]) => lines.map((l) => ({ productId: l.productId, variantId: l.variantId, modifiers: l.modifiers, quantity: l.quantity, notes: l.notes || undefined }));

/**
 * The server's price for the cart on this channel (authoritative). While a changed cart is being
 * re-priced, `quoting` is true and the previous figures should be shown dimmed.
 */
export function useCartQuote(params: { channel: OrderChannel; lang: LanguageCode; scope: { qrToken?: string; orgSlug: string; locationSlug: string }; lines: CartLine[]; coupon?: string }) {
  const { channel, lang, scope, lines, coupon = '' } = params;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const items = cartItems(lines);
  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    if (lines.length === 0) {
      setQuote(null);
      return;
    }
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
  }, [itemsKey, channel, lang, coupon]);
  return { quote, setQuote, quoting };
}

/** Recent orders of this browser (tracking tokens only), newest first. */
export function rememberOrder(token: string) {
  try {
    const list = JSON.parse(localStorage.getItem('mn_orders_v1') ?? '[]') as string[];
    localStorage.setItem('mn_orders_v1', JSON.stringify([token, ...list.filter((t) => t !== token)].slice(0, 10)));
  } catch {}
}
