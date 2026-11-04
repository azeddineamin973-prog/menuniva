import type { CountryCode } from '@/generated/prisma/enums';

/** Portugal: 4 digits, hyphen, 3 digits (e.g. 4700-123). Spain: 5 digits, province 01–52. */
const PATTERNS: Record<CountryCode, RegExp> = {
  PT: /^[1-9]\d{3}-\d{3}$/,
  ES: /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/,
};

/** Normalises common input variations: spaces, missing hyphen in PT codes. */
export function normalizePostalCode(country: CountryCode, raw: string): string {
  const s = raw.trim().replace(/\s+/g, '');
  if (country === 'PT') {
    const digits = s.replace(/\D/g, '');
    if (digits.length === 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return s;
  }
  return s.replace(/\D/g, '');
}

export function isValidPostalCode(country: CountryCode, raw: string): boolean {
  return PATTERNS[country].test(normalizePostalCode(country, raw));
}

/**
 * Delivery-zone matching on the postal code only. Stored patterns:
 * - exact code: "4700-123" / "28013"
 * - postal area (prefix): "4700-*", "4700*", "47*", "280*"
 * - everywhere: "*"
 * Towns ("city:Braga") need the guest's town: see zonePatternMatches.
 */
export function postalCodeMatches(country: CountryCode, code: string, pattern: string): boolean {
  const c = normalizePostalCode(country, code);
  const p = pattern.trim().replace(/\s+/g, '');
  if (!p || p.startsWith('city:')) return false;
  if (p.endsWith('*')) return c.startsWith(p.slice(0, -1).replace(/-$/, ''));
  return c === normalizePostalCode(country, p);
}

// ------------------------------------------------------------------ delivery areas

export const EVERYWHERE = '*';
const CITY = 'city:';

/** "São Vicente" → "sao vicente": no accents, no case, punctuation as spaces. */
export function normalizeTown(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The guest typed `guestCity`; the zone names `town`. Whole words: "Braga" matches "braga, portugal", not "bragança". */
export function townMatches(guestCity: string, town: string): boolean {
  const g = normalizeTown(guestCity);
  const t = normalizeTown(town);
  return !!g && !!t && ` ${g} `.includes(` ${t} `);
}

export type ZonePatternKind = 'everywhere' | 'town' | 'area' | 'exact';
export function zonePatternKind(pattern: string): ZonePatternKind {
  if (pattern === EVERYWHERE) return 'everywhere';
  if (pattern.startsWith(CITY)) return 'town';
  return pattern.endsWith('*') ? 'area' : 'exact';
}

/**
 * Turns what the owner typed into stored patterns, leniently: "4700", "4700-", "4700-*" and
 * "4700*" are the same postal area; "4700123" is one exact code; a word ("Braga") is a town;
 * "*" (or "everywhere") is every address. Returns null for a value that cannot be understood.
 */
export function parseZoneEntry(country: CountryCode, raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, ' ');
  if (!v) return null;
  if (v === '*' || /^(everywhere|todo|todos|tudo|qualquer|todas|partout|في كل مكان)$/i.test(v)) return EVERYWHERE;
  if (/\p{L}/u.test(v)) {
    const town = v.replace(/^city:/i, '').trim();
    return normalizeTown(town).length >= 2 && town.length <= 60 ? `${CITY}${town}` : null;
  }
  const s = v.replace(/\s+/g, '').replace(/\*$/, '').replace(/-$/, '');
  if (country === 'PT') {
    const d = s.replace(/-/g, '');
    if (!/^\d+$/.test(d) || d.startsWith('0') || s.split('-').length > 2 || (s.includes('-') && s.indexOf('-') !== 4)) return null;
    if (d.length === 7) return `${d.slice(0, 4)}-${d.slice(4)}`;
    if (d.length < 4) return `${d}*`;
    if (d.length === 4) return `${d}-*`;
    if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}*`;
    return null;
  }
  if (!/^\d{1,5}$/.test(s)) return null;
  if (s.length === 5) return isValidPostalCode(country, s) ? s : null;
  return `${s}*`;
}

/** Does this zone pattern cover the guest's postal code and town? */
export function zonePatternMatches(country: CountryCode, postal: string, city: string, pattern: string): boolean {
  switch (zonePatternKind(pattern)) {
    case 'everywhere':
      return true;
    case 'town':
      return townMatches(city, pattern.slice(CITY.length));
    default:
      return postalCodeMatches(country, postal, pattern);
  }
}

/**
 * How narrow a pattern is, so the most specific zone wins whatever order zones were added in:
 * an exact code beats a 4-digit area, which beats a town, which beats a 2-digit region, which
 * beats "everywhere".
 */
export function zonePatternSpecificity(pattern: string): number {
  switch (zonePatternKind(pattern)) {
    case 'everywhere':
      return 1;
    case 'town':
      return 17; // between a 3-digit (16) and a 4-digit (18) postal area
    case 'exact':
      return 100;
    default:
      return 10 + 2 * pattern.replace(/\D/g, '').length;
  }
}

/** A stored pattern as the owner would type it again: "4700", "4700-1", "Braga", "4700-123", "*". */
export function zonePatternInput(pattern: string): string {
  switch (zonePatternKind(pattern)) {
    case 'everywhere':
      return EVERYWHERE;
    case 'town':
      return pattern.slice(CITY.length);
    case 'exact':
      return pattern;
    default:
      return pattern.slice(0, -1).replace(/-$/, '');
  }
}

/** How a stored pattern reads to the owner: "4700-xxx", "47xx-xxx", "280xx", "Braga", "Everywhere". */
export function describeZonePattern(country: CountryCode, pattern: string): string {
  switch (zonePatternKind(pattern)) {
    case 'everywhere':
      return 'Everywhere';
    case 'town':
      return pattern.slice(CITY.length);
    case 'exact':
      return pattern;
    default: {
      const d = pattern.replace(/\D/g, '');
      if (country === 'PT') {
        const full = d.padEnd(7, 'x');
        return `${full.slice(0, 4)}-${full.slice(4)}`;
      }
      return d.padEnd(5, 'x');
    }
  }
}
