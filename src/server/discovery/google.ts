import 'server-only';
import { isValidPostalCode, normalizePostalCode } from '@/lib/postal';
import type { CountryCode } from '@/generated/prisma/enums';
import { env } from '../env';
import { safeFetch, validatePublicUrl } from '../import/safe-fetch';
import { cleanPhone } from './website';
import { parseHoursSpec } from './hours';
import type { RawProfile } from './types';

/**
 * Google Maps and Google Places.
 *
 * Google's robots.txt disallows `/maps/` (checked 2026-10-31; only a short allow-list such as
 * `/maps/search/` and `/maps/@` is permitted), so MenuNiva never downloads a Maps place page.
 * Two things are done instead, and both are allowed:
 *
 * 1. The pasted link is read as a *string*. A Maps place URL already contains the place name and
 *    the pin's coordinates, so no request is needed at all. A `maps.app.goo.gl` short link is
 *    resolved by reading the `Location` header of its redirect (that host is a link shortener
 *    with no robots.txt of its own) — the page it points at is never requested.
 * 2. The coordinates are then looked up in OpenStreetMap (see `osm.ts`) for a structured address.
 *
 * Google's own address, phone and hours are available through the official **Places API**, which
 * is used only when the operator configures `GOOGLE_PLACES_API_KEY`. Without a key this reports
 * `not_configured` rather than pretending Google data is unavailable.
 */

const MAPS_HOSTS = /^(www\.|maps\.)?google\.[a-z.]{2,6}$|^maps\.app\.goo\.gl$|^goo\.gl$|^g\.co$|^g\.page$/;

export type MapsLink = {
  /** Place name taken from the URL path, when present. */
  name?: string;
  latitude?: number;
  longitude?: number;
  /** Google's own identifier for the place, when the link carries one. */
  placeId?: string;
  /** The normalised link, suitable for storing as the Google review link. */
  url: string;
};

const isLat = (n: number) => Number.isFinite(n) && Math.abs(n) <= 90;
const isLon = (n: number) => Number.isFinite(n) && Math.abs(n) <= 180;

/**
 * Reads what a Google Maps URL states directly. No network access.
 *
 * Coordinates: `!3d<lat>!4d<lon>` is the place pin and is preferred; `@<lat>,<lon>,<zoom>z` is
 * only the map's centre, which can sit tens of metres away, so it is a fallback.
 */
export function parseMapsUrl(raw: string): MapsLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !MAPS_HOSTS.test(url.hostname)) return null;
  const decoded = decodeURIComponent(url.pathname);
  const out: MapsLink = { url: url.toString() };

  const named = /\/maps\/place\/([^/@]+)/.exec(decoded);
  const name = named?.[1]?.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
  if (name && name.length >= 2 && name.length <= 100 && !/^[\d.,\- ]+$/.test(name)) out.name = name;

  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(url.href);
  const centre = /[@/](-?\d+\.\d+),(-?\d+\.\d+)/.exec(url.href);
  const q = url.searchParams.get('q') ?? url.searchParams.get('query') ?? '';
  const fromQuery = /^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/.exec(q.trim());
  const pair = pin ?? fromQuery ?? centre;
  if (pair) {
    const lat = Number(pair[1]);
    const lon = Number(pair[2]);
    if (isLat(lat) && isLon(lon)) {
      out.latitude = lat;
      out.longitude = lon;
    }
  }
  // A place name may also arrive as ?q=Casa+de+Marrocos+Braga on the allowed /maps/search form.
  if (!out.name && q && !fromQuery && q.length <= 100) out.name = q.replace(/\+/g, ' ').trim() || undefined;

  const placeId = url.searchParams.get('place_id') ?? /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/.exec(url.href)?.[1] ?? /!16s(%2F|\/)([\w%/.]+)/.exec(url.href)?.[0]?.slice(4);
  if (placeId) out.placeId = decodeURIComponent(placeId).slice(0, 120);
  return out;
}

const SHORT_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|g\.page)$/;
export const isShortMapsLink = (raw: string) => {
  try {
    return SHORT_HOSTS.test(new URL(raw.trim()).hostname);
  } catch {
    return false;
  }
};

/**
 * Turns a Maps short link into the full URL by reading the redirect's `Location` header. The
 * target page is never downloaded, which is what keeps this clear of Google's `/maps/` crawl rule.
 */
export async function resolveMapsShortLink(raw: string, fetchHead = headLocation): Promise<string | null> {
  const url = validatePublicUrl(raw, SHORT_HOSTS);
  for (let hop = 0; hop < 3; hop++) {
    const next = await fetchHead(url.toString());
    if (!next) return hop ? url.toString() : null;
    let target: URL;
    try {
      target = new URL(next, url);
    } catch {
      return null;
    }
    if (target.protocol !== 'https:' || !MAPS_HOSTS.test(target.hostname)) return null;
    if (!SHORT_HOSTS.test(target.hostname)) return target.toString();
    url.href = target.href;
  }
  return null;
}

/**
 * The `Location` of a redirect, without downloading any page body. The host allow-list covers
 * every Google Maps host, because the redirect target is a google.com Maps URL while the request
 * itself goes to the shortener; the caller has already restricted the input to a short link.
 */
async function headLocation(url: string): Promise<string | null> {
  const res = await safeFetch(url, {
    method: 'HEAD',
    followRedirects: false,
    allowedHosts: MAPS_HOSTS,
    maxBytes: 64 * 1024,
    timeoutMs: 12_000,
    userAgent: 'MenuNiva-Setup/1.0 (+https://menuniva.com/setup-bot; restaurant onboarding on request of the owner)',
  });
  return res.status >= 300 && res.status < 400 ? (res.location ?? null) : null;
}

/** Everything a Maps link gives on its own: name and coordinates, no address. */
export async function discoverFromMapsLink(raw: string): Promise<{ profile: RawProfile; link: MapsLink } | null> {
  const full = isShortMapsLink(raw) ? await resolveMapsShortLink(raw) : raw;
  if (!full) return null;
  const link = parseMapsUrl(full);
  if (!link) return null;
  const profile: RawProfile = {};
  if (link.name) profile.name = link.name;
  if (link.latitude !== undefined) profile.latitude = link.latitude;
  if (link.longitude !== undefined) profile.longitude = link.longitude;
  // The original short link is the nicest thing to store for "leave us a review".
  const review = isShortMapsLink(raw) ? raw.trim() : link.url;
  if (review.length <= 500) profile.googleReviewUrl = review;
  return { profile, link };
}

export const hasPlacesKey = () => !!env.GOOGLE_PLACES_API_KEY;

type PlaceResult = {
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  location?: { latitude?: number; longitude?: number };
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
};

const FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.internationalPhoneNumber',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.location',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
].join(',');

/**
 * Official Google Places API (Text Search). Only runs when a key is configured. Returns null for
 * any failure so discovery continues with the other sources.
 */
export async function discoverFromPlaces(query: string, country: CountryCode, fetchImpl: typeof fetch = fetch): Promise<RawProfile | null> {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  let body: { places?: PlaceResult[] };
  try {
    const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1, regionCode: country, includedType: 'restaurant' }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    body = (await res.json()) as { places?: PlaceResult[] };
  } catch {
    return null;
  }
  const p = body.places?.[0];
  if (!p) return null;
  const component = (type: string) => p.addressComponents?.find((c) => c.types?.includes(type))?.longText?.trim();
  const out: RawProfile = {};
  const name = p.displayName?.text?.trim();
  if (name) out.name = name.slice(0, 100);
  const street = [component('route'), component('street_number')].filter(Boolean).join(' ').trim();
  if (street) out.addressLine1 = street.slice(0, 200);
  const code = component('postal_code');
  if (code && isValidPostalCode(country, code)) out.postalCode = normalizePostalCode(country, code);
  const city = component('locality') ?? component('postal_town') ?? component('administrative_area_level_2');
  if (city) out.city = city.slice(0, 80);
  const phone = cleanPhone(p.internationalPhoneNumber ?? p.nationalPhoneNumber);
  if (phone) out.phone = phone;
  if (p.websiteUri?.startsWith('https://') && p.websiteUri.length <= 500) out.websiteUrl = p.websiteUri;
  const hours = p.regularOpeningHours?.weekdayDescriptions?.length ? parseHoursSpec(p.regularOpeningHours.weekdayDescriptions) : null;
  if (hours) out.openingHours = hours;
  if (isLat(Number(p.location?.latitude)) && isLon(Number(p.location?.longitude))) {
    out.latitude = p.location!.latitude;
    out.longitude = p.location!.longitude;
  }
  const cuisine = p.primaryTypeDisplayName?.text?.trim();
  if (cuisine) out.cuisine = cuisine.slice(0, 60);
  if (p.googleMapsUri?.startsWith('https://') && p.googleMapsUri.length <= 500) out.googleReviewUrl = p.googleMapsUri;
  return out;
}
