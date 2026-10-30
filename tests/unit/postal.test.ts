import { describe, expect, it } from 'vitest';
import { isValidPostalCode, normalizePostalCode, postalCodeMatches } from '@/lib/postal';

describe('Portuguese postal codes', () => {
  it('accepts NNNN-NNN and normalises missing hyphen', () => {
    expect(isValidPostalCode('PT', '4700-123')).toBe(true);
    expect(normalizePostalCode('PT', '4700123')).toBe('4700-123');
    expect(isValidPostalCode('PT', '4700 123')).toBe(true);
  });
  it('rejects invalid formats', () => {
    expect(isValidPostalCode('PT', '470-123')).toBe(false);
    expect(isValidPostalCode('PT', '0700-123')).toBe(false);
    expect(isValidPostalCode('PT', '28013')).toBe(false);
  });
});

describe('Spanish postal codes', () => {
  it('accepts 5 digits with valid province prefix', () => {
    expect(isValidPostalCode('ES', '28013')).toBe(true);
    expect(isValidPostalCode('ES', '08001')).toBe(true);
  });
  it('rejects invalid provinces/formats', () => {
    expect(isValidPostalCode('ES', '53001')).toBe(false);
    expect(isValidPostalCode('ES', '00123')).toBe(false);
    expect(isValidPostalCode('ES', '4700-123')).toBe(false);
  });
});

describe('zone pattern matching', () => {
  it('matches exact and wildcard patterns', () => {
    expect(postalCodeMatches('PT', '4700-123', '4700-*')).toBe(true);
    expect(postalCodeMatches('PT', '4700123', '4700-123')).toBe(true);
    expect(postalCodeMatches('PT', '4710-001', '4700-*')).toBe(false);
    expect(postalCodeMatches('ES', '28013', '280*')).toBe(true);
    expect(postalCodeMatches('ES', '29013', '280*')).toBe(false);
  });
});
