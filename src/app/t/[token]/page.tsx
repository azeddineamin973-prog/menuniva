import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MenuApp } from '@/components/storefront/menu-app';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { db } from '@/server/db';
import { resolveTableToken } from '@/server/services/orders';
import { getPublicMenu, orderingState } from '@/server/services/public-menu';
import { upsellRulesFor } from '@/server/services/upsell';
import { allergyNoticeFor, resolveGuestLanguage } from '@/server/services/storefront';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Entry point of a table QR code: /t/<random token>. */
export default async function TablePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { token } = await params;
  const { lang: langParam } = await searchParams;
  const table = await resolveTableToken(token);
  const location = table?.location;
  const org = location?.organization;
  if (!table || !location || !org || org.status === 'ARCHIVED') notFound();

  const [branding, settings] = await Promise.all([db.restaurantBranding.findUnique({ where: { organizationId: org.id } }), db.restaurantSettings.findUnique({ where: { organizationId: org.id } })]);
  const lang = await resolveGuestLanguage(org, langParam);
  const m = getMessages(lang);

  if (!location.isPublished || org.status === 'SUSPENDED') {
    return (
      <StorefrontShell branding={branding} restaurantName={org.name} lang={lang} languages={org.enabledLanguages} poweredBy={m.common.poweredBy}>
        <p className="mx-auto max-w-md px-6 py-16 text-center" data-testid="not-published">{m.customer.tableOrderingDisabled}</p>
      </StorefrontShell>
    );
  }

  const [menu, upsellRules] = await Promise.all([getPublicMenu(location.id, lang, 'TABLE'), upsellRulesFor(org.id)]);
  const state = orderingState(location, org.status, 'TABLE');
  const orderingMessage = state.canOrder ? undefined : state.reason === 'paused' ? m.customer.orderingPaused : m.customer.tableOrderingDisabled;

  return (
    <StorefrontShell branding={branding} restaurantName={org.name} subtitle={table.area?.name ?? location.name} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      <MenuApp
        channel="TABLE"
        scope={{ qrToken: token, orgSlug: org.slug, locationSlug: location.slug, locationId: location.id }}
        lang={lang}
        tag={LANGUAGE_TAG[lang]}
        menu={menu}
        canOrder={state.canOrder}
        orderingMessage={orderingMessage}
        m={{ customer: m.customer, common: m.common, allergens: m.allergens, validation: m.validation }}
        allergyNotice={allergyNoticeFor(settings, lang, m.customer.allergyNoticeDefault)}
        pricesIncludeVat={settings?.pricesIncludeTax ?? true}
        tableLabel={table.label}
        upsellRules={upsellRules}
        tableCodeRequired={location.tableCodeRequired}
      />
    </StorefrontShell>
  );
}
