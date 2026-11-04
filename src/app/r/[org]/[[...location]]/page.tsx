import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MenuApp } from '@/components/storefront/menu-app';
import { StorefrontShell } from '@/components/storefront/shell';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { OpenStatus, OrderChoice, type OrderChoiceItem } from '@/components/storefront/order-modes';
import { fmt } from '@/i18n/config';
import { formatCents } from '@/lib/money';
import { deliveryAvailability, labelPickupSlots, pickupAvailability } from '@/server/services/order-modes';
import { isOpenAt } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { env } from '@/server/env';
import { getPublicMenu } from '@/server/services/public-menu';
import { allergyNoticeFor, canPreviewOrg, guestQuery, resolveGuestLanguage } from '@/server/services/storefront';
import { Icon, type IconName } from '@/components/ui/icons';
import { footerLabels, StorefrontFooter } from '@/components/storefront/footer';
import { loadStorefrontFooter } from '@/server/services/storefront-footer';
import type { OpeningHours } from '@/lib/opening-hours';

export const dynamic = 'force-dynamic';

const CHANNELS_AVAILABLE = { takeaway: true, delivery: true, reservations: true };

type Params = { org: string; location?: string[] };

async function load(params: Params, preview: boolean) {
  const org = await db.restaurantOrganization.findUnique({ where: { slug: params.org }, include: { branding: true, settings: true, locations: { orderBy: { createdAt: 'asc' } } } });
  if (!org || org.status === 'ARCHIVED' || org.status === 'SUSPENDED') return null;
  const canPreview = await canPreviewOrg(org.id, preview);
  const visible = org.locations.filter((l) => l.isPublished || canPreview);
  const requested = params.location?.[0];
  const location = requested ? visible.find((l) => l.slug === requested) : visible[0];
  // The restaurant exists but has nothing public at this address (yet): a friendly notice,
  // never the menu. A location slug that does not exist at all stays a 404.
  if (!location) return requested && !org.locations.some((l) => l.slug === requested) ? null : { org, location: null, isPreview: false };
  return { org, location, isPreview: canPreview && !location.isPublished };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const data = await load(p, false);
  if (!data?.location) return { robots: { index: false } };
  const { org, location } = data;
  const title = `${org.name}${location.city ? ` — ${location.city}` : ''}`;
  const description = org.branding?.tagline ?? `Menu, ordering and contact for ${org.name}${location.city ? ` in ${location.city}` : ''}.`;
  const canonical = `${env.APP_BASE_URL}/r/${org.slug}${org.locations.length > 1 ? `/${location.slug}` : ''}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website', images: org.branding?.coverUrl ? [{ url: `${env.APP_BASE_URL}${org.branding.coverUrl}` }] : undefined },
  };
}

/** Public restaurant storefront: /r/<restaurant> or /r/<restaurant>/<location>. */
export default async function StorefrontPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ preview?: string; lang?: string }> }) {
  const p = await params;
  const sp = await searchParams;
  const data = await load(p, sp.preview === '1');
  if (!data) notFound();
  const { org, isPreview } = data;
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  if (!data.location) {
    return (
      <StorefrontShell branding={org.branding} restaurantName={org.name} lang={lang} languages={org.enabledLanguages} poweredBy={m.common.poweredBy}>
        <div className="mx-auto max-w-md px-4 py-16 text-center" data-testid="not-published">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sf-card text-sf-primary-ink shadow-sm ring-1 ring-sf-text/10" aria-hidden>
            <Icon name="clock" className="size-6" />
          </span>
          <h2 className="mt-4 font-serif text-2xl">{m.customer.notPublishedTitle}</h2>
          <p className="mt-2 text-sm opacity-75">{m.customer.notPublishedBody}</p>
        </div>
      </StorefrontShell>
    );
  }
  const location = data.location;
  // In preview the owner stays in preview (and in the chosen language) on every guest page.
  const keep = { preview: isPreview, lang: sp.lang === lang ? lang : null };
  const menu = await getPublicMenu(location.id, lang, 'TABLE');
  const modules = await orgModules(org.id);
  const base = `/r/${org.slug}${org.locations.length > 1 ? `/${location.slug}` : ''}`;
  const lq = guestQuery({ l: org.locations.length > 1 ? location.slug : null }, keep);
  const wa = location.whatsappOrderingEnabled && location.whatsappNumber ? location.whatsappNumber.replace(/[^\d]/g, '') : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: org.name,
    url: `${env.APP_BASE_URL}${base}`,
    telephone: location.phone ?? undefined,
    image: org.branding?.coverUrl ? `${env.APP_BASE_URL}${org.branding.coverUrl}` : undefined,
    address: location.addressLine1
      ? { '@type': 'PostalAddress', streetAddress: location.addressLine1, addressLocality: location.city ?? undefined, postalCode: location.postalCode ?? undefined, addressCountry: location.country }
      : undefined,
    hasMenu: `${env.APP_BASE_URL}${base}#menu`,
  };

  const actions: { label: string; href: string; icon: IconName; external?: boolean; primary?: boolean }[] = [];
  const o = m.ordering;
  const tag = LANGUAGE_TAG[lang];
  const money = (c: number) => formatCents(c, tag);
  const choices: OrderChoiceItem[] = [];
  const wantsPickup = CHANNELS_AVAILABLE.takeaway && location.takeawayEnabled && modules.has('takeaway');
  const wantsDelivery = CHANNELS_AVAILABLE.delivery && location.deliveryEnabled && modules.has('delivery');
  if (wantsPickup || wantsDelivery) {
    // What each method looks like right now, computed exactly like the ordering page does.
    const full = await db.restaurantLocation.findUniqueOrThrow({ where: { id: location.id }, include: { takeawaySettings: true, deliverySettings: true, deliveryZones: { where: { isActive: true } } } });
    if (wantsPickup) {
      const href = `/r/${org.slug}/order/pickup${lq}`;
      actions.push({ label: o.pickupTitle, href, icon: 'bag', primary: true });
      const pa = pickupAvailability(full);
      const first = labelPickupSlots(pa.opts, tag, location.timeZone, o)[0];
      choices.push({
        key: 'pickup',
        title: o.pickupTitle,
        href,
        icon: 'bag',
        lines: [pa.opts.asap.allowed ? fmt(o.pickupReady, { minutes: pa.opts.asap.minutes }) : first ? fmt(o.pickupNext, { time: `${first.day} ${first.time}` }) : m.customer.noPickupSlots, ...(location.addressLine1 ? [[location.addressLine1, location.city].filter(Boolean).join(', ')] : [])],
        unavailable: pa.open ? undefined : o.unavailableNow,
      });
    }
    if (wantsDelivery) {
      const href = `/r/${org.slug}/order/delivery${lq}`;
      actions.push({ label: o.deliveryTitle, href, icon: 'truck', primary: true });
      const da = deliveryAvailability(full);
      choices.push({
        key: 'delivery',
        title: o.deliveryTitle,
        href,
        icon: 'truck',
        lines: [o.deliveryBy, [da.minFeeCents !== null ? fmt(o.deliveryFrom, { amount: da.minFeeCents === 0 ? m.customer.deliveryFee0 : money(da.minFeeCents) }) : null, fmt(m.customer.estimatedTime, { minutes: da.estimateMinutes })].filter(Boolean).join(' · ')],
        unavailable: da.open ? undefined : o.unavailableNow,
      });
    }
  }
  if (CHANNELS_AVAILABLE.reservations && location.reservationsEnabled && modules.has('reservations')) actions.push({ label: m.customer.reserveTable, href: `/r/${org.slug}/reserve${lq}`, icon: 'calendar' });
  if (wa) actions.push({ label: m.customer.orderViaWhatsApp, href: `/r/${org.slug}/order/whatsapp${lq}`, icon: 'phone' });
  if (location.glovoUrl) actions.push({ label: m.customer.orderOnGlovo, href: location.glovoUrl, icon: 'external', external: true });
  if (location.uberEatsUrl) actions.push({ label: m.customer.orderOnUberEats, href: location.uberEatsUrl, icon: 'external', external: true });
  const hours = (location.openingHours as OpeningHours | null) ?? null;
  const zp = zonedParts(new Date(), location.timeZone);
  // Only when hours are configured: never guess whether the restaurant is open.
  const openNow = hours && Object.keys(hours).length > 0 ? isOpenAt(hours, zp.weekday, zp.hour * 60 + zp.minute) : null;
  const address = [location.addressLine1, location.city].filter(Boolean).join(', ');
  const primary = actions.filter((a) => a.primary);
  const others = actions.filter((a) => !a.external && !a.primary);
  // Address, hours, ways to order and the restaurant's links: all in the footer, once.
  const footer = await loadStorefrontFooter({ org, location, branding: org.branding, lang, m, query: lq, menuHref: `${base}${guestQuery({}, keep)}#menu` });

  return (
    <StorefrontShell
      branding={org.branding}
      restaurantName={org.name}
      subtitle={org.branding?.tagline ?? (location.name !== org.name ? location.name : undefined)}
      lang={lang}
      languages={org.enabledLanguages}
      poweredBy={m.common.poweredBy}
      homeHref={`${base}${guestQuery({}, keep)}`}
      homeLabel={m.ordering.backToMenu}
      footer={<StorefrontFooter data={footer} labels={footerLabels(m)} />}
      headerMeta={
        <>
          <OpenStatus open={openNow} labels={m.customer} />
          {address && (
            <span className="inline-flex items-center gap-1.5 text-sm opacity-90">
              <Icon name="map" className="size-4" />
              {address}
            </span>
          )}
        </>
      }
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      {isPreview && <PreviewBanner />}
      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6 sm:pt-8">
        <OrderChoice title={o.chooseTitle} items={choices} />
      </div>

      <div id="menu" className="pt-4">
        {primary.length > 0 && <h2 className="mx-auto max-w-5xl px-4 pt-4 font-serif text-[1.6rem] sm:px-6 sm:text-[1.9rem]">{o.ourMenu}</h2>}
        <MenuApp
          channel="TABLE"
          scope={{ orgSlug: org.slug, locationSlug: location.slug, locationId: location.id }}
          lang={lang}
          tag={tag}
          menu={menu}
          canOrder={false}
          // This page is for browsing: ordering happens at a table (QR), or through one of the
          // ways above. The notice says which, once.
          orderingMessage={location.tableOrderingEnabled ? `${m.customer.orderAtTable} — ${m.customer.scanQrAtTable}` : primary.length === 0 && actions.length > 0 ? m.customer.howToOrder : undefined}
          m={{ customer: m.customer, common: m.common, allergens: m.allergens, validation: m.validation, ordering: m.ordering }}
          allergyNotice={allergyNoticeFor(org.settings, lang, m.customer.allergyNoticeDefault)}
          pricesIncludeVat={org.settings?.pricesIncludeTax ?? true}
          // Inside a dish: only the ways to order it (pickup / delivery), each opening that dish.
          orderActions={(primary.length ? primary : others).map((a) => ({ label: a.label, href: a.href, icon: a.icon === 'bag' || a.icon === 'truck' ? a.icon : undefined }))}
        />
      </div>

    </StorefrontShell>
  );
}
