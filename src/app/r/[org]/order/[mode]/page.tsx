import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MenuApp, type CheckoutConfig } from '@/components/storefront/menu-app';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import type { OpeningHours } from '@/lib/opening-hours';
import { isOpenAt } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';
import { db } from '@/server/db';
import { pickupOptions, publicLocation } from '@/server/services/fulfilment';
import { getPublicMenu } from '@/server/services/public-menu';
import { upsellRulesFor } from '@/server/services/upsell';
import { allergyNoticeFor, resolveGuestLanguage } from '@/server/services/storefront';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

const MODES = { pickup: 'TAKEAWAY', delivery: 'DELIVERY', whatsapp: 'TAKEAWAY' } as const;

/** Guest ordering for pickup, restaurant delivery, or a prepared WhatsApp message. */
export default async function OrderModePage({ params, searchParams }: { params: Promise<{ org: string; mode: string }>; searchParams: Promise<{ l?: string; lang?: string }> }) {
  const { org: orgSlug, mode } = await params;
  const sp = await searchParams;
  if (!(mode in MODES)) notFound();
  const channel = MODES[mode as keyof typeof MODES];
  const pl = await publicLocation(orgSlug, sp.l);
  if (!pl) notFound();
  const { org, location } = pl;
  const [branding, settings] = await Promise.all([db.restaurantBranding.findUnique({ where: { organizationId: org.id } }), db.restaurantSettings.findUnique({ where: { organizationId: org.id } })]);
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  const tag = LANGUAGE_TAG[lang];
  const base = `/r/${org.slug}`;
  const q = sp.l ? `?l=${encodeURIComponent(sp.l)}` : '';
  const wa = location.whatsappOrderingEnabled && location.whatsappNumber ? location.whatsappNumber.replace(/\D/g, '') : null;

  let canOrder = !location.orderingPaused;
  let message: string | undefined;
  const checkout: CheckoutConfig = { country: location.country };
  if (mode === 'pickup') {
    const opts = pickupOptions(location, location.takeawaySettings);
    const fmtTime = new Intl.DateTimeFormat(tag, { timeZone: location.timeZone, hour: '2-digit', minute: '2-digit' });
    checkout.pickup = { asapAllowed: opts.asap.allowed, asapMinutes: opts.asap.minutes, slots: opts.slots.map((s) => ({ value: s.value, label: fmtTime.format(new Date(s.value)) })), minOrderCents: location.takeawaySettings?.minOrderCents ?? 0 };
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
  }
  if (!canOrder && !message) message = m.customer.orderingPaused;

  const [menu, upsellRules] = await Promise.all([getPublicMenu(location.id, lang, channel), upsellRulesFor(org.id)]);
  const title = mode === 'pickup' ? m.customer.pickup : mode === 'delivery' ? m.customer.restaurantDelivery : m.customer.orderViaWhatsApp;
  const minDelivery = location.deliveryZones.reduce<number | null>((min, z) => (min === null || z.minOrderCents < min ? z.minOrderCents : min), null);

  return (
    <StorefrontShell branding={branding} restaurantName={org.name} subtitle={title} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      <div className="mx-auto max-w-3xl px-4 pt-3 text-sm">
        <Link href={`${base}${sp.l ? `/${sp.l}` : ''}`} className="underline opacity-70">← {m.customer.menu}</Link>
        <p className="mt-1 opacity-70" data-testid="order-mode">{m.customer.viewOnly}{mode === 'pickup' && checkout.pickup!.minOrderCents > 0 ? ` ${m.customer.minimumOrder.replace('{amount}', new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format(checkout.pickup!.minOrderCents / 100))}` : ''}{mode === 'delivery' && minDelivery ? ` ${m.customer.minimumOrder.replace('{amount}', new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format(minDelivery / 100))}` : ''}</p>
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
