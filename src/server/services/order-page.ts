import 'server-only';
import type { CheckoutConfig } from '@/components/storefront/cart';
import { getMessages } from '@/i18n';
import { fmt, LANGUAGE_TAG } from '@/i18n/config';
import type { OpeningHours } from '@/lib/opening-hours';
import { isOpenAt } from '@/lib/opening-hours';
import { formatCents } from '@/lib/money';
import { zonedParts } from '@/lib/time';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { previewOrPublicLocation } from './fulfilment';
import { deliveryAvailability, labelPickupSlots, pickupAvailability } from './order-modes';
import { allergyNoticeFor, guestQuery, resolveGuestLanguage } from './storefront';

export const ORDER_MODES = { pickup: 'TAKEAWAY', delivery: 'DELIVERY', whatsapp: 'TAKEAWAY' } as const;
export type OrderMode = keyof typeof ORDER_MODES;

/**
 * Everything the ordering page and its checkout page need, computed once on the server from the
 * restaurant's own settings (never guessed): channel, availability, pickup slots, delivery
 * payment methods, the one-line summary of the method and the links between the steps.
 * Returns null when the page must not exist (unknown mode, method switched off, no module).
 */
export async function loadOrderPage(orgSlug: string, mode: string, sp: { l?: string; lang?: string; preview?: string }) {
  if (!(mode in ORDER_MODES)) return null;
  const m0 = mode as OrderMode;
  const channel = ORDER_MODES[m0];
  const pl = await previewOrPublicLocation(orgSlug, sp.l, sp.preview === '1');
  if (!pl) return null;
  const { org, location, isPreview } = pl;
  const modules = await orgModules(org.id);
  if ((m0 === 'pickup' && (!modules.has('takeaway') || !location.takeawayEnabled)) || (m0 === 'delivery' && (!modules.has('delivery') || !location.deliveryEnabled))) return null;
  const wa = location.whatsappOrderingEnabled && location.whatsappNumber ? location.whatsappNumber.replace(/\D/g, '') : null;
  if (m0 === 'whatsapp' && !wa) return null;
  const [branding, settings] = await Promise.all([db.restaurantBranding.findUnique({ where: { organizationId: org.id } }), db.restaurantSettings.findUnique({ where: { organizationId: org.id } })]);
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  const o = m.ordering;
  const tag = LANGUAGE_TAG[lang];
  const money = (c: number) => formatCents(c, tag);
  const base = `/r/${org.slug}`;
  const keep = { preview: isPreview, lang: sp.lang === lang ? lang : null };
  const q = guestQuery({ l: sp.l }, keep);
  const pickupOn = location.takeawayEnabled && modules.has('takeaway');
  const deliveryOn = location.deliveryEnabled && modules.has('delivery');
  const hrefs = { pickup: pickupOn ? `${base}/order/pickup${q}` : undefined, delivery: deliveryOn ? `${base}/order/delivery${q}` : undefined };
  const checkoutHrefs = { pickup: pickupOn ? `${base}/order/pickup/checkout${q}` : undefined, delivery: deliveryOn ? `${base}/order/delivery/checkout${q}` : undefined };
  const address = [location.addressLine1, [location.postalCode, location.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

  let canOrder = !location.orderingPaused;
  let message: string | undefined;
  const checkout: CheckoutConfig = { country: location.country, switchTo: hrefs };
  /** One line under the Pickup / Delivery switch: what to expect, from the restaurant's settings. */
  let summary: string[] = [];
  if (m0 === 'pickup') {
    const pa = pickupAvailability(location);
    const slots = labelPickupSlots(pa.opts, tag, location.timeZone, o);
    checkout.pickup = { asapAllowed: pa.opts.asap.allowed, asapMinutes: pa.opts.asap.minutes, slots, minOrderCents: pa.minOrderCents, pickupPoint: location.takeawaySettings?.pickupPoint ?? null, address };
    if (pa.paused) canOrder = false;
    if (pa.noSlots) {
      canOrder = false;
      message = m.customer.noPickupSlots;
    }
    if (wa) checkout.whatsapp = { number: wa, restaurant: org.name };
    summary = [
      pa.opts.asap.allowed ? fmt(o.pickupReady, { minutes: pa.opts.asap.minutes }) : slots[0] ? fmt(o.pickupNext, { time: `${slots[0].day} ${slots[0].time}` }) : m.customer.noPickupSlots,
      location.takeawaySettings?.pickupPoint ?? address ?? '',
      pa.minOrderCents > 0 ? fmt(m.customer.minimumOrder, { amount: money(pa.minOrderCents) }) : '',
    ].filter(Boolean);
  } else if (m0 === 'delivery') {
    const da = deliveryAvailability(location);
    checkout.delivery = { cash: da.cash, card: da.card, pickupHref: hrefs.pickup };
    if (!da.open) canOrder = false;
    summary = [
      da.minFeeCents !== null ? fmt(o.deliveryFrom, { amount: da.minFeeCents === 0 ? m.customer.deliveryFee0 : money(da.minFeeCents) }) : '',
      fmt(m.customer.estimatedTime, { minutes: da.estimateMinutes }),
      da.minOrderCents > 0 ? fmt(m.customer.minimumOrder, { amount: money(da.minOrderCents) }) : '',
    ].filter(Boolean);
  } else {
    checkout.whatsapp = { number: wa!, restaurant: org.name, only: true };
    delete checkout.switchTo;
    // WhatsApp is not a MenuNiva order, so it is not gated by the takeaway module or the
    // takeaway switch. It does respect opening hours: a prepared message is still useful when
    // the kitchen is closed, but the guest must be told nobody is reading it right now.
    const hours = (location.openingHours ?? null) as OpeningHours | null;
    if (hours) {
      const p = zonedParts(new Date(), location.timeZone);
      if (!isOpenAt(hours, p.weekday, p.hour * 60 + p.minute)) message = m.customer.closedNow;
    }
    summary = [m.customer.whatsappOpenNote];
  }
  // A draft preview shows the real menu, prices and checkout options, but never takes orders.
  if (isPreview) {
    canOrder = false;
    message = m.customer.previewOrdering;
  }
  if (!canOrder && !message) message = m.customer.orderingPaused;
  const menuHref = `${base}${sp.l ? `/${encodeURIComponent(sp.l)}` : ''}${guestQuery({}, keep)}`;
  const title = m0 === 'pickup' ? o.pickupTitle : m0 === 'delivery' ? o.deliveryTitle : m.customer.orderViaWhatsApp;
  return {
    org,
    location,
    branding,
    isPreview,
    lang,
    m,
    tag,
    mode: m0,
    channel,
    canOrder,
    message,
    checkout,
    summary,
    title,
    hrefs,
    checkoutHrefs,
    homeHref: menuHref,
    /** Query string kept on guest links (location, preview, language). */
    query: q,
    allergyNotice: allergyNoticeFor(settings, lang, m.customer.allergyNoticeDefault),
    pricesIncludeVat: settings?.pricesIncludeTax ?? true,
  };
}
