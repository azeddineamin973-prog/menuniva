import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MenuApp } from '@/components/storefront/menu-app';
import { ModeSwitch } from '@/components/storefront/cart-sheet';
import { StorefrontShell } from '@/components/storefront/shell';
import { JourneySteps } from '@/components/storefront/ui';
import { footerLabels, StorefrontFooter } from '@/components/storefront/footer';
import { StoreHero } from '@/components/storefront/store-hero';
import { loadStorefrontFooter } from '@/server/services/storefront-footer';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { Icon } from '@/components/ui/icons';
import { loadOrderPage } from '@/server/services/order-page';
import { getPublicMenu } from '@/server/services/public-menu';
import { upsellRulesFor } from '@/server/services/upsell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

/** Guest ordering for pickup, the restaurant's own delivery, or a prepared WhatsApp message. */
export default async function OrderModePage({ params, searchParams }: { params: Promise<{ org: string; mode: string }>; searchParams: Promise<{ l?: string; lang?: string; preview?: string }> }) {
  const { org: orgSlug, mode } = await params;
  const sp = await searchParams;
  const page = await loadOrderPage(orgSlug, mode, sp);
  if (!page) notFound();
  const { org, location, m, lang, tag, checkout, canOrder, message, summary, title, hrefs, checkoutHrefs } = page;
  const [menu, upsellRules, footer] = await Promise.all([
    getPublicMenu(location.id, lang, page.channel),
    upsellRulesFor(org.id),
    loadStorefrontFooter({ org, location, branding: page.branding, lang, m, query: page.query, menuHref: `${page.homeHref}#menu` }),
  ]);
  const remote = page.mode !== 'whatsapp';
  const b = page.branding;

  // One compact bar: the Pickup / Delivery switch and what to expect with it.
  const header = (
    <div className="space-y-2.5" data-testid="method-bar">
      {remote && <JourneySteps label={m.ordering.stepsLabel} current={0} steps={[{ label: m.ordering.stepMenu }, { label: m.ordering.stepCheckout }, { label: m.ordering.stepDone }]} className="max-w-md px-1 pb-1" />}
      {remote && <ModeSwitch current={page.mode === 'delivery' ? 'delivery' : 'pickup'} hrefs={hrefs} labels={m.ordering} testId="mode-switch" />}
      <p className="flex items-start gap-2 px-1 text-sm text-sf-muted" data-testid="order-mode">
        <Icon name={page.mode === 'delivery' ? 'truck' : page.mode === 'pickup' ? 'bag' : 'phone'} className="mt-0.5 size-4 shrink-0 text-sf-primary-ink" />
        <span>
          <span className="font-medium text-sf-text">{title}</span>
          {summary.map((s) => (
            <span key={s}> · {s}</span>
          ))}
        </span>
      </p>
    </div>
  );

  return (
    <StorefrontShell
      branding={page.branding}
      restaurantName={org.name}
      subtitle={location.name !== org.name ? location.name : undefined}
      lang={lang}
      languages={org.enabledLanguages}
      compactHeader
      wide={remote}
      poweredBy={m.common.poweredBy}
      backHref={page.homeHref}
      backLabel={m.ordering.backToMenu}
      homeHref={page.homeHref}
      homeLabel={m.ordering.backToMenu}
      footer={<StorefrontFooter data={footer} labels={footerLabels(m)} wide={remote} reserveBottom />}
    >
      {page.isPreview && <PreviewBanner />}
      {b?.coverUrl && (
        <StoreHero
          name={org.name}
          coverUrl={b.coverUrl}
          logoUrl={b.logoUrl}
          tagline={b.tagline}
          address={footer.address}
          openNow={footer.openNow}
          labels={m.customer}
          serif={(b.headingFont ?? 'serif') === 'serif'}
          homeHref={page.homeHref}
          homeLabel={m.ordering.backToMenu}
        />
      )}
      <MenuApp
        channel={page.channel}
        scope={{ orgSlug: org.slug, locationSlug: location.slug, locationId: location.id }}
        lang={lang}
        tag={tag}
        menu={menu}
        canOrder={canOrder}
        orderingMessage={message}
        m={{ customer: m.customer, common: m.common, allergens: m.allergens, validation: m.validation, ordering: m.ordering }}
        allergyNotice={page.allergyNotice}
        pricesIncludeVat={page.pricesIncludeVat}
        checkout={checkout}
        upsellRules={upsellRules}
        checkoutHref={remote ? (page.mode === 'delivery' ? checkoutHrefs.delivery : checkoutHrefs.pickup) : undefined}
        header={header}
      />
    </StorefrontShell>
  );
}
