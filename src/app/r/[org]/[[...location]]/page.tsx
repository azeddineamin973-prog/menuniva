import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MenuApp } from '@/components/storefront/menu-app';
import { StorefrontShell } from '@/components/storefront/shell';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { env } from '@/server/env';
import { getPublicMenu } from '@/server/services/public-menu';
import { allergyNoticeFor, canPreviewOrg, guestQuery, resolveGuestLanguage } from '@/server/services/storefront';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { StorefrontHours } from '@/components/storefront/opening-hours';
import type { OpeningHours } from '@/lib/opening-hours';

export const dynamic = 'force-dynamic';

const CHANNELS_AVAILABLE = { takeaway: true, delivery: true, reservations: true };
const CHIP = 'inline-flex min-h-10 items-center gap-1.5 rounded-full bg-sf-card/70 px-3.5 font-medium ring-1 ring-sf-text/10 transition hover:bg-sf-card';

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
  const [review, modules] = await Promise.all([db.reviewSettings.findUnique({ where: { locationId: location.id } }), orgModules(org.id)]);
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
  if (CHANNELS_AVAILABLE.takeaway && location.takeawayEnabled && modules.has('takeaway')) actions.push({ label: m.customer.pickup, href: `/r/${org.slug}/order/pickup${lq}`, icon: 'bag', primary: true });
  if (CHANNELS_AVAILABLE.delivery && location.deliveryEnabled && modules.has('delivery')) actions.push({ label: m.customer.restaurantDelivery, href: `/r/${org.slug}/order/delivery${lq}`, icon: 'truck', primary: true });
  if (CHANNELS_AVAILABLE.reservations && location.reservationsEnabled && modules.has('reservations')) actions.push({ label: m.customer.reserveTable, href: `/r/${org.slug}/reserve${lq}`, icon: 'calendar' });
  if (wa) actions.push({ label: m.customer.orderViaWhatsApp, href: `/r/${org.slug}/order/whatsapp${lq}`, icon: 'phone' });
  if (location.glovoUrl) actions.push({ label: m.customer.orderOnGlovo, href: location.glovoUrl, icon: 'external', external: true });
  if (location.uberEatsUrl) actions.push({ label: m.customer.orderOnUberEats, href: location.uberEatsUrl, icon: 'external', external: true });
  const mapsHref = location.addressLine1 ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([org.name, location.addressLine1, location.postalCode, location.city].filter(Boolean).join(', '))}` : null;

  return (
    <StorefrontShell branding={org.branding} restaurantName={org.name} subtitle={[location.addressLine1, location.city].filter(Boolean).join(', ') || undefined} lang={lang} languages={org.enabledLanguages} poweredBy={m.common.poweredBy}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      {isPreview && <PreviewBanner />}
      <div className="mx-auto max-w-3xl space-y-3 px-4 pt-5">
        {org.branding?.tagline && <p className="font-serif text-lg leading-snug">{org.branding.tagline}</p>}
        {actions.length > 0 && (
          // Ways to order first (large, brand-coloured), the rest as a compact two-column row so
          // the menu itself starts higher on a phone.
          <div className="space-y-2">
            {actions.some((a) => a.primary) && (
              <div className={cn('grid gap-2', actions.filter((a) => a.primary).length > 1 && 'grid-cols-2')}>
                {actions
                  .filter((a) => a.primary)
                  .map((a) => (
                    <Link
                      key={a.label}
                      href={a.href}
                      className="flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-sf-primary px-3 py-2.5 text-center text-[15px] leading-tight font-medium text-sf-on-primary shadow-sm transition hover:shadow-md active:scale-[0.99] motion-reduce:transition-none"
                    >
                      <Icon name={a.icon} className="size-[18px] shrink-0" />
                      {a.label}
                    </Link>
                  ))}
              </div>
            )}
            {actions.some((a) => !a.primary) && (
              <div className="grid grid-cols-2 gap-2">
                {actions
                  .filter((a) => !a.primary)
                  .map((a) => {
                    const cls = 'flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-sf-card/85 px-3 py-2 text-center text-sm leading-tight font-medium shadow-sm ring-1 ring-sf-text/10 transition hover:bg-sf-card motion-reduce:transition-none';
                    return a.external ? (
                      <a key={a.label} href={a.href} target="_blank" rel="noopener noreferrer" className={cls}>
                        {a.label}
                        <Icon name="external" className="size-3.5 shrink-0 opacity-70" />
                      </a>
                    ) : (
                      <Link key={a.label} href={a.href} className={cls}>
                        <Icon name={a.icon} className="size-4 shrink-0" />
                        {a.label}
                      </Link>
                    );
                  })}
              </div>
            )}
          </div>
        )}
        {wa && <p className="text-xs opacity-60">{m.customer.whatsappOpenNote}</p>}
        <StorefrontHours hours={(location.openingHours as OpeningHours | null) ?? null} timeZone={location.timeZone} tag={LANGUAGE_TAG[lang]} m={m.customer} />
        {/* Contact and review links as chips: easy to hit with a thumb, unlike underlined words. */}
        <div className="flex flex-wrap gap-2 text-sm">
          {location.phone && (
            <a href={`tel:${location.phone.replace(/\s/g, '')}`} className={CHIP} aria-label={`${m.customer.call} ${location.phone}`}>
              <Icon name="phone" className="size-4" />
              <span dir="ltr">{location.phone}</span>
            </a>
          )}
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={CHIP}>
              <Icon name="map" className="size-4" />
              {m.customer.directions}
            </a>
          )}
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
              ? `${m.customer.orderAtTable} — ${m.customer.scanQrAtTable}`
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
