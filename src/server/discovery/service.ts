import 'server-only';
import { z } from 'zod';
import type { CountryCode } from '@/generated/prisma/enums';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { safeFetch, UnsafeUrlError } from '../import/safe-fetch';
import { rateLimit } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { googleReviewUrlSchema, locationDetailsUpdate, locationLinksSchema } from '../services/settings';
import { discoverFromMapsLink, discoverFromPlaces, hasPlacesKey } from './google';
import { reverseOsm, searchOsm } from './osm';
import type { DiscoveryResult, DiscoverySource, Found, ProfileKey, RawProfile, RestaurantProfile, SourceReport } from './types';
import { parseWebsite } from './website';

/**
 * Magic Restaurant Setup — one-step discovery.
 *
 * The owner gives whatever they have (a Google Maps link, a name and city, their website) and
 * MenuNiva assembles one profile from every source that can contribute. Nothing is saved here:
 * discovery only proposes, the owner reviews, and the existing settings services do the writing.
 *
 * Rules that keep the result trustworthy:
 * - every field records which source it came from, and keeps the other sources' values as
 *   alternatives, so a disagreement is visible instead of silently resolved;
 * - the restaurant's own website outranks third-party data about them;
 * - a source that fails or finds nothing is reported as such, never hidden;
 * - nothing is inferred. An unreadable address stays empty for the owner to type.
 */

/** Highest first. The owner's own website is the most authoritative thing we can read. */
const PRECEDENCE: DiscoverySource[] = ['input', 'website', 'google_places', 'osm', 'maps_link'];

export const discoverSchema = z
  .object({
    locationId: z.string().min(1),
    mapsUrl: z.string().trim().max(500).optional(),
    websiteUrl: z.string().trim().max(500).optional(),
    name: z.string().trim().max(100).optional(),
    city: z.string().trim().max(80).optional(),
  })
  .refine((d) => d.mapsUrl || d.websiteUrl || d.name, { message: 'Enter a Google Maps link, your website, or your restaurant name.' });

const MAX_PAGE_BYTES = 3 * 1024 * 1024;

/** Adds `https://` when the owner typed a bare domain, which most people do. */
function normalizeSiteInput(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed.replace(/^http:\/\//i, 'https://') : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    // A hostname with no dot is a typo, not a website.
    return url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchWebsite(url: string, country: CountryCode): Promise<{ profile: RawProfile; detail: string } | { error: string }> {
  let res;
  try {
    res = await safeFetch(url, {
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: 15_000,
      accept: 'text/html,application/xhtml+xml',
      userAgent: 'MenuNiva-Setup/1.0 (+https://menuniva.com/setup-bot; restaurant onboarding on request of the owner)',
    });
  } catch (e) {
    return { error: e instanceof UnsafeUrlError ? e.message : 'The website could not be reached.' };
  }
  if (res.status === 404) return { error: 'That page does not exist on your website.' };
  if (res.status !== 200) return { error: `Your website answered with status ${res.status}.` };
  if (!/text\/html|xhtml/i.test(res.contentType)) return { error: 'That link is not a web page.' };
  const profile = parseWebsite(res.body.toString('utf8'), res.finalUrl, country);
  return { profile, detail: `Read ${res.finalUrl}` };
}

type Contribution = { source: DiscoverySource; profile: RawProfile };

/** Combines sources into one attributed profile, keeping disagreements as alternatives. */
export function mergeProfiles(contributions: Contribution[]): RestaurantProfile {
  const byRank = [...contributions].sort((a, b) => PRECEDENCE.indexOf(a.source) - PRECEDENCE.indexOf(b.source));
  const profile: RestaurantProfile = {};
  const keys = new Set<ProfileKey>(byRank.flatMap((c) => Object.keys(c.profile) as ProfileKey[]));
  for (const key of keys) {
    const values = byRank.flatMap((c) => {
      const v = (c.profile as Record<string, unknown>)[key];
      return v === undefined || v === null || v === '' ? [] : [{ value: v, source: c.source }];
    });
    if (!values.length) continue;
    const [best, ...rest] = values;
    // Only a genuinely different value is worth showing as an alternative.
    const differing = rest.filter((r) => JSON.stringify(r.value) !== JSON.stringify(best.value));
    const found = {
      value: best.value,
      source: best.source,
      confidence: best.source === 'osm' || best.source === 'maps_link' ? 'medium' : 'high',
      ...(differing.length ? { alternatives: differing.map((d) => ({ value: d.value, source: d.source })) } : {}),
    };
    (profile as Record<string, unknown>)[key] = found as Found<unknown>;
  }
  return profile;
}

const contributed = (p: RawProfile): ProfileKey[] => Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined) as ProfileKey[];

/**
 * Runs discovery for one restaurant. Never throws for a source that fails: each one reports its
 * own outcome so the owner can see what worked.
 */
export async function discoverRestaurant(ctx: TenantContext, input: unknown): Promise<DiscoveryResult> {
  const d = discoverSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const location = await db.restaurantLocation.findUniqueOrThrow({ where: { id: d.locationId }, select: { country: true, name: true, city: true } });
  const country = location.country;
  // Discovery reaches out to other people's servers; it stays an occasional, deliberate action.
  await rateLimit(`discovery:${ctx.org.id}`, 20, 3600);

  const contributions: Contribution[] = [];
  const reports: SourceReport[] = [];
  const name = d.name?.trim() || undefined;
  const city = d.city?.trim() || undefined;
  if (name || city) {
    const typed: RawProfile = { ...(name ? { name } : {}), ...(city ? { city } : {}) };
    contributions.push({ source: 'input', profile: typed });
  }

  // ---- Google Maps link: read the URL, never the disallowed /maps/ page --------------------
  let coordinates: { latitude: number; longitude: number } | null = null;
  if (d.mapsUrl) {
    try {
      const link = await discoverFromMapsLink(d.mapsUrl);
      if (!link) {
        reports.push({ source: 'maps_link', status: 'nothing_found', detail: 'That is not a Google Maps link. Open your restaurant in Google Maps and use Share → Copy link.', fields: [] });
      } else {
        contributions.push({ source: 'maps_link', profile: link.profile });
        if (link.profile.latitude !== undefined && link.profile.longitude !== undefined) coordinates = { latitude: link.profile.latitude, longitude: link.profile.longitude };
        reports.push({
          source: 'maps_link',
          status: 'ok',
          detail: coordinates ? 'Read the place name and location from the link.' : 'Read the place name from the link; it carries no coordinates.',
          fields: contributed(link.profile),
        });
      }
    } catch (e) {
      reports.push({ source: 'maps_link', status: 'failed', detail: e instanceof UnsafeUrlError ? e.message : 'The Google Maps link could not be opened.', fields: [] });
    }
  }

  // ---- The restaurant's own website -------------------------------------------------------
  const siteInput = d.websiteUrl ? normalizeSiteInput(d.websiteUrl) : null;
  if (d.websiteUrl && !siteInput) {
    reports.push({ source: 'website', status: 'failed', detail: 'That website address is not valid. It should look like casademarrocos.com.', fields: [] });
  } else if (siteInput) {
    const result = await fetchWebsite(siteInput, country);
    if ('error' in result) reports.push({ source: 'website', status: 'failed', detail: result.error, fields: [] });
    else {
      contributions.push({ source: 'website', profile: result.profile });
      const fields = contributed(result.profile);
      reports.push({ source: 'website', status: fields.length > 1 ? 'ok' : 'nothing_found', detail: fields.length > 1 ? result.detail : 'Your website loaded, but no contact details could be read from it.', fields });
    }
  }

  // ---- Google Places, only with a configured key ------------------------------------------
  const placesQuery = [name ?? location.name, city ?? location.city].filter(Boolean).join(', ');
  if (!hasPlacesKey()) {
    reports.push({ source: 'google_places', status: 'not_configured', detail: 'Google Places is not connected (no API key), so Google’s own hours and phone were not used.', fields: [] });
  } else if (placesQuery) {
    const places = await discoverFromPlaces(placesQuery, country);
    if (places) {
      contributions.push({ source: 'google_places', profile: places });
      reports.push({ source: 'google_places', status: 'ok', detail: `Matched “${placesQuery}” on Google Places.`, fields: contributed(places) });
    } else reports.push({ source: 'google_places', status: 'nothing_found', detail: `Google Places had no restaurant matching “${placesQuery}”.`, fields: [] });
  }

  // ---- OpenStreetMap: by coordinates when we have them, otherwise by name ------------------
  try {
    const osm = coordinates ? await reverseOsm(coordinates.latitude, coordinates.longitude, country) : name ? await searchOsm(name, city ?? location.city ?? undefined, country) : null;
    if (osm) {
      contributions.push({ source: 'osm', profile: osm });
      reports.push({ source: 'osm', status: 'ok', detail: coordinates ? 'Found the street address for that location.' : `Found “${name}” in OpenStreetMap.`, fields: contributed(osm) });
    } else if (coordinates || name) {
      reports.push({ source: 'osm', status: 'nothing_found', detail: 'OpenStreetMap has no matching restaurant, so the address was not filled in from there.', fields: [] });
    }
  } catch (e) {
    reports.push({ source: 'osm', status: 'failed', detail: e instanceof Error && /\b429\b/.test(e.message) ? 'OpenStreetMap is busy. Wait a minute and try again.' : 'OpenStreetMap could not be reached.', fields: [] });
  }

  const profile = mergeProfiles(contributions);
  await audit({
    organizationId: ctx.org.id,
    actorUserId: ctx.userId,
    action: 'setup.discovery_run',
    entityType: 'RestaurantLocation',
    entityId: d.locationId,
    metadata: { sources: reports.map((r) => `${r.source}:${r.status}`), fields: Object.keys(profile).length },
  });
  if (!Object.keys(profile).length) {
    throw new UserFacingError(
      reports.some((r) => r.status === 'failed')
        ? (reports.find((r) => r.status === 'failed')!.detail)
        : 'Nothing could be found from what you entered. Try your website address, or fill the details in by hand below.',
    );
  }
  return { profile, reports };
}

const trimmedOrNull = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

/**
 * What the owner confirmed on the review screen. The discovered profile is never written
 * directly: these are the values shown in the form, so a field the owner cleared or corrected
 * is what gets saved.
 */
export const applyDiscoverySchema = z.object({
  locationId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  addressLine1: trimmedOrNull(200),
  postalCode: trimmedOrNull(12),
  city: trimmedOrNull(80),
  phone: trimmedOrNull(20),
  whatsappNumber: trimmedOrNull(20),
  email: trimmedOrNull(254),
  openingHours: z.string().max(4000).optional(),
  websiteUrl: trimmedOrNull(500),
  instagramUrl: trimmedOrNull(500),
  facebookUrl: trimmedOrNull(500),
  tiktokUrl: trimmedOrNull(500),
  glovoUrl: trimmedOrNull(500),
  uberEatsUrl: trimmedOrNull(500),
  googleReviewUrl: trimmedOrNull(500),
});

/**
 * Saves a reviewed profile in one step, replacing the first two wizard steps.
 *
 * Reuses the existing settings services so every rule still applies: postal codes are validated
 * for the country, links must be https and on the right host, and opening hours go through the
 * app's own schema. Ordering channels are deliberately left alone — turning on takeaway or
 * delivery stays the owner's explicit decision.
 */
export async function applyDiscoveredProfile(ctx: TenantContext, input: unknown) {
  const d = applyDiscoverySchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const location = await db.restaurantLocation.findUniqueOrThrow({ where: { id: d.locationId }, select: { id: true, timeZone: true, country: true } });

  // Everything is validated before anything is written, so one bad link cannot leave the address
  // saved and the links not. Links reuse the Channels page's host rules; channel switches are
  // deliberately untouched.
  const details = locationDetailsUpdate(location.country, {
    locationId: d.locationId,
    name: d.name,
    addressLine1: d.addressLine1,
    addressLine2: null,
    postalCode: d.postalCode,
    city: d.city,
    phone: d.phone,
    whatsappNumber: d.whatsappNumber,
    email: d.email,
    timeZone: location.timeZone,
    openingHours: d.openingHours ?? null,
  });
  const links = locationLinksSchema.parse(d);
  const googleReviewUrl = googleReviewUrlSchema.parse(d.googleReviewUrl) ?? null;

  await db.$transaction(async (tx) => {
    await tx.restaurantLocation.update({
      where: { id: location.id },
      data: {
        ...details.data,
        glovoUrl: links.glovoUrl ?? null,
        uberEatsUrl: links.uberEatsUrl ?? null,
        websiteUrl: links.websiteUrl ?? null,
        instagramUrl: links.instagramUrl ?? null,
        facebookUrl: links.facebookUrl ?? null,
        tiktokUrl: links.tiktokUrl ?? null,
      },
    });
    await tx.reviewSettings.upsert({ where: { locationId: location.id }, update: { googleReviewUrl }, create: { locationId: location.id, googleReviewUrl } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'setup.discovery_applied', entityType: 'RestaurantLocation', entityId: location.id }, tx);
  });
  return { locationId: location.id };
}
