import 'server-only';
import type { IconName } from '@/components/ui/icons';
import type { RestaurantLocation } from '@/generated/prisma/client';
import type { Messages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { isOpenAt, type OpeningHours } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import type { LanguageCode } from '@/generated/prisma/enums';

export type FooterLink = { label: string; href: string; icon: IconName; external?: boolean; testId?: string };
export type FooterSocial = { kind: 'website' | 'instagram' | 'facebook' | 'tiktok' | 'google'; label: string; href: string };
export type FooterData = {
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  address: string | null;
  mapsHref: string | null;
  phone: string | null;
  hours: OpeningHours | null;
  timeZone: string;
  tag: string;
  openNow: boolean | null;
  menuHref: string;
  /** Ways to order or book, only those the restaurant switched on. */
  order: FooterLink[];
  socials: FooterSocial[];
  feedbackHref: string | null;
  year: number;
};

/**
 * Everything the storefront footer shows, straight from the restaurant's settings: address,
 * phone, opening hours, the ordering methods that are on, and its own links. Nothing is
 * invented; a field the restaurant did not fill in is simply left out.
 */
export async function loadStorefrontFooter({
  org,
  location,
  branding,
  lang,
  m,
  query,
  menuHref,
}: {
  org: { id: string; slug: string; name: string };
  location: RestaurantLocation;
  branding: { logoUrl: string | null; tagline: string | null } | null;
  lang: LanguageCode;
  m: Messages;
  /** Query string kept on links (location, preview, language), e.g. "?l=porto". */
  query: string;
  menuHref: string;
}): Promise<FooterData> {
  const [modules, review] = await Promise.all([orgModules(org.id), db.reviewSettings.findUnique({ where: { locationId: location.id }, select: { googleReviewUrl: true } })]);
  const base = `/r/${org.slug}`;
  const hours = (location.openingHours as OpeningHours | null) ?? null;
  const zp = zonedParts(new Date(), location.timeZone);
  const openNow = hours && Object.keys(hours).length > 0 ? isOpenAt(hours, zp.weekday, zp.hour * 60 + zp.minute) : null;
  const street = [location.addressLine1, [location.postalCode, location.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
  const wa = location.whatsappOrderingEnabled && location.whatsappNumber ? location.whatsappNumber.replace(/\D/g, '') : null;

  const order: FooterLink[] = [];
  if (location.takeawayEnabled && modules.has('takeaway')) order.push({ label: m.ordering.pickupTitle, href: `${base}/order/pickup${query}`, icon: 'bag' });
  if (location.deliveryEnabled && modules.has('delivery')) order.push({ label: m.ordering.deliveryTitle, href: `${base}/order/delivery${query}`, icon: 'truck' });
  if (location.reservationsEnabled && modules.has('reservations')) order.push({ label: m.customer.reserveTable, href: `${base}/reserve${query}`, icon: 'calendar' });
  if (wa) order.push({ label: m.customer.orderViaWhatsApp, href: `${base}/order/whatsapp${query}`, icon: 'chat' });
  // Other platforms: links out, kept apart from the restaurant's own ordering.
  if (location.glovoUrl) order.push({ label: m.customer.orderOnGlovo, href: location.glovoUrl, icon: 'external', external: true });
  if (location.uberEatsUrl) order.push({ label: m.customer.orderOnUberEats, href: location.uberEatsUrl, icon: 'external', external: true });

  const socials = (
    [
      location.instagramUrl && { kind: 'instagram', label: 'Instagram', href: location.instagramUrl },
      location.facebookUrl && { kind: 'facebook', label: 'Facebook', href: location.facebookUrl },
      location.tiktokUrl && { kind: 'tiktok', label: 'TikTok', href: location.tiktokUrl },
      review?.googleReviewUrl && { kind: 'google', label: 'Google', href: review.googleReviewUrl },
      location.websiteUrl && { kind: 'website', label: 'Website', href: location.websiteUrl },
    ] as (FooterSocial | null | undefined | '')[]
  ).filter(Boolean) as FooterSocial[];

  return {
    name: org.name,
    logoUrl: branding?.logoUrl ?? null,
    tagline: branding?.tagline ?? null,
    address: street,
    mapsHref: location.addressLine1 ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([org.name, location.addressLine1, location.postalCode, location.city].filter(Boolean).join(', '))}` : null,
    phone: location.phone,
    hours,
    timeZone: location.timeZone,
    tag: LANGUAGE_TAG[lang],
    openNow,
    menuHref,
    order,
    socials,
    feedbackHref: modules.has('feedback') ? `${base}/feedback?l=${encodeURIComponent(location.slug)}` : null,
    year: zp.year,
  };
}
