import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MenuApp, type CheckoutConfig } from '@/components/storefront/menu-app';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import type { OpeningHours } from '@/lib/opening-hours';
import { isOpenAt } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { pickupOptions, previewOrPublicLocation } from '@/server/services/fulfilment';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { OrderModeBar, type OrderMode } from '@/components/storefront/order-modes';
import { getPublicMenu } from '@/server/services/public-menu';
import { upsellRulesFor } from '@/server/services/upsell';
import { allergyNoticeFor, guestQuery, resolveGuestLanguage } from '@/server/services/storefront';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

const MODES = { pickup: 'TAKEAWAY', delivery: 'DELIVERY', whatsapp: 'TAKEAWAY' } as const;

/** Guest ordering for pickup, restaurant delivery, or a prepared WhatsApp message. */
export default async function OrderModePage({ params, searchParams }: { params: Promise<{ org: string; mode: string }>; searchParams: Promise<{ l?: string; lang?: string; preview?: string }> }) {
  const { org: orgSlug, mode } = await params;
  const sp = await searchParams;
  if (!(mode in MODES)) notFound();
  const channel = MODES[mode as keyof typeof MODES];
  const pl = await previewOrPublicLocation(orgSlug, sp.l, sp.preview === '1');
  if (!pl) notFound();
  const { org, location, isPreview } = pl;
  const modules = await orgModules(org.id);
  if ((mode === 'pickup' && !modules.has('takeaway')) || (mode === 'delivery' && !modules.has('delivery'))) notFound();
  const [branding, settings] = await Promise.all([db.restaurantBranding.findUnique({ where: { organizationId: org.id } }), db.restaurantSettings.findUnique({ where: { organizationId: org.id } })]);
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  const tag = LANGUAGE_TAG[lang];
  const base = `/r/${org.slug}`;
  const keep = { preview: isPreview, lang: sp.lang === lang ? lang : null };
  const q = guestQuery({ l: sp.l }, keep);
  const wa = location.whatsappOrderingEnabled && location.whatsappNumber ? location.whatsappNumber.replace(/\D/g, '') : null;

  let canOrder = !location.orderingPaused;
  let message: string | undefined;
  const checkout: CheckoutConfig = { country: location.country };
  if (mode === 'pickup') {
    const opts = pickupOptions(location, location.takeawaySettings);
    const fmtTime = new Intl.DateTimeFormat(tag, { timeZone: location.timeZone, hour: '2-digit', minute: '2-digit' });
    // A slot for another day must say which day, or 11:00 tomorrow looks like 11:00 today.
    const fmtDayTime = new Intl.DateTimeFormat(tag, { timeZone: location.timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    checkout.pickup = {
      asapAllowed: opts.asap.allowed,
      asapMinutes: opts.asap.minutes,
      slots: opts.slots.map((s) => ({ value: s.value, label: (s.dayOffset === 0 ? fmtTime : fmtDayTime).format(new Date(s.value)) })),
      minOrderCents: location.takeawaySettings?.minOrderCents ?? 0,
      pickupPoint: location.takeawaySettings?.pickupPoint ?? null,
    };
    if (!location.takeawayEnabled) notFound();
    if (location.takeawaySettings?.paused) canOrder = false;
    if (!opts.asap.allowed && opts.slots.length === 0) {
      canOrder = false;
      message = m.customer.noPickupSlots;
    }
    if (wa) checkout.whatsapp = { number: wa, restaurant: org.name };
  } else if (mode === 'delivery') {
    if (!location.deliveryEnabled) notFound();
    const ds = location.deliverySettings;
    checkout.delivery = { cash: ds?.cashOnDeliveryEnabled ?? true, card: ds?.cardOnDeliveryEnabled ?? false, pickupHref: location.takeawayEnabled ? `${base}/order/pickup${q}` : undefined };
    const hours = (ds?.deliveryHours ?? location.openingHours ?? null) as OpeningHours | null;
    const p = zonedParts(new Date(), location.timeZone);
    if (ds?.paused || (hours && !isOpenAt(hours, p.weekday, p.hour * 60 + p.minute)) || location.deliveryZones.length === 0 || (!checkout.delivery.cash && !checkout.delivery.card)) canOrder = false;
  } else {
    if (!wa) notFound();
    checkout.whatsapp = { number: wa, restaurant: org.name, only: true };
    // WhatsApp is not a MenuNiva order, so it is not gated by the takeaway module or the
    // takeaway switch. It does respect opening hours: a prepared message is still useful when
    // the kitchen is closed, but the guest must be told nobody is reading it right now.
    const hours = (location.openingHours ?? null) as OpeningHours | null;
    if (hours) {
      const p = zonedParts(new Date(), location.timeZone);
      if (!isOpenAt(hours, p.weekday, p.hour * 60 + p.minute)) message = m.customer.closedNow;
    }
  }
  // A draft preview shows the real menu, prices and checkout options, but never takes orders.
  if (isPreview) {
    canOrder = false;
    message = m.customer.previewOrdering;
  }
  if (!canOrder && !message) message = m.customer.orderingPaused;

  const [menu, upsellRules] = await Promise.all([getPublicMenu(location.id, lang, channel), upsellRulesFor(org.id)]);
  const title = mode === 'pickup' ? m.customer.pickup : mode === 'delivery' ? m.customer.restaurantDelivery : m.customer.orderViaWhatsApp;
  // The same ordering switcher as the menu page, with this channel highlighted.
  const lq = guestQuery({ l: sp.l }, keep);
  const all: OrderMode[] = [
    { key: 'menu', label: m.customer.menu, href: `${base}${sp.l ? `/${encodeURIComponent(sp.l)}` : ''}${guestQuery({}, keep)}`, icon: 'book' },
    ...(location.takeawayEnabled && modules.has('takeaway') ? [{ key: 'pickup', label: m.customer.pickup, href: `${base}/order/pickup${lq}`, icon: 'bag' as const }] : []),
    ...(location.deliveryEnabled && modules.has('delivery') ? [{ key: 'delivery', label: m.customer.restaurantDelivery, href: `${base}/order/delivery${lq}`, icon: 'truck' as const }] : []),
    ...(location.reservationsEnabled && modules.has('reservations') ? [{ key: 'reserve', label: m.customer.reserveTable, href: `${base}/reserve${lq}`, icon: 'calendar' as const }] : []),
    ...(wa ? [{ key: 'whatsapp', label: m.customer.orderViaWhatsApp, href: `${base}/order/whatsapp${lq}`, icon: 'phone' as const }] : []),
  ];
  const modes = all.map((x) => ({ ...x, active: x.key === mode }));
  const minDelivery = location.deliveryZones.reduce<number | null>((min, z) => (min === null || z.minOrderCents < min ? z.minOrderCents : min), null);

  return (
    <StorefrontShell branding={branding} restaurantName={org.name} subtitle={title} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      {isPreview && <PreviewBanner />}
      <div className="mx-auto max-w-5xl space-y-2.5 px-4 pt-4 text-sm sm:px-6">
        <OrderModeBar label={m.customer.howToOrder} modes={modes} />
        <p className="opacity-70" data-testid="order-mode">{m.customer.viewOnly}{mode === 'pickup' && checkout.pickup!.minOrderCents > 0 ? ` ${m.customer.minimumOrder.replace('{amount}', new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format(checkout.pickup!.minOrderCents / 100))}` : ''}{mode === 'delivery' && minDelivery ? ` ${m.customer.minimumOrder.replace('{amount}', new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format(minDelivery / 100))}` : ''}</p>
      </div>
      <MenuApp
        channel={channel}
        scope={{ orgSlug: org.slug, locationSlug: location.slug, locationId: location.id }}
        lang={lang}
        tag={tag}
        menu={menu}
        canOrder={canOrder}
        orderingMessage={message}
        m={{ customer: m.customer, common: m.common, allergens: m.allergens, validation: m.validation }}
        allergyNotice={allergyNoticeFor(settings, lang, m.customer.allergyNoticeDefault)}
        pricesIncludeVat={settings?.pricesIncludeTax ?? true}
        checkout={checkout}
        upsellRules={upsellRules}
      />
    </StorefrontShell>
  );
}
