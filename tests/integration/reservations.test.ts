import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  assignReservationTable,
  availability,
  changeReservationStatus,
  requestReservation,
  reservationsForDay,
  trackReservation,
  updateReservationSettings,
} from '@/server/services/reservations';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const DINNER = { fri: [{ open: '19:00', close: '23:00' }] };
const NOW = new Date('2026-11-04T10:00:00Z'); // Wednesday morning, Europe/Lisbon (UTC+0)
const FRIDAY = '2026-11-06';

async function setup(f: F, extra: Record<string, unknown> = {}) {
  await db.restaurantLocation.update({ where: { id: f.location.id }, data: { reservationsEnabled: true } });
  await updateReservationSettings(f.ctx, { locationId: f.location.id, slotMinutes: 30, durationMinutes: 90, bufferMinutes: 15, maxPartySize: 8, maxCoversPerSlot: 10, minNoticeMinutes: 60, maxDaysAhead: 30, bookableHours: JSON.stringify(DINNER), ...extra });
}
const req = (f: F, extra: Record<string, unknown> = {}) =>
  requestReservation({ orgSlug: f.org.slug, date: FRIDAY, time: '20:00', partySize: 4, name: 'Test Guest', phone: '+351 900 000 004', idempotencyKey: randomUUID(), language: 'pt', ...extra }, `k${Math.random()}`, NOW);

describe('M10-05/06 reservation availability', () => {
  beforeEach(resetDatabase);

  it('slots inside bookable hours where the whole visit fits; nothing without configured hours', async () => {
    const f = await createOrderingFixture();
    const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } });
    expect((await availability(db, loc, null, FRIDAY, 2, NOW)).reason).toBe('hours_not_configured');
    await setup(f);
    const s = await db.reservationSettings.findUniqueOrThrow({ where: { locationId: f.location.id } });
    const av = await availability(db, loc, s, FRIDAY, 2, NOW);
    expect(av.slots.map((x) => x.time)).toEqual(['19:00', '19:30', '20:00', '20:30', '21:00', '21:30']); // 21:30 + 90 min = 23:00
    expect(av.slots[0].startsAt).toBe('2026-11-06T19:00:00.000Z');
    expect((await availability(db, loc, s, '2026-11-05', 2, NOW)).reason).toBe('closed');
    expect((await availability(db, loc, s, FRIDAY, 9, NOW)).reason).toBe('party_too_large');
    expect((await availability(db, loc, s, '2027-03-01', 2, NOW)).reason).toBe('date_out_of_range');
  });

  it('capacity counts overlapping requested/confirmed reservations; refused ones free capacity', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    await req(f, { partySize: 8 });
    await expect(req(f, { partySize: 4 })).rejects.toMatchObject({ code: 'slot_unavailable' }); // 8 + 4 > 10
    await expect(req(f, { partySize: 2, time: '19:00' })).resolves.toMatchObject({ status: 'REQUESTED' }); // 19:00–20:30 overlaps 20:00 → 10 covers, still OK
    const big = await db.reservation.findFirstOrThrow({ where: { partySize: 8 } });
    await changeReservationStatus(f.ctx, { reservationId: big.id, expectedFrom: 'REQUESTED', to: 'REJECTED' });
    await expect(req(f, { partySize: 4 })).resolves.toMatchObject({ status: 'REQUESTED' });
  });

  it('concurrent requests for the last seats: only the ones that fit succeed', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => req(f, { partySize: 4 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2); // 4 + 4 ≤ 10, a third would be 12
    expect(await db.reservation.count()).toBe(2);
  });

  it('idempotent guest submission and private tracking token', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const key = randomUUID();
    const a = await req(f, { idempotencyKey: key });
    const b = await req(f, { idempotencyKey: key });
    expect(b).toMatchObject({ token: a.token, duplicate: true });
    expect(await db.reservation.count()).toBe(1);
    expect((await trackReservation(a.token))?.status).toBe('REQUESTED');
    expect(await trackReservation('x'.repeat(32))).toBeNull();
  });
});

describe('TEST 12: reservation lifecycle and no double-booking of a table', () => {
  beforeEach(resetDatabase);

  it('confirm → arrived → completed; impossible transitions refused', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    await req(f);
    const r = await db.reservation.findFirstOrThrow();
    await expect(changeReservationStatus(f.ctx, { reservationId: r.id, expectedFrom: 'REQUESTED', to: 'ARRIVED' })).rejects.toThrow(/Cannot change/);
    await changeReservationStatus(f.ctx, { reservationId: r.id, expectedFrom: 'REQUESTED', to: 'CONFIRMED' });
    await expect(changeReservationStatus(f.ctx, { reservationId: r.id, expectedFrom: 'REQUESTED', to: 'CONFIRMED' })).rejects.toMatchObject({ code: 'status_conflict' });
    await changeReservationStatus(f.ctx, { reservationId: r.id, expectedFrom: 'CONFIRMED', to: 'ARRIVED' });
    await changeReservationStatus(f.ctx, { reservationId: r.id, expectedFrom: 'ARRIVED', to: 'COMPLETED' });
    const day = await reservationsForDay(f.ctx, f.location.id, FRIDAY);
    expect(day.map((x) => x.status)).toEqual(['COMPLETED']);
  });

  it('the same table cannot hold two overlapping reservations (incl. buffer); cancelled bookings free it', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    await req(f, { name: 'Guest A', time: '20:00', partySize: 2 });
    await req(f, { name: 'Guest B', time: '21:30', partySize: 2 }); // 20:00+90+15 buffer = 21:45 > 21:30
    const [a, b] = await db.reservation.findMany({ orderBy: { startsAt: 'asc' } });
    await assignReservationTable(f.ctx, a.id, f.table.id);
    await changeReservationStatus(f.ctx, { reservationId: a.id, expectedFrom: 'REQUESTED', to: 'CONFIRMED' });
    await expect(assignReservationTable(f.ctx, b.id, f.table.id)).rejects.toThrow(/already booked/);
    await changeReservationStatus(f.ctx, { reservationId: a.id, expectedFrom: 'CONFIRMED', to: 'CANCELLED' });
    await expect(assignReservationTable(f.ctx, b.id, f.table.id)).resolves.toBeTruthy();
  });

  it('simultaneous assignments of one table: exactly one succeeds', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    await req(f, { name: 'Guest A', partySize: 2 });
    await req(f, { name: 'Guest B', partySize: 2 });
    const [a, b] = await db.reservation.findMany();
    const results = await Promise.allSettled([assignReservationTable(f.ctx, a.id, f.table.id), assignReservationTable(f.ctx, b.id, f.table.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.reservationTableAssignment.count()).toBe(1);
  });

  it('reservations are tenant-isolated', async () => {
    const a = await createOrderingFixture('Test A');
    const b = await createOrderingFixture('Test B');
    await setup(b);
    await req(b);
    const r = await db.reservation.findFirstOrThrow();
    await expect(changeReservationStatus(a.ctx, { reservationId: r.id, expectedFrom: 'REQUESTED', to: 'CONFIRMED' })).rejects.toThrow(/not found/);
    await expect(assignReservationTable(a.ctx, r.id, a.table.id)).rejects.toThrow(/not found/);
    await expect(reservationsForDay(a.ctx, b.location.id, FRIDAY)).rejects.toMatchObject({ reason: 'location' });
  });
});
