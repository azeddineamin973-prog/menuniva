import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CheckoutForm } from '@/components/storefront/checkout-form';
import { StorefrontShell } from '@/components/storefront/shell';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { loadOrderPage } from '@/server/services/order-page';
import { getPublicMenu } from '@/server/services/public-menu';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false }, title: 'Checkout' };

/** Checkout for pickup or the restaurant's own delivery (the cart lives in the guest's browser). */
export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ org: string; mode: string }>; searchParams: Promise<{ l?: string; lang?: string; preview?: string }> }) {
  const { org: orgSlug, mode } = await params;
  if (mode !== 'pickup' && mode !== 'delivery') notFound();
  const sp = await searchParams;
  const page = await loadOrderPage(orgSlug, mode, sp);
  if (!page) notFound();
  const { org, location, m, lang, tag } = page;
  const menu = await getPublicMenu(location.id, lang, page.channel);
  const other = mode === 'pickup' ? 'delivery' : 'pickup';
  const menuHref = page.hrefs[mode]!;
  return (
    <StorefrontShell branding={page.branding} restaurantName={org.name} subtitle={m.ordering.checkoutTitle} lang={lang} languages={org.enabledLanguages} compactHeader wide poweredBy={m.common.poweredBy} backHref={menuHref} backLabel={m.ordering.backToCart} homeHref={page.homeHref} homeLabel={m.ordering.backToMenu}>
      {page.isPreview && <PreviewBanner />}
      <CheckoutForm
        channel={page.channel as 'TAKEAWAY' | 'DELIVERY'}
        scope={{ orgSlug: org.slug, locationSlug: location.slug, locationId: location.id }}
        lang={lang}
        tag={tag}
        m={{ customer: m.customer, common: m.common, allergens: m.allergens, validation: m.validation, ordering: m.ordering }}
        menu={menu}
        checkout={page.checkout}
        canOrder={page.canOrder}
        message={page.message}
        allergyNotice={page.allergyNotice}
        pricesIncludeVat={page.pricesIncludeVat}
        menuHref={menuHref}
        method={{
          title: page.title,
          summary: page.summary,
          changeHref: page.checkoutHrefs[other],
          changeLabel: m.ordering.switchTo.replace('{mode}', other === 'delivery' ? m.ordering.modeDelivery : m.ordering.modePickup),
        }}
      />
    </StorefrontShell>
  );
}
