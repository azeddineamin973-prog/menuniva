import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { quoteCart } from '@/server/services/pricing';
import { computeDiscounts, promotionInstant, savePromotion } from '@/server/services/promotions';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Audit BUG-07: promotion start/end are wall-clock times of the restaurant location's IANA time
 * zone, whatever the server's time zone is. The test process runs in Asia/Tokyo on purpose.
 */
const base = { channels: ['TABLE', 'TAKEAWAY', 'DELIVERY'], combinable: false, isActive: true, priority: 0 };
let originalTz: string | undefined;
beforeAll(() => {
  originalTz = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe('promotionInstant (pure)', () => {
  it('Europe/Lisbon: summer (WEST, UTC+1) and winter (WET, UTC+0)', () => {
    expect(promotionInstant('2026-07-01T10:00', 'Europe/Lisbon')!.toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(promotionInstant('2026-01-15T10:00', 'Europe/Lisbon')!.toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });
  it('Europe/Madrid: summer (CEST, UTC+2) and winter (CET, UTC+1)', () => {
    expect(promotionInstant('2026-07-01T10:00', 'Europe/Madrid')!.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(promotionInstant('2026-01-15T10:00', 'Europe/Madrid')!.toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });
  it('daylight-saving changes (last Sunday of March / October 2026)', () => {
    // Lisbon spring forward 01:00 → 02:00 on 2026-03-29
    expect(promotionInstant('2026-03-29T00:30', 'Europe/Lisbon')!.toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(promotionInstant('2026-03-29T02:30', 'Europe/Lisbon')!.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // Lisbon fall back 02:00 → 01:00 on 2026-10-25
    expect(promotionInstant('2026-10-25T00:30', 'Europe/Lisbon')!.toISOString()).toBe('2026-10-24T23:30:00.000Z');
    expect(promotionInstant('2026-10-25T03:00', 'Europe/Lisbon')!.toISOString()).toBe('2026-10-25T03:00:00.000Z');
    // Madrid fall back 03:00 → 02:00 on 2026-10-25
    expect(promotionInstant('2026-10-25T04:00', 'Europe/Madrid')!.toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });
  it('explicit instants (Z / offset) are kept as they are', () => {
    expect(promotionInstant('2026-07-01T10:00:00.000Z', 'Europe/Madrid')!.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(promotionInstant('2026-07-01T10:00+02:00', 'Europe/Lisbon')!.toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });
});

describe('promotion windows on real quotes', () => {
  beforeEach(resetDatabase);
  type F = Awaited<ReturnType<typeof createOrderingFixture>>;
  const discountAt = async (f: F, now: Date, code?: string) => {
    const q = await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], now });
    return computeDiscounts(db, { organizationId: f.org.id, locationId: f.location.id, channel: 'TABLE', couponCode: code, lines: q.lines, subtotalCents: q.subtotalCents, now });
  };

  it('Lisbon: a promotion ending at local midnight applies at 23:59 and not at 00:00', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: 'Halloween', type: 'FIXED_AMOUNT', amount: '1,00', startsAt: '2026-10-31T00:00', endsAt: '2026-11-01T00:00' });
    const p = await db.promotion.findFirstOrThrow({ where: { organizationId: f.org.id } });
    expect([p.startsAt!.toISOString(), p.endsAt!.toISOString()]).toEqual(['2026-10-31T00:00:00.000Z', '2026-11-01T00:00:00.000Z']); // WET = UTC
    expect((await discountAt(f, new Date('2026-10-30T23:59:00Z'))).totalCents).toBe(0);
    expect((await discountAt(f, new Date('2026-10-31T00:00:00Z'))).totalCents).toBe(100);
    expect((await discountAt(f, new Date('2026-10-31T23:59:00Z'))).totalCents).toBe(100);
    expect((await discountAt(f, new Date('2026-11-01T00:00:00Z'))).totalCents).toBe(0);
  });

  it('Madrid: the same wall-clock window is one hour earlier in UTC; expired codes are refused', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { timeZone: 'Europe/Madrid' } });
    await savePromotion(f.ctx, { ...base, name: 'Lunch code', type: 'FIXED_AMOUNT', amount: '2,00', couponCode: 'LUNCH', startsAt: '2026-11-02T12:00', endsAt: '2026-11-02T15:00' });
    const p = await db.promotion.findFirstOrThrow({ where: { organizationId: f.org.id } });
    expect([p.startsAt!.toISOString(), p.endsAt!.toISOString()]).toEqual(['2026-11-02T11:00:00.000Z', '2026-11-02T14:00:00.000Z']);
    expect(await discountAt(f, new Date('2026-11-02T10:59:00Z'), 'LUNCH')).toMatchObject({ couponStatus: 'invalid', totalCents: 0 });
    expect(await discountAt(f, new Date('2026-11-02T11:00:00Z'), 'LUNCH')).toMatchObject({ couponStatus: 'valid', totalCents: 200 });
    expect(await discountAt(f, new Date('2026-11-02T14:00:00Z'), 'LUNCH')).toMatchObject({ couponStatus: 'invalid', totalCents: 0 }); // expired
  });

  it('end before start is refused after conversion; locations in two time zones are refused', async () => {
    const f = await createOrderingFixture();
    await expect(savePromotion(f.ctx, { ...base, name: 'Bad', type: 'PERCENTAGE', percent: '10', startsAt: '2026-12-02T10:00', endsAt: '2026-12-02T09:59' })).rejects.toThrow(/end_before_start/);
    await db.restaurantLocation.create({ data: { organizationId: f.org.id, name: 'Madrid', slug: 'madrid', country: 'ES', timeZone: 'Europe/Madrid' } });
    await expect(savePromotion(f.ctx, { ...base, name: 'Two zones', type: 'PERCENTAGE', percent: '10', startsAt: '2026-12-02T10:00' })).rejects.toThrow(/different time zones/);
    await expect(savePromotion(f.ctx, { ...base, name: 'No dates', type: 'PERCENTAGE', percent: '10' })).resolves.toBeTruthy(); // no dates: fine
  });
});
