import { describe, expect, it } from 'vitest';
import { pickupOptions, resolvePickup } from '@/server/services/fulfilment';

const LISBON = { timeZone: 'Europe/Lisbon', openingHours: { wed: [{ open: '12:00', close: '15:00' }], thu: [{ open: '12:00', close: '15:00' }] } };
const SETTINGS = { leadTimeMinutes: 20, slotMinutes: 15, pickupHours: null };

describe('pickup times offered to a guest', () => {
  it("offers today's remaining times while the restaurant still has some", () => {
    const now = new Date('2026-11-04T12:50:00Z'); // Wednesday 12:50 Lisbon
    const o = pickupOptions(LISBON, SETTINGS, now);
    expect(o.slots.every((s) => s.dayOffset === 0)).toBe(true);
    expect(o.slots[0].value).toBe('2026-11-04T13:15:00.000Z');
    expect(o.asap.allowed).toBe(true);
  });

  it("offers the next open day once today is finished, instead of refusing the order", () => {
    // 16:00 Wednesday: lunch is over. Before this, the guest was told "no pickup times are
    // available today" and could not order at all — the restaurant simply lost the order.
    const o = pickupOptions(LISBON, SETTINGS, new Date('2026-11-04T16:00:00Z'));
    expect(o.asap.allowed).toBe(false);
    expect(o.slots.length).toBeGreaterThan(0);
    expect(o.slots.every((s) => s.dayOffset === 1)).toBe(true);
    expect(o.slots[0].value).toBe('2026-11-05T12:00:00.000Z'); // Thursday noon
  });

  it('skips closed days to reach the next day that is really open', () => {
    // Open Wednesday only; asked on Thursday → the following Wednesday, six days later.
    const o = pickupOptions({ timeZone: 'Europe/Lisbon', openingHours: { wed: [{ open: '12:00', close: '13:00' }] } }, SETTINGS, new Date('2026-11-05T10:00:00Z'));
    expect(o.slots[0].value).toBe('2026-11-11T12:00:00.000Z');
    expect(o.slots[0].dayOffset).toBe(6);
  });

  it('never offers a time sooner than the lead time, including just before midnight', () => {
    const hours = { wed: [{ open: '00:00', close: '23:59' }], thu: [{ open: '00:00', close: '23:59' }] };
    const now = new Date('2026-11-04T23:50:00Z'); // 23:50 Lisbon, 10 minutes before midnight
    const o = pickupOptions({ timeZone: 'Europe/Lisbon', openingHours: hours }, { leadTimeMinutes: 30, slotMinutes: 15, pickupHours: null }, now);
    expect(o.slots.length).toBeGreaterThan(0);
    for (const s of o.slots) expect(new Date(s.value).getTime()).toBeGreaterThanOrEqual(now.getTime() + 30 * 60_000);
  });

  it('respects pickup hours over opening hours, and summer time', () => {
    const now = new Date('2026-07-01T11:00:00Z'); // Wednesday 12:00 Lisbon (WEST, UTC+1)
    const o = pickupOptions(LISBON, { leadTimeMinutes: 0, slotMinutes: 30, pickupHours: { wed: [{ open: '18:00', close: '19:00' }] } }, now);
    expect(o.slots.map((s) => s.value)).toEqual(['2026-07-01T17:00:00.000Z', '2026-07-01T17:30:00.000Z']);
  });

  it('offers only "as soon as possible" when no hours are configured at all', () => {
    const o = pickupOptions({ timeZone: 'Europe/Lisbon', openingHours: null }, SETTINGS, new Date('2026-11-04T16:00:00Z'));
    expect(o.slots).toEqual([]);
    expect(o.asap.allowed).toBe(true);
  });

  it('only accepts a time it actually offered', () => {
    const now = new Date('2026-11-04T12:50:00Z');
    const o = pickupOptions(LISBON, SETTINGS, now);
    expect(resolvePickup('2026-11-04T13:20:00.000Z', o, now)).toBeNull(); // between slots
    expect(resolvePickup('2026-11-04T13:15:00.000Z', o, now)?.toISOString()).toBe('2026-11-04T13:15:00.000Z');
    const late = pickupOptions(LISBON, SETTINGS, new Date('2026-11-04T16:00:00Z'));
    expect(resolvePickup('asap', late)).toBeNull(); // closed now, so no "as soon as possible"
    expect(resolvePickup(late.slots[0].value, late)?.toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });
});
