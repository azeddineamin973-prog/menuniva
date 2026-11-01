import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { db } from '@/server/db';
import { floorPlanForEditor, guestFloorPlan, saveFloorPlan } from '@/server/services/floor-plan';
import { assignReservationTable, changeReservationStatus, requestReservation, tableStatuses, trackReservation, unassignReservationTable, updateGuestTableChoice, updateReservationSettings } from '@/server/services/reservations';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * 2D table reservation: the owner's floor plan, which tables a guest may pick at a given time,
 * and the table held with a guest's request (never a confirmation: staff still confirm).
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const DINNER = { fri: [{ open: '19:00', close: '23:00' }] };
const NOW = new Date('2026-11-04T10:00:00Z'); // Wednesday morning, Europe/Lisbon (UTC+0)
const FRIDAY = '2026-11-06';

/** Reservations on Friday dinner; tables T2 (2 seats), T4 (4), T6 (6) placed in the fixture's area; table 05 has no seat count. */
async function setup(f: F, { guestChoice = true, covers = 10 } = {}) {
  await db.restaurantLocation.update({ where: { id: f.location.id }, data: { reservationsEnabled: true } });
  await updateReservationSettings(f.ctx, { locationId: f.location.id, slotMinutes: 30, durationMinutes: 90, bufferMinutes: 15, maxPartySize: 8, maxCoversPerSlot: covers, minNoticeMinutes: 60, maxDaysAhead: 30, bookableHours: JSON.stringify(DINNER) });
  if (guestChoice) await updateGuestTableChoice(f.ctx, { locationId: f.location.id, enabled: true });
  const mk = (label: string, seats: number, x: number) =>
    db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, areaId: f.table.areaId, label, seats, planX: x, planY: 200, planShape: 'ROUND' } });
  const [t2, t4, t6] = await Promise.all([mk('T2', 2, 150), mk('T4', 4, 400), mk('T6', 6, 700)]);
  return { t2, t4, t6 };
}
const req = (f: F, extra: Record<string, unknown> = {}) =>
  requestReservation({ orgSlug: f.org.slug, date: FRIDAY, time: '20:00', partySize: 4, name: 'Plan Guest', phone: `+351 91${Math.floor(Math.random() * 1e7)}`, idempotencyKey: randomUUID(), language: 'pt', ...extra }, `k${Math.random()}`, NOW);
async function statuses(f: F, time: string, party: number) {
  const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id }, include: { reservationSettings: true } });
  const r = await tableStatuses(loc, loc.reservationSettings, FRIDAY, time, party, NOW);
  return { slotAvailable: r.slotAvailable, by: Object.fromEntries(await Promise.all(r.tables.map(async (t) => [(await db.restaurantTable.findUniqueOrThrow({ where: { id: t.id } })).label, t.status]))) as Record<string, string> };
}

describe('which tables a guest may pick', () => {
  beforeEach(resetDatabase);

  it('by seats, existing holds (visit + buffer) and a missing seat count; a full time offers none', async () => {
    const f = await createOrderingFixture();
    const { t4 } = await setup(f);
    expect(await statuses(f, '20:00', 4)).toEqual({ slotAvailable: true, by: { '05': 'not_bookable', T2: 'too_small', T4: 'available', T6: 'available' } });

    // A request holding T4 from 20:00 blocks it until 21:45 (90 min visit + 15 min buffer)…
    await req(f, { tableId: t4.id });
    expect((await statuses(f, '20:00', 4)).by.T4).toBe('booked');
    expect((await statuses(f, '21:30', 2)).by.T4).toBe('booked'); // starts before 21:45
    expect((await statuses(f, '19:00', 2)).by.T4).toBe('booked'); // 19:00 + 105 min overlaps 20:00
    expect((await statuses(f, '20:00', 4)).by.T6).toBe('available');

    // …until the restaurant refuses it.
    const r = await db.reservation.findFirstOrThrow();
    await changeReservationStatus(f.ctx, { reservationId: r.id, expectedFrom: 'REQUESTED', to: 'REJECTED' });
    expect((await statuses(f, '20:00', 4)).by.T4).toBe('available');

    // A time with no covers left: every table is unavailable, whatever its own state.
    await req(f, { partySize: 8, time: '20:00' }); // 8 of 10 covers, no table chosen
    expect(await statuses(f, '20:00', 4)).toEqual({ slotAvailable: false, by: { '05': 'not_bookable', T2: 'too_small', T4: 'booked', T6: 'booked' } });
  });

  it('tables of inactive areas, inactive tables and other restaurants are never listed', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Other Restaurant');
    const { t6 } = await setup(f);
    await setup(other);
    const terrace = await db.diningArea.create({ data: { organizationId: f.org.id, locationId: f.location.id, name: 'Terrace', isActive: false } });
    await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, areaId: terrace.id, label: 'TT', seats: 4, planX: 100, planY: 100 } });
    await db.restaurantTable.update({ where: { id: t6.id }, data: { isActive: false } });
    expect(Object.keys((await statuses(f, '20:00', 2)).by).sort()).toEqual(['05', 'T2', 'T4']);
  });
});

describe('a table chosen with the request', () => {
  beforeEach(resetDatabase);

  it('is held for the visit plus buffer, shown on the tracking page and to staff, and stays a request', async () => {
    const f = await createOrderingFixture();
    const { t4, t6 } = await setup(f);
    const made = await req(f, { tableId: t4.id });
    expect(made.status).toBe('REQUESTED'); // never confirmed by choosing a table
    const r = await db.reservation.findFirstOrThrow({ include: { assignments: true } });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]).toMatchObject({ tableId: t4.id, startsAt: new Date('2026-11-06T20:00:00Z'), endsAt: new Date('2026-11-06T21:45:00Z') });
    expect((await trackReservation(made.token))?.assignments.map((a) => a.table.label)).toEqual(['T4']);
    expect((await db.notification.findFirstOrThrow({ where: { entityId: r.id } })).title).toContain('table T4');

    // Staff can still move the guest to another table.
    await assignReservationTable(f.ctx, r.id, t6.id);
    await unassignReservationTable(f.ctx, r.id, t4.id);
    expect((await db.reservationTableAssignment.findMany({ where: { reservationId: r.id } })).map((a) => a.tableId)).toEqual([t6.id]);
    expect((await statuses(f, '20:00', 2)).by.T4).toBe('available');
  });

  it('is refused when guests may not choose, the table is too small, has no seat count, is taken or belongs elsewhere', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Other Restaurant');
    const { t2, t4, t6 } = await setup(f);
    const { t4: foreign } = await setup(other);
    await expect(req(f, { tableId: t2.id, partySize: 4 })).rejects.toMatchObject({ code: 'table_too_small' });
    await expect(req(f, { tableId: f.table.id, partySize: 2 })).rejects.toMatchObject({ code: 'table_unavailable' }); // 05: no seat count
    await expect(req(f, { tableId: foreign.id })).rejects.toMatchObject({ code: 'table_unavailable' });
    await req(f, { tableId: t4.id, time: '20:00' });
    await expect(req(f, { tableId: t4.id, time: '21:00', partySize: 2 })).rejects.toMatchObject({ code: 'table_unavailable' });
    await updateGuestTableChoice(f.ctx, { locationId: f.location.id, enabled: false });
    await expect(req(f, { tableId: t6.id })).rejects.toMatchObject({ code: 'table_unavailable' });
    // Without a table the same request still works: the floor plan is optional.
    await expect(req(f, {})).resolves.toMatchObject({ status: 'REQUESTED' });
    expect(await db.reservation.count({ where: { locationId: f.location.id } })).toBe(2);
  });

  it('two guests picking the same table at the same moment: exactly one gets it', async () => {
    const f = await createOrderingFixture();
    const { t4, t6 } = await setup(f, { covers: 20 });
    const same = await Promise.allSettled([1, 2, 3].map(() => req(f, { tableId: t4.id, partySize: 2 })));
    expect(same.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(same.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['table_unavailable', 'table_unavailable']);
    expect(await db.reservationTableAssignment.count({ where: { tableId: t4.id } })).toBe(1);
    expect(await db.reservation.count()).toBe(1); // the refused requests left nothing behind
    // Different tables at the same time do not block each other.
    await expect(req(f, { tableId: t6.id, partySize: 2 })).resolves.toMatchObject({ status: 'REQUESTED' });
  });
});

describe('floor plan editor', () => {
  beforeEach(resetDatabase);

  it('saves positions, shapes and seats of one area; removing only clears the position on that area', async () => {
    const f = await createOrderingFixture();
    const { t2 } = await setup(f);
    const terrace = await db.diningArea.create({ data: { organizationId: f.org.id, locationId: f.location.id, name: 'Terrace' } });
    const saved = await saveFloorPlan(f.ctx, {
      locationId: f.location.id,
      areaId: terrace.id,
      placed: [{ tableId: f.table.id, x: 300, y: 320, shape: 'RECTANGLE', rotation: 90, seats: 6 }],
      removed: [],
    });
    expect(saved).toMatchObject({ areaId: terrace.id, placed: [{ tableId: f.table.id, x: 300 }], removed: [] });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: f.table.id } })).toMatchObject({ areaId: terrace.id, planX: 300, planY: 320, planShape: 'RECTANGLE', planRotation: 90, seats: 6 });
    // "Removed" from the terrace: T2 is not on the terrace, so it keeps its place on the main area.
    await saveFloorPlan(f.ctx, { locationId: f.location.id, areaId: terrace.id, placed: [], removed: [f.table.id, t2.id] });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: f.table.id } })).toMatchObject({ areaId: terrace.id, planX: null, planY: null, seats: 6 });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({ planX: 150, planY: 200 });
    expect(await db.auditLog.count({ where: { organizationId: f.org.id, action: 'tables.floor_plan_saved' } })).toBe(2);
    expect((await floorPlanForEditor(f.ctx, f.location.id)).guestTableChoice).toBe(true);
  });

  it('refuses positions off the canvas, duplicates, foreign tables and areas, and other restaurants', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Other Restaurant');
    const { t2 } = await setup(f);
    const { t4: foreign } = await setup(other);
    const areaId = f.table.areaId!;
    const plan = (placed: unknown[], removed: string[] = [], extra: Record<string, unknown> = {}) => saveFloorPlan(f.ctx, { locationId: f.location.id, areaId, placed, removed, ...extra });
    await expect(plan([{ tableId: t2.id, x: 1200, y: 100, shape: 'ROUND', rotation: 0, seats: 2 }])).rejects.toBeInstanceOf(ZodError);
    await expect(plan([{ tableId: t2.id, x: 100, y: 100, shape: 'ROUND', rotation: 45, seats: 2 }])).rejects.toBeInstanceOf(ZodError);
    await expect(plan([{ tableId: t2.id, x: 100, y: 100, shape: 'ROUND', rotation: 0, seats: 2 }], [t2.id])).rejects.toThrow(/twice/);
    await expect(plan([{ tableId: foreign.id, x: 100, y: 100, shape: 'ROUND', rotation: 0, seats: 2 }])).rejects.toThrow(/do not belong/);
    await expect(plan([], [], { areaId: other.table.areaId })).rejects.toThrow(/not found/);
    // Another restaurant's owner cannot touch this plan at all.
    await expect(saveFloorPlan(other.ctx, { locationId: f.location.id, areaId, placed: [], removed: [] })).rejects.toMatchObject({ reason: 'location' });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ planX: 400, areaId: other.table.areaId });
  });

  it('guests see placed tables per area and, as a list, only unplaced tables that have a seat count', async () => {
    const f = await createOrderingFixture();
    const { t6 } = await setup(f);
    await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label: 'Bar 1', seats: 2 } }); // no area, not placed
    await db.restaurantTable.update({ where: { id: t6.id }, data: { isActive: false } });
    await db.diningArea.create({ data: { organizationId: f.org.id, locationId: f.location.id, name: 'Empty room' } });
    const plan = await guestFloorPlan(f.location.id);
    expect(plan.areas.map((a) => [a.name, a.tables.map((t) => t.label)])).toEqual([['Test area', ['T2', 'T4']]]); // the empty room is not shown
    expect(plan.unplaced.map((t) => t.label)).toEqual(['Bar 1']); // 05 is not placed and has no seat count
    expect(plan.areas[0].tables[0]).toEqual({ id: expect.any(String), label: 'T2', seats: 2, shape: 'ROUND', rotation: 0, x: 150, y: 200 });
  });
});
