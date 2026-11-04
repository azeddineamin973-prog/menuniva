import { describe, expect, it } from 'vitest';
import { describeZonePattern, isValidPostalCode, normalizePostalCode, parseZoneEntry, postalCodeMatches, townMatches, zonePatternInput, zonePatternMatches, zonePatternSpecificity } from '@/lib/postal';

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

describe('delivery areas typed by the owner', () => {
  it('understands postal areas without *, exact codes, towns and everywhere (PT)', () => {
    expect(parseZoneEntry('PT', '4700')).toBe('4700-*');
    expect(parseZoneEntry('PT', '4700-')).toBe('4700-*');
    expect(parseZoneEntry('PT', '4700-*')).toBe('4700-*');
    expect(parseZoneEntry('PT', '4700*')).toBe('4700-*');
    expect(parseZoneEntry('PT', '47')).toBe('47*');
    expect(parseZoneEntry('PT', '4700-1')).toBe('4700-1*');
    expect(parseZoneEntry('PT', '47001')).toBe('4700-1*');
    expect(parseZoneEntry('PT', '4700123')).toBe('4700-123');
    expect(parseZoneEntry('PT', '4700 123')).toBe('4700-123');
    expect(parseZoneEntry('PT', 'Braga')).toBe('city:Braga');
    expect(parseZoneEntry('PT', 'São Vicente')).toBe('city:São Vicente');
    expect(parseZoneEntry('PT', '*')).toBe('*');
    expect(parseZoneEntry('PT', 'everywhere')).toBe('*');
    expect(parseZoneEntry('PT', '0700')).toBeNull();
    expect(parseZoneEntry('PT', '12345678')).toBeNull();
    expect(parseZoneEntry('PT', '47-00')).toBeNull();
  });
  it('understands Spanish areas and codes', () => {
    expect(parseZoneEntry('ES', '280')).toBe('280*');
    expect(parseZoneEntry('ES', '28013')).toBe('28013');
    expect(parseZoneEntry('ES', '99999')).toBeNull();
    expect(parseZoneEntry('ES', 'Madrid')).toBe('city:Madrid');
  });
  it('matches towns by whole words, without case or accents', () => {
    expect(townMatches('BRAGA', 'Braga')).toBe(true);
    expect(townMatches('Braga, Portugal', 'braga')).toBe(true);
    expect(townMatches('Bragança', 'Braga')).toBe(false);
    expect(townMatches('sao vicente', 'São Vicente')).toBe(true);
    expect(townMatches('', 'Braga')).toBe(false);
  });
  it('matches postal code and town together, and ranks the most precise pattern first', () => {
    expect(zonePatternMatches('PT', '4710-001', '', '4700-*')).toBe(false);
    expect(zonePatternMatches('PT', '4710-001', 'Braga', 'city:Braga')).toBe(true);
    expect(zonePatternMatches('PT', '3000-380', 'Coimbra', '*')).toBe(true);
    const order = ['4700-123', '4700-1*', '4700-*', 'city:Braga', '470*', '47*', '*'].map(zonePatternSpecificity);
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });
  it('shows and re-edits stored areas the way the owner typed them', () => {
    expect(describeZonePattern('PT', '4700-*')).toBe('4700-xxx');
    expect(describeZonePattern('PT', '47*')).toBe('47xx-xxx');
    expect(describeZonePattern('ES', '280*')).toBe('280xx');
    expect(describeZonePattern('PT', 'city:Braga')).toBe('Braga');
    expect(zonePatternInput('4700-*')).toBe('4700');
    expect(zonePatternInput('4700-1*')).toBe('4700-1');
    expect(zonePatternInput('city:Braga')).toBe('Braga');
    expect(zonePatternInput('*')).toBe('*');
  });
});
