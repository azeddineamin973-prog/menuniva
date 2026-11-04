import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { db } from '@/server/db';
import { hasModule } from '@/server/modules';
import { loyaltyForOrder } from '@/server/services/loyalty';
import { trackOrder } from '@/server/services/orders';
import { resolveGuestLanguage } from '@/server/services/storefront';
import { LoyaltyCard } from './loyalty-card';
import { OrderTracker } from './tracker';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'Order' };

/** Private order tracking page; the URL token is unguessable and never indexed. */
export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await trackOrder(token);
  if (!order) notFound();
  // This page is what every guest waits for right after sending an order: the restaurant, the loyalty
  // card and the feedback module are read side by side, not one after the other (final QA, +80 ms).
  const orgRead = db.restaurantOrganization.findUniqueOrThrow({ where: { slug: order.location.organization.slug }, include: { branding: true } });
  const langRead = orgRead.then((o) => resolveGuestLanguage(o, order.language));
  const [org, lang, loyalty, feedbackOn] = await Promise.all([
    orgRead,
    langRead,
    order.status === 'CANCELLED' ? null : loyaltyForOrder(token, langRead),
    hasModule(order.organizationId, 'feedback'),
  ]);
  const m = getMessages(lang);
  // Back to the table menu only with the QR this order was placed with: after staff replace a
  // table's QR, an old tracking link must not hand out the new one (audit V5, Q04).
  const qr = order.table?.qrTokens[0];
  const tableToken = order.tableSession?.status === 'OPEN' && qr && qr.createdAt <= order.createdAt ? qr.token : undefined;
  const tag = LANGUAGE_TAG[lang];
  const loc = order.location;
  const pickupWhen = order.channel === 'TAKEAWAY' && order.pickupAt ? formatPickupWhen(order.pickupAt, loc.timeZone, tag, m.ordering) : null;
  const payment =
    order.channel === 'TABLE'
      ? null
      : order.paymentMethodIntent === 'CARD_TERMINAL'
        ? m.customer.cardOnDelivery
        : order.paymentMethodIntent === 'CASH_ON_DELIVERY'
          ? m.customer.cashOnDelivery
          : m.customer.payAtCounter;
  const address = [loc.addressLine1, [loc.postalCode, loc.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
  // A guest still seated at the table goes back to the table menu, not the public home.
  const homeHref = tableToken ? `/t/${tableToken}` : `/r/${org.slug}`;
  return (
    <StorefrontShell branding={org.branding} restaurantName={org.name} subtitle={order.location.name} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy} homeHref={homeHref} homeLabel={m.ordering.backToMenu}>
      <OrderTracker
        token={token}
        tag={tag}
        m={{ customer: m.customer, orderStatus: m.orderStatus, common: m.common, ordering: m.ordering }}
        initial={{
          number: order.number,
          channel: order.channel,
          status: order.status,
          totalCents: order.totalCents,
          subtotalCents: order.subtotalCents,
          discountCents: order.discountCents,
          deliveryFeeCents: order.deliveryFeeCents,
          cancelReason: order.status === 'CANCELLED' ? order.cancelReason : null,
          tableLabel: order.table?.label ?? null,
          pickupPoint: order.channel === 'TAKEAWAY' ? (order.location.takeawaySettings?.pickupPoint ?? null) : null,
          pickupWhen,
          payment,
          restaurant: {
            name: loc.name && loc.name !== org.name ? `${org.name} · ${loc.name}` : org.name,
            address,
            phone: loc.phone,
            mapsHref: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${org.name}, ${address}`)}` : null,
          },
          items: order.items.map((i) => ({ name: i.customerNameSnapshot ?? i.nameSnapshot, variant: i.variantNameSnapshot, quantity: i.quantity, lineTotalCents: i.lineTotalCents, modifiers: i.modifiers.map((x) => x.nameSnapshot) })),
        }}
        orderMoreHref={homeHref}
        feedbackHref={feedbackOn ? `/r/${org.slug}/feedback?o=${encodeURIComponent(token)}` : ''}
        loyalty={loyalty ? <LoyaltyCard token={token} restaurant={org.name} view={loyalty} m={{ loyalty: m.loyalty, common: m.common }} /> : undefined}
      />
    </StorefrontShell>
  );
}

/** "Today 13:30" / "Tomorrow 11:00" / "Sat 14 Nov 11:00", in the restaurant's time zone. */
function formatPickupWhen(at: Date, timeZone: string, tag: string, o: { today: string; tomorrow: string }, now = new Date()) {
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat(tag, { timeZone, hour: '2-digit', minute: '2-digit' }).format(at);
  const k = dayKey(at);
  const day = k === dayKey(now) ? o.today : k === dayKey(new Date(now.getTime() + 86_400_000)) ? o.tomorrow : new Intl.DateTimeFormat(tag, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  return `${day} ${time}`;
}
