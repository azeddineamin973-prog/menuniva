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
 * Delivery-zone matching. Patterns configured by the restaurant:
 * - exact code: "4700-123" / "28013"
 * - prefix with wildcard: "4700-*", "4700*", "280*"
 */
export function postalCodeMatches(country: CountryCode, code: string, pattern: string): boolean {
  const c = normalizePostalCode(country, code);
  const p = pattern.trim().replace(/\s+/g, '');
  if (!p) return false;
  if (p.endsWith('*')) return c.startsWith(p.slice(0, -1));
  return c === normalizePostalCode(country, p);
}
