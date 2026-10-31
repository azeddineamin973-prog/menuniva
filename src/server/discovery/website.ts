import type { CountryCode } from '@/generated/prisma/enums';
import { isValidPostalCode, normalizePostalCode } from '@/lib/postal';
import { daysCovered, parseHoursFromText, parseHoursSpec, parseHoursSpecification } from './hours';
import type { RawProfile } from './types';

/**
 * Reads a restaurant's own website. This is the richest and least ambiguous source: the owner
 * controls the page, so what it says about their address, phone and hours is authoritative.
 *
 * Three passes, best first:
 * 1. schema.org JSON-LD (`Restaurant`/`LocalBusiness`) — explicitly structured by the site;
 * 2. link and meta data — `tel:`, `mailto:`, social profiles, delivery platforms, description;
 * 3. the visible text — address and a day-by-day hours list.
 *
 * Pure string work: no network access, so it is fully unit-testable. Fetching is the caller's job.
 */

/** Social and ordering profiles MenuNiva can store, with the host each one must be on. */
const LINK_TARGETS = [
  { key: 'instagramUrl', host: /(^|\.)instagram\.com$/ },
  { key: 'facebookUrl', host: /(^|\.)(facebook\.com|fb\.com)$/ },
  { key: 'tiktokUrl', host: /(^|\.)tiktok\.com$/ },
  { key: 'glovoUrl', host: /(^|\.)glovoapp\.com$/ },
  { key: 'uberEatsUrl', host: /(^|\.)ubereats\.com$/ },
  { key: 'googleReviewUrl', host: /(^|\.)(g\.page|maps\.app\.goo\.gl)$/ },
] as const;

/** Paths that are the platform's own pages rather than this restaurant's profile. */
const NOT_A_PROFILE = /^\/?(tr|sharer|share|plugins|login|signup|policies|legal|about|help|privacy|terms|p\/|pages\/?$)/i;

const strip = (html: string) => html.replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

/** Visible text with cell boundaries kept, so "Monday | 11:00" survives tag removal. */
function visibleText(html: string): string {
  return strip(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/td|\/th|\/tr|\/h[1-6]|\/span|\/a)\s*[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .trim();
}

/** Every JSON-LD object on the page, flattened through @graph and nested arrays. */
function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (v: unknown, depth = 0) => {
    if (depth > 6 || out.length > 200) return;
    if (Array.isArray(v)) return v.forEach((x) => push(x, depth + 1));
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    out.push(o);
    if (o['@graph']) push(o['@graph'], depth + 1);
    for (const key of ['address', 'location', 'subOrganization', 'hasPart', 'itemListElement', 'item']) if (o[key]) push(o[key], depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      push(JSON.parse(m[1].trim().replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')));
    } catch {
      // A site with broken JSON-LD still gets the text passes below.
    }
  }
  return out;
}

const typeOf = (o: Record<string, unknown>): string => {
  const t = o['@type'];
  return (Array.isArray(t) ? t.join(' ') : typeof t === 'string' ? t : '').toLowerCase();
};
const PLACE_TYPE = /restaurant|localbusiness|foodestablishment|cafe|bar|bakery|organization|place|hotel/;

function text(v: unknown, max = 200): string | undefined {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

/** A phone number in the shape the settings form accepts (`+?[0-9 ()-]{6,20}`). */
export function cleanPhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(/[,;/]|\bor\b/i)[0] ?? raw;
  const plus = /^\s*\+/.test(first) || first.includes('00351');
  const digits = first.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 6 || digits.length > 15) return undefined;
  // Keep the international form when the page gave one; it is unambiguous for guests.
  return plus ? `+${digits}` : digits;
}

/**
 * A stored-ready https URL, or nothing. `dropQuery` is used for profile and store links, whose
 * query strings are only tracking and session state — and long enough (Uber Eats) to push an
 * otherwise valid link past the 500-character column limit.
 */
function cleanUrl(raw: string | undefined, hostPattern?: RegExp, dropQuery = false): string | undefined {
  if (!raw) return undefined;
  let candidate = raw.trim();
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  if (/^http:\/\//i.test(candidate)) candidate = `https://${candidate.slice(7)}`;
  if (!/^https:\/\//i.test(candidate)) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (hostPattern && !hostPattern.test(url.hostname)) return undefined;
  if (dropQuery) url.search = '';
  // Tracking parameters are noise in a stored profile link.
  else for (const p of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(p)) url.searchParams.delete(p);
  url.hash = '';
  const clean = url.toString().replace(/\?$/, '');
  return clean.length <= 500 ? clean : undefined;
}

/** Postal code and city, read together so a code is only kept when it is valid for the country. */
function readPostalAndCity(blob: string, country: CountryCode): { postalCode?: string; city?: string } {
  const pattern = country === 'PT' ? /\b([1-9]\d{3})\s*-?\s*(\d{3})\b(?:\s*,?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'. -]{1,40}?))?(?=\s*(?:,|\||$|\.|Portugal))/ : /\b((?:0[1-9]|[1-4]\d|5[0-2])\d{3})\b(?:\s*,?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'. -]{1,40}?))?(?=\s*(?:,|\||$|\.|Spain|España))/;
  const m = pattern.exec(blob);
  if (!m) return {};
  const code = country === 'PT' ? `${m[1]}-${m[2]}` : m[1];
  if (!isValidPostalCode(country, code)) return {};
  const cityRaw = (country === 'PT' ? m[3] : m[2])?.trim();
  const city = cityRaw && !/^(portugal|spain|espana|españa)$/i.test(cityRaw) ? cityRaw.replace(/[,.]$/, '') : undefined;
  return { postalCode: normalizePostalCode(country, code), city: city && city.length >= 2 ? city : undefined };
}

/** A street line: starts with a street word or a house number, and is not a sentence. */
function readStreet(blob: string): string | undefined {
  const streetWord = String.raw`(?:R\.|Rua|Avenida|Av\.|Travessa|Tv\.|Largo|Praça|Praca|Estrada|Calle|C\/|Carrer|Rue|Street|St\.|Road|Rd\.|Lane|Alameda|Urbanização|Urbanizacao)`;
  const re = new RegExp(String.raw`(${streetWord}\s+[A-Za-zÀ-ÿ0-9'ºª.,\- ]{3,90}?)(?=\s*(?:\||,\s*\d{4}|\d{4}-\d{3}|$|\.\s))`, 'i');
  const m = re.exec(blob);
  const value = m?.[1]?.replace(/[,;|]\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!value || value.length < 6 || value.length > 200) return undefined;
  // Reject prose that merely mentions a street word.
  if (/\b(we|our|the|is|are|and|located|welcome|venha|estamos)\b/i.test(value) && value.split(' ').length > 10) return undefined;
  return value;
}

/** Reads one restaurant website. `country` decides which postal-code format is valid. */
export function parseWebsite(html: string, pageUrl: string, country: CountryCode): RawProfile {
  const found: RawProfile = {};
  const page = cleanUrl(pageUrl);
  if (page) found.websiteUrl = page;

  // ---- 1. schema.org JSON-LD -------------------------------------------------------------
  const objects = jsonLdObjects(html);
  const place = objects.find((o) => PLACE_TYPE.test(typeOf(o)) && (o.name || o.address || o.telephone));
  if (place) {
    found.name = text(place.name, 100) ?? found.name;
    found.phone = cleanPhone(text(place.telephone, 60)) ?? found.phone;
    found.email = text(place.email, 254)?.replace(/^mailto:/i, '') ?? found.email;
    found.description = text(place.description, 300) ?? found.description;
    const cuisine = place.servesCuisine;
    found.cuisine = text(Array.isArray(cuisine) ? cuisine[0] : cuisine, 60) ?? found.cuisine;

    const addr = place.address && typeof place.address === 'object' ? (place.address as Record<string, unknown>) : null;
    if (addr) {
      found.addressLine1 = text(addr.streetAddress, 200) ?? found.addressLine1;
      const code = text(addr.postalCode, 12);
      if (code && isValidPostalCode(country, code)) found.postalCode = normalizePostalCode(country, code);
      found.city = text(addr.addressLocality, 80) ?? found.city;
    }
    const geo = place.geo && typeof place.geo === 'object' ? (place.geo as Record<string, unknown>) : null;
    const lat = Number(geo?.latitude);
    const lon = Number(geo?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      found.latitude = lat;
      found.longitude = lon;
    }
    const hours = place.openingHoursSpecification ? parseHoursSpecification(place.openingHoursSpecification) : null;
    const hoursText = !hours && (typeof place.openingHours === 'string' || Array.isArray(place.openingHours)) ? parseHoursSpec(place.openingHours as string | string[]) : null;
    if (hours ?? hoursText) found.openingHours = (hours ?? hoursText)!;

    const sameAs = (Array.isArray(place.sameAs) ? place.sameAs : [place.sameAs]).filter((x): x is string => typeof x === 'string');
    for (const raw of sameAs) {
      for (const t of LINK_TARGETS) {
        const url = cleanUrl(raw, t.host, true);
        if (url && !found[t.key]) found[t.key] = url;
      }
    }
  }

  // ---- 2. links and meta -----------------------------------------------------------------
  const hrefs = [...html.matchAll(/(?:href|content)=["']([^"'\s]{4,2000})["']/gi)].map((m) => m[1]);
  for (const t of LINK_TARGETS) {
    if (found[t.key]) continue;
    for (const raw of hrefs) {
      const url = cleanUrl(raw, t.host, true);
      if (!url) continue;
      if (NOT_A_PROFILE.test(new URL(url).pathname)) continue;
      found[t.key] = url;
      break;
    }
  }
  if (!found.phone) {
    for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
      const p = cleanPhone(decodeURIComponent(m[1]));
      if (p) {
        found.phone = p;
        break;
      }
    }
  }
  // A wa.me / WhatsApp link is a number guests can message, which is not always the main phone.
  // These links always carry the full international number, so the result is written with "+".
  for (const m of html.matchAll(/https?:\/\/(?:api\.whatsapp\.com\/send\?phone=|wa\.me\/)(\+?\d[\d ()-]{5,19})/gi)) {
    const p = cleanPhone(`+${m[1].replace(/\D/g, '')}`);
    if (p) {
      found.whatsappNumber = p;
      break;
    }
  }
  if (!found.email) {
    for (const m of html.matchAll(/href=["']mailto:([^"'?]+)["']?/gi)) {
      const e = text(decodeURIComponent(m[1]), 254);
      if (e && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) && !/^(info|hello)@(example|domain)/i.test(e)) {
        found.email = e;
        break;
      }
    }
  }
  if (!found.description) {
    const meta = /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']{10,300})["']/i.exec(html);
    found.description = text(meta?.[1], 300) ?? found.description;
  }
  if (!found.name) {
    const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,100})["']/i.exec(html) ?? /<title[^>]*>([^<]{2,100})<\/title>/i.exec(html);
    // Titles are usually "Name — tagline"; keep the part before the separator.
    found.name = text(og?.[1]?.split(/\s*[|\u2013\u2014-]\s*/)[0], 100);
  }

  // ---- 3. visible text -------------------------------------------------------------------
  const body = visibleText(html);
  if (!found.email) {
    const m = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/.exec(body);
    if (m && !/\.(png|jpe?g|webp|svg|gif)$/i.test(m[1])) found.email = m[1].slice(0, 254);
  }
  if (!found.phone) found.phone = cleanPhone(/(\+\d[\d ()-]{7,18})/.exec(body)?.[1]);
  if (!found.postalCode || !found.city) {
    const pc = readPostalAndCity(body, country);
    found.postalCode = found.postalCode ?? pc.postalCode;
    found.city = found.city ?? pc.city;
  }
  if (!found.addressLine1) found.addressLine1 = readStreet(body);
  // Only trust page text for hours when JSON-LD gave nothing, or gave less of the week.
  if (daysCovered(found.openingHours) < 7) {
    const fromText = parseHoursFromText(body);
    if (fromText && daysCovered(fromText) > daysCovered(found.openingHours)) found.openingHours = fromText;
  }
  return found;
}
