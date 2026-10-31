import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { applyDiscoveredProfile, mergeProfiles } from '@/server/discovery/service';
import { searchOsm, reverseOsm } from '@/server/discovery/osm';
import { getSetupProgress } from '@/server/services/setup-progress';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Magic Setup: how sources are combined, and what saving a reviewed profile writes.
 * Fictitious "Test …" restaurants in the TEST database. No network: OSM is called through an
 * injected fetcher, and the website/Maps parsers are pure (covered by the unit tests).
 */

const FULL_HOURS = {
  mon: [{ open: '11:00', close: '23:00' }],
  tue: [{ open: '11:00', close: '23:00' }],
  wed: [{ open: '11:00', close: '23:00' }],
  thu: [{ open: '11:00', close: '23:00' }],
  fri: [{ open: '11:00', close: '23:00' }],
  sat: [{ open: '11:00', close: '23:30' }],
  sun: [],
};

describe('combining discovery sources', () => {
  it('lets the restaurant’s own website outrank third-party data, keeping the difference visible', () => {
    const merged = mergeProfiles([
      { source: 'osm', profile: { postalCode: '4710-294', addressLine1: 'Rua de Santa Margarida', city: 'Braga' } },
      { source: 'website', profile: { postalCode: '4710-311', addressLine1: 'R. de Santa Margarida 13' } },
    ]);
    expect(merged.postalCode).toMatchObject({ value: '4710-311', source: 'website', confidence: 'high' });
    // The disagreement is shown rather than silently dropped.
    expect(merged.postalCode?.alternatives).toEqual([{ value: '4710-294', source: 'osm' }]);
    // A field only one source has is taken from that source.
    expect(merged.city).toMatchObject({ value: 'Braga', source: 'osm', confidence: 'medium' });
  });

  it('prefers the name from a Maps link over a reverse-geocoded neighbour', () => {
    const merged = mergeProfiles([
      { source: 'osm', profile: { addressLine1: 'Rua de Santa Margarida' } },
      { source: 'maps_link', profile: { name: 'CASA DE MARROCOS' } },
    ]);
    expect(merged.name).toMatchObject({ value: 'CASA DE MARROCOS', source: 'maps_link' });
  });

  it('keeps what the owner typed above everything else', () => {
    const merged = mergeProfiles([
      { source: 'website', profile: { name: 'Site Title Test' } },
      { source: 'input', profile: { name: 'Test Restaurant Name' } },
    ]);
    expect(merged.name).toMatchObject({ value: 'Test Restaurant Name', source: 'input' });
  });

  it('ignores empty values and records no field for them', () => {
    const merged = mergeProfiles([{ source: 'website', profile: { name: '', city: undefined, phone: '+351912345678' } }]);
    expect(merged.name).toBeUndefined();
    expect(merged.city).toBeUndefined();
    expect(merged.phone?.value).toBe('+351912345678');
  });
});

describe('OpenStreetMap lookups', () => {
  it('finds a restaurant by name and reads its contact tags', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      {
        name: 'Test Tasca OSM',
        type: 'restaurant',
        lat: '41.5',
        lon: '-8.4',
        address: { road: 'Rua de Teste', house_number: '7', postcode: '4700-123', city: 'Braga' },
        extratags: { phone: '+351 253 000 000', website: 'http://tascateste.pt', opening_hours: 'Mo-Sa 12:00-15:00; Su off', cuisine: 'portuguese', 'contact:instagram': 'tascateste' },
      },
    ]);
    const r = await searchOsm('Test Tasca OSM', 'Braga', 'PT', fetcher);
    expect(r).toMatchObject({
      name: 'Test Tasca OSM',
      addressLine1: 'Rua de Teste 7',
      postalCode: '4700-123',
      city: 'Braga',
      phone: '+351253000000',
      websiteUrl: 'https://tascateste.pt', // upgraded to https
      cuisine: 'portuguese',
      instagramUrl: 'https://www.instagram.com/tascateste', // bare handle expanded
    });
    expect(r?.openingHours?.mon).toEqual([{ open: '12:00', close: '15:00' }]);
    expect(r?.openingHours?.sun).toEqual([]);
  });

  it('refuses a result that is neither a venue nor a name match', async () => {
    const fetcher = vi.fn().mockResolvedValue([{ name: 'Some Street', type: 'highway', lat: '41.5', lon: '-8.4', address: { road: 'Rua Qualquer' } }]);
    expect(await searchOsm('Test Tasca OSM', 'Braga', 'PT', fetcher)).toBeNull();
    expect(await searchOsm('Test Tasca OSM', 'Braga', 'PT', vi.fn().mockResolvedValue([]))).toBeNull();
  });

  it('takes only the address from a reverse lookup, never the nearest shop’s identity', async () => {
    // Verified against a real Maps pin, which reverse-geocoded to a neighbouring confectioner.
    const fetcher = vi.fn().mockResolvedValue({
      name: 'Bombonaria Pasejo',
      lat: '41.5571513',
      lon: '-8.4172967',
      address: { road: 'Rua de Santa Margarida', postcode: '4710-294', city: 'Braga' },
      extratags: { phone: '+351 253 999 999', opening_hours: 'Mo-Fr 09:00-19:00', website: 'https://not-the-restaurant.test' },
    });
    const r = await reverseOsm(41.5573282, -8.4173135, 'PT', fetcher);
    expect(r).toEqual({ addressLine1: 'Rua de Santa Margarida', postalCode: '4710-294', city: 'Braga', latitude: 41.5573282, longitude: -8.4173135 });
    expect(r?.name).toBeUndefined();
    expect(r?.phone).toBeUndefined();
    expect(r?.openingHours).toBeUndefined();
    expect(r?.websiteUrl).toBeUndefined();
  });
});

describe('saving a reviewed profile', () => {
  beforeEach(resetDatabase);

  const profile = (f: Awaited<ReturnType<typeof createOrderingFixture>>, over: Record<string, unknown> = {}) => ({
    locationId: f.location.id,
    name: 'Casa de Teste',
    addressLine1: 'R. de Santa Margarida 13',
    postalCode: '4710-311',
    city: 'Braga',
    phone: '+351935413677',
    whatsappNumber: '+351935413677',
    email: 'info@casadeteste.test',
    openingHours: JSON.stringify(FULL_HOURS),
    websiteUrl: 'https://casadeteste.test',
    instagramUrl: 'https://www.instagram.com/casadeteste',
    facebookUrl: 'https://www.facebook.com/casadeteste',
    glovoUrl: 'https://glovoapp.com/pt/pt/braga/stores/casa-de-teste-brg',
    uberEatsUrl: 'https://www.ubereats.com/pt/store/casa-de-teste/abc',
    googleReviewUrl: 'https://maps.app.goo.gl/testlink',
    ...over,
  });

  it('writes details and links in one step, and completes the details step', async () => {
    const f = await createOrderingFixture();
    expect((await getSetupProgress(f.org.id)).steps.find((s) => s.key === 'details')?.done).toBe(false);

    await applyDiscoveredProfile(f.ctx, profile(f));

    const l = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } });
    expect(l).toMatchObject({
      name: 'Casa de Teste',
      addressLine1: 'R. de Santa Margarida 13',
      postalCode: '4710-311',
      city: 'Braga',
      phone: '+351935413677',
      whatsappNumber: '+351935413677',
      email: 'info@casadeteste.test',
      websiteUrl: 'https://casadeteste.test',
      instagramUrl: 'https://www.instagram.com/casadeteste',
      glovoUrl: 'https://glovoapp.com/pt/pt/braga/stores/casa-de-teste-brg',
    });
    expect(l.openingHours).toEqual(FULL_HOURS);
    expect((await db.reviewSettings.findUniqueOrThrow({ where: { locationId: f.location.id } })).googleReviewUrl).toBe('https://maps.app.goo.gl/testlink');
    // The 10-step checklist now counts the details step as done.
    expect((await getSetupProgress(f.org.id)).steps.find((s) => s.key === 'details')?.done).toBe(true);
  });

  it('never switches an ordering channel on by itself', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tableOrderingEnabled: false, takeawayEnabled: false, deliveryEnabled: false } });
    await applyDiscoveredProfile(f.ctx, profile(f));
    const l = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } });
    expect([l.tableOrderingEnabled, l.takeawayEnabled, l.deliveryEnabled, l.isPublished]).toEqual([false, false, false, true]);
  });

  it('applies the country’s postal rules and the links’ host rules', async () => {
    const f = await createOrderingFixture();
    await expect(applyDiscoveredProfile(f.ctx, profile(f, { postalCode: '0000-000' }))).rejects.toThrow();
    // A Glovo field must hold a Glovo link, as on the Channels page.
    await expect(applyDiscoveredProfile(f.ctx, profile(f, { glovoUrl: 'https://example.test/x' }))).rejects.toThrow();
    await expect(applyDiscoveredProfile(f.ctx, profile(f, { websiteUrl: 'http://insecure.test' }))).rejects.toThrow();
    await expect(applyDiscoveredProfile(f.ctx, profile(f, { name: 'x' }))).rejects.toThrow();
    // Nothing was written by the refused attempts.
    expect((await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } })).addressLine1).toBeNull();
  });

  it('lets the owner clear a discovered value', async () => {
    const f = await createOrderingFixture();
    await applyDiscoveredProfile(f.ctx, profile(f));
    await applyDiscoveredProfile(f.ctx, profile(f, { instagramUrl: '', email: '', whatsappNumber: '' }));
    const l = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } });
    expect([l.instagramUrl, l.email, l.whatsappNumber]).toEqual([null, null, null]);
    expect(l.facebookUrl).toBe('https://www.facebook.com/casadeteste'); // untouched fields stay
  });

  it('is tenant-isolated', async () => {
    const a = await createOrderingFixture('Test Magic A');
    const b = await createOrderingFixture('Test Magic B');
    await expect(applyDiscoveredProfile(a.ctx, profile(b))).rejects.toThrow();
    expect((await db.restaurantLocation.findUniqueOrThrow({ where: { id: b.location.id } })).addressLine1).toBeNull();
  });
});
