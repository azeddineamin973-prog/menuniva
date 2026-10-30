import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { db } from '@/server/db';
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
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { slug: order.location.organization.slug }, include: { branding: true } });
  const lang = await resolveGuestLanguage(org, order.language);
  const m = getMessages(lang);
  const tableToken = order.table?.qrTokens[0]?.token;
  const loyalty = order.status === 'CANCELLED' ? null : await loyaltyForOrder(token, lang);
  return (
    <StorefrontShell branding={org.branding} restaurantName={org.name} subtitle={order.location.name} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      <OrderTracker
        token={token}
        tag={LANGUAGE_TAG[lang]}
        m={{ customer: m.customer, orderStatus: m.orderStatus, common: m.common }}
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
          items: order.items.map((i) => ({ name: i.customerNameSnapshot ?? i.nameSnapshot, variant: i.variantNameSnapshot, quantity: i.quantity, lineTotalCents: i.lineTotalCents, modifiers: i.modifiers.map((x) => x.nameSnapshot) })),
        }}
        orderMoreHref={tableToken ? `/t/${tableToken}` : `/r/${org.slug}`}
        feedbackHref={`/r/${org.slug}/feedback?o=${encodeURIComponent(token)}`}
        loyalty={loyalty ? <LoyaltyCard token={token} restaurant={org.name} view={loyalty} m={{ loyalty: m.loyalty, common: m.common }} /> : undefined}
      />
    </StorefrontShell>
  );
}
