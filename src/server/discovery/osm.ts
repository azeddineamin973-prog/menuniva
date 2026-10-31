import 'server-only';
import type { CountryCode } from '@/generated/prisma/enums';
import { isValidPostalCode, normalizePostalCode } from '@/lib/postal';
import { safeFetch } from '../import/safe-fetch';
import { parseHoursSpec } from './hours';
import { cleanPhone } from './website';
import type { RawProfile } from './types';

/**
 * OpenStreetMap, through its public Nominatim service.
 *
 * This is the one source that can find a restaurant from nothing but a name and a city, and it
 * turns coordinates from a Google Maps link into a real street address. The data is open
 * (ODbL) and the API is documented for exactly this kind of lookup.
 *
 * Nominatim's usage policy asks for an application that identifies itself, at most one request
 * per second, and no bulk use. All three are honoured: requests carry MenuNiva's own
 * User-Agent, calls are serialised through a shared one-second gate, and discovery is only ever
 * triggered by an owner pressing a button (rate-limited per restaurant in `service.ts`).
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const HOSTS = /(^|\.)openstreetmap\.org$/;
const UA = 'MenuNiva-Setup/1.0 (+https://menuniva.com/setup-bot; restaurant onboarding on request of the owner)';
const MIN_INTERVAL_MS = 1100;

let lastCall = 0;
/** Serialises calls so two owners discovering at once still respect one request per second. */
let gate: Promise<void> = Promise.resolve();
function throttle<T>(run: () => Promise<T>): Promise<T> {
  const result = gate.then(async () => {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return run();
  });
  // The gate must keep flowing even when a call fails.
  gate = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export type OsmFetcher = (url: string) => Promise<unknown>;

const defaultFetch: OsmFetcher = (url) =>
  throttle(async () => {
    const res = await safeFetch(url, { allowedHosts: HOSTS, userAgent: UA, accept: 'application/json', maxBytes: 512 * 1024, timeoutMs: 12_000 });
    if (res.status !== 200) throw new Error(`Nominatim answered ${res.status}`);
    return JSON.parse(res.body.toString('utf8')) as unknown;
  });

type NominatimPlace = {
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  category?: string;
  class?: string;
  address?: Record<string, string | undefined>;
  extratags?: Record<string, string | undefined> | null;
};

/** OSM tags that hold the things MenuNiva stores, including the `contact:` prefixed variants. */
function fromTags(tags: Record<string, string | undefined> | null | undefined, country: CountryCode): RawProfile {
  const out: RawProfile = {};
  if (!tags) return out;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = tags[k]?.trim();
      if (v) return v;
    }
    return undefined;
  };
  const phone = cleanPhone(pick('phone', 'contact:phone', 'telephone'));
  if (phone) out.phone = phone;
  const whatsapp = cleanPhone(pick('contact:whatsapp', 'whatsapp'));
  if (whatsapp) out.whatsappNumber = whatsapp;
  const email = pick('email', 'contact:email');
  if (email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) out.email = email.slice(0, 254);
  const site = pick('website', 'contact:website', 'url');
  if (site) {
    const https = site.startsWith('http://') ? `https://${site.slice(7)}` : site;
    if (https.startsWith('https://') && https.length <= 500) out.websiteUrl = https;
  }
  const hours = pick('opening_hours');
  if (hours) {
    const parsed = parseHoursSpec(hours);
    if (parsed) out.openingHours = parsed;
  }
  const cuisine = pick('cuisine');
  if (cuisine) out.cuisine = cuisine.replace(/[;_]/g, ', ').slice(0, 60);
  const social = [
    ['instagramUrl', /(^|\.)instagram\.com$/, pick('contact:instagram', 'instagram')],
    ['facebookUrl', /(^|\.)(facebook\.com|fb\.com)$/, pick('contact:facebook', 'facebook')],
    ['tiktokUrl', /(^|\.)tiktok\.com$/, pick('contact:tiktok', 'tiktok')],
  ] as const;
  for (const [key, host, raw] of social) {
    if (!raw) continue;
    // Tags hold either a full URL or a bare handle.
    const candidate = /^https?:\/\//i.test(raw) ? raw.replace(/^http:\/\//i, 'https://') : `https://www.${key === 'instagramUrl' ? 'instagram.com' : key === 'facebookUrl' ? 'facebook.com' : 'tiktok.com'}/${raw.replace(/^@/, '')}`;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && host.test(url.hostname) && candidate.length <= 500) out[key] = url.toString();
    } catch {
      // skip an unusable tag
    }
  }
  // A postcode may sit in the tags rather than the parsed address.
  const code = pick('addr:postcode', 'postal_code');
  if (code && isValidPostalCode(country, code)) out.postalCode = normalizePostalCode(country, code);
  const street = pick('addr:street');
  const houseNumber = pick('addr:housenumber');
  if (street) out.addressLine1 = [street, houseNumber].filter(Boolean).join(' ').slice(0, 200);
  const city = pick('addr:city');
  if (city) out.city = city.slice(0, 80);
  return out;
}

/**
 * `addressOnly` is used for reverse geocoding. A reverse lookup returns whatever element is
 * nearest the point, which is often the shop next door — verified against a real Google Maps
 * link, where the pin resolved to a neighbouring confectioner. Its name, phone, hours and
 * social links would therefore belong to another business, so only the address is taken.
 */
function fromPlace(place: NominatimPlace, country: CountryCode, addressOnly = false): RawProfile {
  const out: RawProfile = addressOnly ? {} : { ...fromTags(place.extratags ?? null, country) };
  const a = place.address ?? {};
  if (!addressOnly && place.name?.trim()) out.name = place.name.trim().slice(0, 100);
  const street = a.road ?? a.pedestrian ?? a.footway;
  if (street && !out.addressLine1) out.addressLine1 = [street, a.house_number].filter(Boolean).join(' ').slice(0, 200);
  if (a.postcode && isValidPostalCode(country, a.postcode)) out.postalCode = normalizePostalCode(country, a.postcode);
  const city = a.city ?? a.town ?? a.village ?? a.municipality;
  if (city) out.city = city.slice(0, 80);
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    out.latitude = lat;
    out.longitude = lon;
  }
  return out;
}

const COUNTRY_TLD: Record<CountryCode, string> = { PT: 'pt', ES: 'es' };

/** Finds a restaurant by name and city. Returns nothing when OSM has no confident match. */
export async function searchOsm(name: string, city: string | undefined, country: CountryCode, fetcher: OsmFetcher = defaultFetch): Promise<RawProfile | null> {
  const query = [name, city].filter(Boolean).join(', ');
  const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', extratags: '1', limit: '5', countrycodes: COUNTRY_TLD[country] });
  const data = (await fetcher(`${NOMINATIM}/search?${params}`)) as NominatimPlace[] | null;
  if (!Array.isArray(data) || !data.length) return null;
  const wanted = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Prefer an eating-and-drinking place whose name really matches what was typed.
  const scored = data
    .map((p) => {
      const n = (p.name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isVenue = /restaurant|cafe|fast_food|bar|pub|bakery|food/.test(`${p.type ?? ''} ${p.class ?? ''} ${p.category ?? ''}`);
      const nameMatch = n === wanted ? 2 : n.includes(wanted) || wanted.includes(n) ? 1 : 0;
      return { p, score: (isVenue ? 2 : 0) + nameMatch };
    })
    .sort((a, b) => b.score - a.score);
  // A result that matches neither the name nor the kind of place is somebody else's address.
  if (scored[0].score < 2) return null;
  return fromPlace(scored[0].p, country);
}

/** Turns coordinates (e.g. from a Google Maps link) into a structured address. */
export async function reverseOsm(latitude: number, longitude: number, country: CountryCode, fetcher: OsmFetcher = defaultFetch): Promise<RawProfile | null> {
  const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: 'jsonv2', addressdetails: '1', extratags: '1', zoom: '18' });
  const data = (await fetcher(`${NOMINATIM}/reverse?${params}`)) as NominatimPlace | { error?: unknown } | null;
  if (!data || typeof data !== 'object' || 'error' in data) return null;
  const place = data as NominatimPlace;
  const out = fromPlace(place, country, true);
  // Keep the link's own coordinates: they point at the restaurant, the match may be the building.
  out.latitude = latitude;
  out.longitude = longitude;
  return Object.keys(out).length > 2 ? out : null;
}
