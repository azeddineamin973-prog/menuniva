import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MenuApp } from '@/components/storefront/menu-app';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { getCurrentUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { env } from '@/server/env';
import { getPublicMenu } from '@/server/services/public-menu';
import { allergyNoticeFor, resolveGuestLanguage } from '@/server/services/storefront';
import { StorefrontHours } from '@/components/storefront/opening-hours';
import type { OpeningHours } from '@/lib/opening-hours';

export const dynamic = 'force-dynamic';

const CHANNELS_AVAILABLE = { takeaway: true, delivery: true, reservations: true };
const CHIP = 'inline-flex min-h-10 items-center rounded-full bg-white/70 px-3.5 font-medium ring-1 ring-black/10 transition hover:bg-white';

type Params = { org: string; location?: string[] };

async function load(params: Params, preview: boolean) {
  const org = await db.restaurantOrganization.findUnique({ where: { slug: params.org }, include: { branding: true, settings: true, locations: { orderBy: { createdAt: 'asc' } } } });
  if (!org || org.status === 'ARCHIVED' || org.status === 'SUSPENDED') return null;
  let canPreview = false;
  if (preview) {
    const user = await getCurrentUser();
    canPreview = !!user && !!(await db.restaurantMembership.findFirst({ where: { userId: user.id, organizationId: org.id, status: 'ACTIVE' } }));
  }
  const visible = org.locations.filter((l) => l.isPublished || canPreview);
  const location = params.location?.[0] ? visible.find((l) => l.slug === params.location![0]) : visible[0];
  if (!location) return null;
  return { org, location, isPreview: canPreview && !location.isPublished };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const data = await load(p, false);
  if (!data) return { robots: { index: false } };
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
  const { org, location, isPreview } = data;
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  const menu = await getPublicMenu(location.id, lang, 'TABLE');
  const [review, modules] = await Promise.all([db.reviewSettings.findUnique({ where: { locationId: location.id } }), orgModules(org.id)]);
  const base = `/r/${org.slug}${org.locations.length > 1 ? `/${location.slug}` : ''}`;
  const lq = org.locations.length > 1 ? `?l=${location.slug}` : '';
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

  const actions: { label: string; href: string; external?: boolean; primary?: boolean }[] = [];
  if (CHANNELS_AVAILABLE.takeaway && location.takeawayEnabled && modules.has('takeaway')) actions.push({ label: m.customer.pickup, href: `/r/${org.slug}/order/pickup${lq}`, primary: true });
  if (CHANNELS_AVAILABLE.delivery && location.deliveryEnabled && modules.has('delivery')) actions.push({ label: m.customer.restaurantDelivery, href: `/r/${org.slug}/order/delivery${lq}`, primary: true });
  if (CHANNELS_AVAILABLE.reservations && location.reservationsEnabled && modules.has('reservations')) actions.push({ label: m.customer.reserveTable, href: `/r/${org.slug}/reserve${lq}` });
  if (wa) actions.push({ label: m.customer.orderViaWhatsApp, href: `/r/${org.slug}/order/whatsapp${lq}` });
  if (location.glovoUrl) actions.push({ label: m.customer.orderOnGlovo, href: location.glovoUrl, external: true });
  if (location.uberEatsUrl) actions.push({ label: m.customer.orderOnUberEats, href: location.uberEatsUrl, external: true });

  return (
    <StorefrontShell branding={org.branding} restaurantName={org.name} subtitle={[location.addressLine1, location.city].filter(Boolean).join(', ') || undefined} lang={lang} languages={org.enabledLanguages} poweredBy={m.common.poweredBy}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      {isPreview && <div className="bg-amber-200 px-4 py-2 text-center text-sm font-medium text-amber-900" data-testid="preview-banner">PREVIEW — not published. Only your staff can see this page.</div>}
      <div className="mx-auto max-w-3xl space-y-3 px-4 pt-5">
        {org.branding?.tagline && <p className="font-serif text-lg">{org.branding.tagline}</p>}
        {actions.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {actions.map((a) =>
              a.external ? (
                <a key={a.label} href={a.href} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-white/85 px-4 py-3.5 text-center font-medium shadow-sm ring-1 ring-black/10 transition hover:shadow-md">
                  {a.label} ↗
                </a>
              ) : (
                <Link
                  key={a.label}
                  href={a.href}
                  className={
                    a.primary
                      ? 'rounded-2xl bg-sf-primary px-4 py-3.5 text-center font-medium text-white shadow-sm transition hover:shadow-md'
                      : 'rounded-2xl bg-white/85 px-4 py-3.5 text-center font-medium shadow-sm ring-1 ring-black/10 transition hover:shadow-md'
                  }
                >
                  {a.label}
                </Link>
              ),
            )}
          </div>
        )}
        {wa && <p className="text-xs opacity-60">{m.customer.whatsappOpenNote}</p>}
        <StorefrontHours hours={(location.openingHours as OpeningHours | null) ?? null} timeZone={location.timeZone} tag={LANGUAGE_TAG[lang]} m={m.customer} />
        {/* Contact and review links as chips: easy to hit with a thumb, unlike underlined words. */}
        <div className="flex flex-wrap gap-2 text-sm">
          {location.phone && <a href={`tel:${location.phone.replace(/\s/g, '')}`} className={CHIP} dir="ltr">☎ {location.phone}</a>}
          {location.websiteUrl && <a href={location.websiteUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>Website ↗</a>}
          {location.instagramUrl && <a href={location.instagramUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>Instagram</a>}
          {location.facebookUrl && <a href={location.facebookUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>Facebook</a>}
          {location.tiktokUrl && <a href={location.tiktokUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>TikTok</a>}
          {modules.has('feedback') && <Link href={`/r/${org.slug}/feedback?l=${location.slug}`} className={CHIP}>{m.customer.leaveFeedback}</Link>}
          {review?.googleReviewUrl && <a href={review.googleReviewUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>Google ↗</a>}
        </div>
      </div>
      <div id="menu">
        <MenuApp
          channel="TABLE"
          scope={{ orgSlug: org.slug, locationSlug: location.slug, locationId: location.id }}
          lang={lang}
          tag={LANGUAGE_TAG[lang]}
          menu={menu}
          canOrder={false}
          // This page is for browsing: ordering happens at a table (QR), or through one of the
          // channels above. The notice says which, once — it used to be printed twice.
          orderingMessage={
            location.tableOrderingEnabled
              ? `📱 ${m.customer.orderAtTable} — ${m.customer.scanQrAtTable}`
              : actions.length > 0
                ? m.customer.howToOrder
                : undefined
          }
          m={{ customer: m.customer, common: m.common, allergens: m.allergens, validation: m.validation }}
          allergyNotice={allergyNoticeFor(org.settings, lang, m.customer.allergyNoticeDefault)}
          pricesIncludeVat={org.settings?.pricesIncludeTax ?? true}
          orderActions={actions.filter((a) => !a.external).map((a) => ({ label: a.label, href: a.href }))}
        />
      </div>
    </StorefrontShell>
  );
}
