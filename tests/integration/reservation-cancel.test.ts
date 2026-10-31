import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  assignReservationTable,
  availability,
  cancelReservationByToken,
  changeReservationStatus,
  requestReservation,
  trackReservation,
  updateReservationSettings,
} from '@/server/services/reservations';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const DINNER = { fri: [{ open: '19:00', close: '23:00' }] };
const NOW = new Date('2026-11-04T10:00:00Z'); // Wednesday morning in Lisbon (UTC+0)
const FRIDAY = '2026-11-06';

async function setup(f: F, extra: Record<string, unknown> = {}) {
  await db.restaurantLocation.update({ where: { id: f.location.id }, data: { reservationsEnabled: true } });
  await updateReservationSettings(f.ctx, {
    locationId: f.location.id,
    slotMinutes: 30,
    durationMinutes: 90,
    bufferMinutes: 15,
    maxPartySize: 8,
    maxCoversPerSlot: 4,
    minNoticeMinutes: 60,
    maxDaysAhead: 30,
    bookableHours: JSON.stringify(DINNER),
    ...extra,
  });
}

const book = (f: F, extra: Record<string, unknown> = {}) =>
  requestReservation(
    { orgSlug: f.org.slug, date: FRIDAY, time: '20:00', partySize: 2, name: 'Test Guest', phone: '+351 900 000 010', idempotencyKey: randomUUID(), language: 'pt', ...extra },
    `k${Math.random()}`,
    NOW,
  );

const slotAt = async (f: F, time: string, partySize = 2) => {
  const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } });
  const s = await db.reservationSettings.findUniqueOrThrow({ where: { locationId: f.location.id } });
  const av = await availability(db, loc, s, FRIDAY, partySize, NOW);
  return av.slots.find((x) => x.time === time);
};

describe('a guest cancelling their own reservation', () => {
  beforeEach(resetDatabase);

  it('cancels it, tells the restaurant, and frees the seats for other guests', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    // Two parties of two fill the 4-cover limit on the 20:00 slot.
    const first = await book(f);
    await book(f, { name: 'Second Guest', phone: '+351 900 000 011' });
    expect((await slotAt(f, '20:00'))?.available).toBe(false);

    const res = await cancelReservationByToken(first.token, 'guest-1', NOW);
    expect(res).toEqual({ ok: true });
    expect((await trackReservation(first.token))?.status).toBe('CANCELLED');
    // Seats are bookable again, which is the whole reason to let a guest cancel.
    expect((await slotAt(f, '20:00'))?.available).toBe(true);
    // Staff are told, so the floor plan is not left holding a table nobody is coming to.
    const note = await db.notification.findFirstOrThrow({ where: { organizationId: f.org.id, type: 'RESERVATION_REQUEST' }, orderBy: { createdAt: 'desc' } });
    expect(note.title).toMatch(/cancelled by the guest/i);
  });

  it('releases the table the restaurant had assigned', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const r = await book(f);
    const row = await db.reservation.findFirstOrThrow();
    await changeReservationStatus(f.ctx, { reservationId: row.id, to: 'CONFIRMED', expectedFrom: 'REQUESTED' });
    await assignReservationTable(f.ctx, row.id, f.table.id);
    expect(await db.reservationTableAssignment.count({ where: { reservationId: row.id } })).toBe(1);

    await cancelReservationByToken(r.token, 'guest-1', NOW);
    expect(await db.reservationTableAssignment.count({ where: { reservationId: row.id } })).toBe(0);
  });

  it('is safe to press twice', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const r = await book(f);
    expect(await cancelReservationByToken(r.token, 'guest-1', NOW)).toEqual({ ok: true });
    expect(await cancelReservationByToken(r.token, 'guest-1', NOW)).toEqual({ ok: false, reason: 'not_cancellable' });
    expect(await db.reservation.count({ where: { status: 'CANCELLED' } })).toBe(1);
  });

  it('refuses a booking that is about to start: that is a phone call', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const r = await book(f);
    // 30 minutes before the 20:00 sitting, which is inside the one-hour notice period.
    const almostThere = new Date('2026-11-06T19:30:00Z');
    expect(await cancelReservationByToken(r.token, 'guest-1', almostThere)).toEqual({ ok: false, reason: 'too_late' });
    expect((await trackReservation(r.token))?.status).toBe('REQUESTED');
  });

  it('cannot cancel a reservation the restaurant already settled', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const r = await book(f);
    const row = await db.reservation.findFirstOrThrow();
    await changeReservationStatus(f.ctx, { reservationId: row.id, to: 'REJECTED', expectedFrom: 'REQUESTED' });
    expect(await cancelReservationByToken(r.token, 'guest-1', NOW)).toEqual({ ok: false, reason: 'not_cancellable' });
    expect((await trackReservation(r.token))?.status).toBe('REJECTED');
  });

  it('accepts only the exact private link, and reaches nothing else', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const r = await book(f);
    for (const bad of ['', 'short', 'x'.repeat(40), `${r.token}x`, '../../etc/passwd']) {
      expect(await cancelReservationByToken(bad, 'guest-1', NOW), bad).toEqual({ ok: false, reason: 'not_found' });
    }
    expect((await trackReservation(r.token))?.status).toBe('REQUESTED');
  });

  it('cancels only the one reservation the link belongs to', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await setup(a);
    await setup(b);
    const mine = await book(a);
    const theirs = await book(b);
    await cancelReservationByToken(mine.token, 'guest-1', NOW);
    expect((await trackReservation(theirs.token))?.status).toBe('REQUESTED');
    expect(await db.reservation.count({ where: { status: 'CANCELLED' } })).toBe(1);
  });
});
