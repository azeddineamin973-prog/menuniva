/**
 * Money is always an integer number of minor units (euro cents).
 * All authoritative arithmetic is integer arithmetic; formatting is display-only.
 */

export type Cents = number;

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid money amount: ${value}`);
  return value;
}

/**
 * Parses user/imported input such as "16,90", "16.90", "€ 16,90", "1.234,50", "1,234.50", "17".
 * Returns null when the input is not an unambiguous non-negative amount.
 */
export function parseMoneyToCents(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    // Numbers from spreadsheets: round to cents via string to avoid binary artefacts.
    return parseMoneyToCents(input.toFixed(2));
  }
  const s = input.trim().replace(/\s|\u00a0/g, '').replace(/€|EUR|eur/g, '');
  if (!s || /[^0-9.,]/.test(s) || !/\d/.test(s)) return null;
  const idx = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let intPart = s;
  let fracPart = '';
  if (idx >= 0) {
    const after = s.slice(idx + 1);
    // Only 1–2 digits after the last separator are accepted as decimals. "16,999" or
    // "1.234" are ambiguous for menu prices and are rejected so a human reviews them.
    if (after.length !== 1 && after.length !== 2) return null;
    const grouped = s.slice(0, idx);
    // Earlier separators must be valid thousands grouping: 1.234.567 / 1,234
    if (!/^\d+$/.test(grouped) && !/^\d{1,3}([.,]\d{3})+$/.test(grouped)) return null;
    intPart = grouped.replace(/[.,]/g, '');
    fracPart = after;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Display formatting, e.g. 1690 → "16,90 €" (pt-PT) or "€16.90" (en). */
export function formatCents(cents: Cents, localeTag = 'pt-PT', currency = 'EUR'): string {
  return new Intl.NumberFormat(localeTag, { style: 'currency', currency }).format(cents / 100);
}

/** Value for <input> fields: 1690 → "16.90". */
export function centsToInputValue(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Percentage of an amount in basis points (1000 = 10 %), rounded half-up to the cent. */
export function percentOfCents(cents: Cents, basisPoints: number): Cents {
  assertCents(cents);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) throw new Error('Invalid percentage');
  return Math.floor((cents * basisPoints + 5000) / 10000);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => assertCents(a + b), 0);
}
