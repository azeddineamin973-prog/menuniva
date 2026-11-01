import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { AccessDeniedError } from '@/server/errors';
import { db } from '@/server/db';
import { floorPlanForEditor, guestFloorPlan, removeDiningArea, saveFloorPlan } from '@/server/services/floor-plan';
import {
  assignReservationTable,
  changeReservationStatus,
  requestReservation,
  tableAssignmentMode,
  tableStatuses,
  trackReservation,
  unassignReservationTable,
  updateReservationSettings,
  updateTableAssignment,
  type TableAssignmentMode,
} from '@/server/services/reservations';
import { createTables, saveArea } from '@/server/services/tables';
import { hashToken } from '@/server/crypto';
import { overlappingIds } from '@/lib/floor-plan';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Floor plan builder, for any restaurant: each one draws its own rooms (size, labels) and places
 * its own tables, per location; chooses how tables get onto requests (staff, automatic, guests on
 * the plan); guests see genuine availability and nothing private; conflicts are refused on the
 * server. Several fictional restaurants and locations, nothing shared between them.
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const DINNER = { fri: [{ open: '19:00', close: '23:00' }] };
const NOW = new Date('2026-11-04T10:00:00Z'); // Wednesday morning, Europe/Lisbon (UTC+0)
const FRIDAY = '2026-11-06';

/** Friday dinner bookings; tables T2 (2 seats), T4 (4), T6 (6) on the fixture's area; its table 05 has no seat count. */
async function setup(f: F, { mode = 'guest' as TableAssignmentMode, autoFallback = false, covers = 10 } = {}) {
  await db.restaurantLocation.update({ where: { id: f.location.id }, data: { reservationsEnabled: true } });
  await updateReservationSettings(f.ctx, { locationId: f.location.id, slotMinutes: 30, durationMinutes: 90, bufferMinutes: 15, maxPartySize: 8, maxCoversPerSlot: covers, minNoticeMinutes: 60, maxDaysAhead: 30, bookableHours: JSON.stringify(DINNER) });
  await updateTableAssignment(f.ctx, { locationId: f.location.id, mode, autoFallback });
  const mk = (label: string, seats: number, x: number) =>
    db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, areaId: f.table.areaId, label, seats, planX: x, planY: 200, planShape: 'ROUND', sortOrder: x } });
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
const hashOf = (token: string) => hashToken(token);
/** Tables held by the reservation of this tracking token, with who put them there ("T4:AUTOMATIC"). */
const heldBy = async (token: string) =>
  (await db.reservationTableAssignment.findMany({ where: { reservation: { trackingTokenHash: hashOf(token) } }, include: { table: { select: { label: true } } } })).map((a) => `${a.table.label}:${a.source}`);

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

  it('nothing private: only table ids and statuses, never who booked, for how many or when', async () => {
    const f = await createOrderingFixture();
    const { t4 } = await setup(f);
    await req(f, { tableId: t4.id, name: 'Secret Guest', specialRequest: 'Birthday' });
    const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id }, include: { reservationSettings: true } });
    const result = await tableStatuses(loc, loc.reservationSettings, FRIDAY, '20:00', 2, NOW);
    expect(Object.keys(result).sort()).toEqual(['slotAvailable', 'tables']);
    for (const t of result.tables) expect(Object.keys(t).sort()).toEqual(['id', 'status']);
    expect(JSON.stringify(result)).not.toMatch(/Secret|Birthday|\+351/);
    const plan = await guestFloorPlan(f.location.id);
    expect(JSON.stringify(plan)).not.toMatch(/Secret|Birthday|qr_|token/i);
  });

  it('tables of removed areas, inactive tables and other restaurants are never listed', async () => {
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

describe('a table chosen by the guest', () => {
  beforeEach(resetDatabase);

  it('is held for the visit plus buffer, shown on the tracking page and to staff, and stays a request', async () => {
    const f = await createOrderingFixture();
    const { t4, t6 } = await setup(f);
    const made = await req(f, { tableId: t4.id });
    expect(made.status).toBe('REQUESTED'); // never confirmed by choosing a table
    const r = await db.reservation.findFirstOrThrow({ include: { assignments: true } });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]).toMatchObject({ tableId: t4.id, source: 'GUEST', startsAt: new Date('2026-11-06T20:00:00Z'), endsAt: new Date('2026-11-06T21:45:00Z') });
    expect((await trackReservation(made.token))?.assignments.map((a) => a.table.label)).toEqual(['T4']);
    expect((await db.notification.findFirstOrThrow({ where: { entityId: r.id } })).title).toContain("table T4 (guest's choice)");

    // Staff can still move the guest to another table.
    await assignReservationTable(f.ctx, r.id, t6.id);
    await unassignReservationTable(f.ctx, r.id, t4.id);
    expect(await db.reservationTableAssignment.findMany({ where: { reservationId: r.id }, select: { tableId: true, source: true } })).toEqual([{ tableId: t6.id, source: 'STAFF' }]);
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
    for (const mode of ['staff', 'automatic'] as const) {
      await updateTableAssignment(f.ctx, { locationId: f.location.id, mode });
      await expect(req(f, { tableId: t6.id }), mode).rejects.toMatchObject({ code: 'table_unavailable' });
    }
    // Without a table the same request still works: the floor plan is optional.
    await updateTableAssignment(f.ctx, { locationId: f.location.id, mode: 'staff' });
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

describe('table assignment modes', () => {
  beforeEach(resetDatabase);

  it('the owner chooses: staff assign (default), automatic, or guests choose with or without automatic fallback', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { reservationsEnabled: true } });
    expect(tableAssignmentMode(await db.reservationSettings.findUnique({ where: { locationId: f.location.id } }))).toBe('staff');
    const cases = [
      [{ mode: 'staff' }, { guestTableChoice: false, autoAssignTables: false }],
      [{ mode: 'automatic' }, { guestTableChoice: false, autoAssignTables: true }],
      [{ mode: 'guest', autoFallback: true }, { guestTableChoice: true, autoAssignTables: true }],
      [{ mode: 'guest', autoFallback: false }, { guestTableChoice: true, autoAssignTables: false }],
      // The fallback only exists with guest choice.
      [{ mode: 'automatic', autoFallback: false }, { guestTableChoice: false, autoAssignTables: true }],
      [{ mode: 'staff', autoFallback: true }, { guestTableChoice: false, autoAssignTables: false }],
    ] as const;
    for (const [input, stored] of cases) {
      await updateTableAssignment(f.ctx, { locationId: f.location.id, ...input });
      const s = await db.reservationSettings.findUniqueOrThrow({ where: { locationId: f.location.id } });
      expect({ guestTableChoice: s.guestTableChoice, autoAssignTables: s.autoAssignTables }, JSON.stringify(input)).toEqual(stored);
      expect(tableAssignmentMode(s)).toBe(input.mode);
    }
    await expect(updateTableAssignment(f.ctx, { locationId: f.location.id, mode: 'random' })).rejects.toBeInstanceOf(ZodError);
    expect(await db.auditLog.count({ where: { organizationId: f.org.id, action: 'reservations.table_assignment' } })).toBe(cases.length);
  });

  it('automatic: the smallest free table that seats the party, held until the restaurant confirms; guests see it only once confirmed', async () => {
    const f = await createOrderingFixture();
    const { t4 } = await setup(f, { mode: 'automatic', covers: 30 });
    const first = await req(f, { partySize: 3 }); // T2 too small, T4 fits best
    expect(await heldBy(first.token)).toEqual(['T4:AUTOMATIC']);
    const second = await req(f, { partySize: 3, time: '20:30' }); // T4 held until 21:45 → T6
    expect(await heldBy(second.token)).toEqual(['T6:AUTOMATIC']);
    const third = await req(f, { partySize: 2, time: '21:00' }); // T2 is free
    expect(await heldBy(third.token)).toEqual(['T2:AUTOMATIC']);
    // Nothing left that seats 4 at 21:00: the request is still taken, without a table.
    const fourth = await req(f, { partySize: 4, time: '21:00' });
    expect(await heldBy(fourth.token)).toEqual([]);
    const r4 = await db.reservation.findFirstOrThrow({ where: { trackingTokenHash: hashOf(fourth.token) } });
    expect((await db.notification.findFirstOrThrow({ where: { entityId: r4.id } })).title).toContain('no free table fits');
    // The guest does not see an automatic table while it is a request…
    expect((await trackReservation(first.token))?.assignments).toEqual([]);
    // …but does once the restaurant confirms it.
    const r1 = await db.reservation.findFirstOrThrow({ where: { trackingTokenHash: hashOf(first.token) } });
    await changeReservationStatus(f.ctx, { reservationId: r1.id, expectedFrom: 'REQUESTED', to: 'CONFIRMED' });
    expect((await trackReservation(first.token))?.assignments.map((a) => a.table.label)).toEqual(['T4']);
    // The held table really is blocked for others: a guest choosing it at that time is refused.
    await updateTableAssignment(f.ctx, { locationId: f.location.id, mode: 'guest' });
    await expect(req(f, { tableId: t4.id, partySize: 2, time: '20:00' })).rejects.toMatchObject({ code: 'table_unavailable' });
  });

  it('staff mode assigns nothing; guest mode assigns automatically only with the fallback on', async () => {
    const f = await createOrderingFixture();
    await setup(f, { mode: 'staff' });
    expect(await heldBy((await req(f, { partySize: 2 })).token)).toEqual([]);
    await updateTableAssignment(f.ctx, { locationId: f.location.id, mode: 'guest', autoFallback: false });
    expect(await heldBy((await req(f, { partySize: 2, time: '19:00' })).token)).toEqual([]);
    await updateTableAssignment(f.ctx, { locationId: f.location.id, mode: 'guest', autoFallback: true });
    expect(await heldBy((await req(f, { partySize: 2, time: '21:30' })).token)).toEqual(['T2:AUTOMATIC']);
  });

  it('simultaneous automatic requests never share a table, and neither does staff assigning at the same moment', async () => {
    const f = await createOrderingFixture();
    const { t2 } = await setup(f, { mode: 'automatic', covers: 40 });
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => req(f, { partySize: 2 })));
    const held = (await Promise.all(tokens.map((t) => heldBy(t.token)))).flat();
    expect(held.sort()).toEqual(['T2:AUTOMATIC', 'T4:AUTOMATIC', 'T6:AUTOMATIC']); // 3 tables seat 2; two requests wait for staff
    // Staff give T2 to a walk-in booking while another automatic request comes in: one of them gets it.
    await db.reservationTableAssignment.deleteMany({ where: { tableId: t2.id } });
    const waiting = await db.reservation.findFirstOrThrow({ where: { assignments: { none: {} } } });
    await Promise.allSettled([assignReservationTable(f.ctx, waiting.id, t2.id), req(f, { partySize: 2 })]);
    const onT2 = await db.reservationTableAssignment.findMany({ where: { tableId: t2.id, reservation: { status: { in: ['REQUESTED', 'CONFIRMED', 'ARRIVED'] } } } });
    expect(onT2).toHaveLength(1);
  });
});

describe('floor plan builder', () => {
  beforeEach(resetDatabase);

  it('saves the room size, labels, positions, shapes and seats of one area; removing only clears the position on that area', async () => {
    const f = await createOrderingFixture();
    const { t2 } = await setup(f);
    const terrace = await saveArea(f.ctx, { locationId: f.location.id, name: 'Terrace' });
    const saved = await saveFloorPlan(f.ctx, {
      locationId: f.location.id,
      areaId: terrace.id,
      placed: [{ tableId: f.table.id, x: 300, y: 320, shape: 'RECTANGLE', rotation: 90, seats: 6 }],
      removed: [],
      room: { width: 1400, height: 500 },
      labels: [
        { id: 'door', text: 'Entrance', x: 60, y: 30 },
        { id: 'bar1', text: '<b>Bar</b>', x: 1300, y: 250 },
      ],
    });
    expect(saved).toMatchObject({ areaId: terrace.id, room: { width: 1400, height: 500 }, labels: [{ id: 'door' }, { id: 'bar1' }] });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: f.table.id } })).toMatchObject({ areaId: terrace.id, planX: 300, planY: 320, planShape: 'RECTANGLE', planRotation: 90, seats: 6 });
    const editor = await floorPlanForEditor(f.ctx, f.location.id);
    expect(editor.areas.find((a) => a.id === terrace.id)).toEqual({ id: terrace.id, name: 'Terrace', width: 1400, height: 500, labels: [{ id: 'door', text: 'Entrance', x: 60, y: 30 }, { id: 'bar1', text: '<b>Bar</b>', x: 1300, y: 250 }] });
    // "Removed" from the terrace: T2 is not on the terrace, so it keeps its place on the main area.
    await saveFloorPlan(f.ctx, { locationId: f.location.id, areaId: terrace.id, placed: [], removed: [f.table.id, t2.id], labels: [] });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: f.table.id } })).toMatchObject({ areaId: terrace.id, planX: null, planY: null, seats: 6 });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({ planX: 150, planY: 200 });
    expect(await db.diningArea.findUniqueOrThrow({ where: { id: terrace.id } })).toMatchObject({ planWidth: 1400, planHeight: 500, planLabels: null });
    expect(await db.auditLog.count({ where: { organizationId: f.org.id, action: 'tables.floor_plan_saved' } })).toBe(2);
  });

  it('refuses tables and labels outside the room, a room shrunk around tables, duplicates and too many labels', async () => {
    const f = await createOrderingFixture();
    const { t2, t6 } = await setup(f); // T6 stands at x = 700
    const areaId = f.table.areaId!;
    const plan = (extra: Record<string, unknown>) => saveFloorPlan(f.ctx, { locationId: f.location.id, areaId, placed: [], removed: [], ...extra });
    const at = (x: number) => [{ tableId: t2.id, x, y: 100, shape: 'ROUND', rotation: 0, seats: 2 }];
    await expect(plan({ placed: at(950), room: { width: 600, height: 640 } })).rejects.toThrow(/outside the room/);
    await expect(plan({ room: { width: 600, height: 640 } })).rejects.toThrow(/outside the room/); // T6 would be outside
    await expect(plan({ room: { width: 300, height: 640 } })).rejects.toBeInstanceOf(ZodError); // below the minimum room
    await expect(plan({ labels: [{ id: 'a', text: 'Door', x: 1200, y: 10 }] })).rejects.toThrow(/label is outside/);
    await expect(plan({ labels: [{ id: 'a', text: 'Door', x: 10, y: 10 }, { id: 'a', text: 'Bar', x: 20, y: 20 }] })).rejects.toThrow(/twice/);
    await expect(plan({ labels: [{ id: 'a', text: 'x'.repeat(41), x: 10, y: 10 }] })).rejects.toBeInstanceOf(ZodError);
    await expect(plan({ labels: Array.from({ length: 41 }, (_, i) => ({ id: `l${i}`, text: 'Door', x: 10, y: 10 })) })).rejects.toBeInstanceOf(ZodError);
    await expect(plan({ placed: [{ tableId: t2.id, x: 100, y: 100, shape: 'ROUND', rotation: 45, seats: 2 }] })).rejects.toBeInstanceOf(ZodError);
    await expect(plan({ placed: at(100), removed: [t2.id] })).rejects.toThrow(/twice/);
    // Nothing of the refused saves was stored.
    expect(await db.diningArea.findUniqueOrThrow({ where: { id: areaId } })).toMatchObject({ planWidth: 1000, planHeight: 640, planLabels: null });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({ planX: 150 });
    // Moving T6 inside in the same save makes the smaller room valid (T4 at x 400 is already inside).
    await plan({ placed: [{ tableId: t6.id, x: 400, y: 450, shape: 'ROUND', rotation: 0, seats: 6 }], room: { width: 600, height: 640 } });
    expect(await db.diningArea.findUniqueOrThrow({ where: { id: areaId } })).toMatchObject({ planWidth: 600, planHeight: 640 });
  });

  it('refuses foreign tables and areas; another restaurant cannot touch the plan', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Other Restaurant');
    const { t2 } = await setup(f);
    const { t4: foreign } = await setup(other);
    const areaId = f.table.areaId!;
    const plan = (placed: unknown[], extra: Record<string, unknown> = {}) => saveFloorPlan(f.ctx, { locationId: f.location.id, areaId, placed, removed: [], ...extra });
    await expect(plan([{ tableId: foreign.id, x: 100, y: 100, shape: 'ROUND', rotation: 0, seats: 2 }])).rejects.toThrow(/do not belong/);
    await expect(plan([], { areaId: other.table.areaId })).rejects.toThrow(/not found/);
    await expect(saveFloorPlan(other.ctx, { locationId: f.location.id, areaId, placed: [], removed: [] })).rejects.toMatchObject({ reason: 'location' });
    await expect(removeDiningArea(other.ctx, { locationId: other.location.id, areaId })).rejects.toThrow(/not found/);
    await expect(saveArea(other.ctx, { id: areaId, locationId: other.location.id, name: 'Hacked' })).rejects.toThrow(/not found/);
    await expect(floorPlanForEditor(other.ctx, f.location.id)).rejects.toMatchObject({ reason: 'location' });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ planX: 400, areaId: other.table.areaId });
    expect(await db.diningArea.findUniqueOrThrow({ where: { id: areaId } })).toMatchObject({ name: 'Test area', isActive: true });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({ areaId, planX: 150 });
  });

  it('guests see each placed table, the room and its labels; the list offers only unplaced tables with a seat count; bad stored labels are ignored', async () => {
    const f = await createOrderingFixture();
    const { t6 } = await setup(f);
    await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label: 'Bar 1', seats: 2 } }); // no area, not placed
    await db.restaurantTable.update({ where: { id: t6.id }, data: { isActive: false } });
    await db.diningArea.create({ data: { organizationId: f.org.id, locationId: f.location.id, name: 'Empty room' } });
    await db.diningArea.update({ where: { id: f.table.areaId! }, data: { planWidth: 1200, planHeight: 700, planLabels: [{ id: 'ok', text: 'Window', x: 600, y: 20 }, { id: 'bad', text: '', x: -5 }, 'nonsense'] } });
    const plan = await guestFloorPlan(f.location.id);
    expect(plan.areas.map((a) => [a.name, a.tables.map((t) => t.label)])).toEqual([['Test area', ['T2', 'T4']]]); // the empty room is not shown
    expect(plan.areas[0]).toMatchObject({ width: 1200, height: 700, labels: [{ id: 'ok', text: 'Window', x: 600, y: 20 }] });
    expect(plan.unplaced.map((t) => t.label)).toEqual(['Bar 1']); // 05 is not placed and has no seat count
    expect(plan.areas[0].tables[0]).toEqual({ id: expect.any(String), label: 'T2', seats: 2, shape: 'ROUND', rotation: 0, x: 150, y: 200 });
  });

  it('removing an area keeps its tables (seats, QR codes, reservations) bookable, just off the plan', async () => {
    const f = await createOrderingFixture();
    const { t4 } = await setup(f, { mode: 'automatic' });
    const booked = await req(f, { partySize: 4 });
    expect(await heldBy(booked.token)).toEqual(['T4:AUTOMATIC']);
    const areaId = f.table.areaId!;
    expect(await removeDiningArea(f.ctx, { locationId: f.location.id, areaId })).toEqual({ tables: 4 });
    expect(await db.diningArea.findUniqueOrThrow({ where: { id: areaId } })).toMatchObject({ isActive: false });
    expect(await db.restaurantTable.findUniqueOrThrow({ where: { id: t4.id } })).toMatchObject({ areaId: null, planX: null, planY: null, seats: 4, isActive: true });
    expect(await db.tableQRToken.findMany({ where: { tableId: f.table.id }, select: { isActive: true } })).toEqual([{ isActive: true }]); // the printed QR code still works
    expect(await heldBy(booked.token)).toEqual(['T4:AUTOMATIC']); // the existing reservation keeps its table
    const plan = await guestFloorPlan(f.location.id);
    expect(plan.areas).toEqual([]);
    expect(plan.unplaced.map((t) => t.label).sort()).toEqual(['T2', 'T4', 'T6']);
    expect((await floorPlanForEditor(f.ctx, f.location.id)).areas).toEqual([]);
    // Still bookable: automatic assignment finds T6 for the next party of 4.
    expect(await heldBy((await req(f, { partySize: 4 })).token)).toEqual(['T6:AUTOMATIC']);
    await expect(removeDiningArea(f.ctx, { locationId: f.location.id, areaId })).rejects.toThrow(/not found/);
    expect(await db.auditLog.count({ where: { organizationId: f.org.id, action: 'tables.area_removed' } })).toBe(1);
  });

  it('tables added from the builder are drawn in free spots of that room, within the plan limit', async () => {
    const f = await createOrderingFixture();
    await setup(f);
    const areaId = f.table.areaId!;
    await db.diningArea.update({ where: { id: areaId }, data: { planWidth: 1200, planHeight: 800 } });
    await createTables(f.ctx, { locationId: f.location.id, areaId, labels: ['N1', 'N2', 'N3', 'N4'], seats: 4, shape: 'SQUARE', place: true });
    const all = await db.restaurantTable.findMany({ where: { areaId, planX: { not: null } } });
    const added = all.filter((t) => t.label.startsWith('N'));
    expect(added.map((t) => t.planShape)).toEqual(['SQUARE', 'SQUARE', 'SQUARE', 'SQUARE']);
    for (const t of added) {
      expect(t.planX! > 0 && t.planX! < 1200 && t.planY! > 0 && t.planY! < 800).toBe(true);
    }
    expect(overlappingIds(all.map((t) => ({ id: t.id, x: t.planX!, y: t.planY!, shape: t.planShape, seats: t.seats, rotation: t.planRotation })))).toEqual(new Set());
    await expect(createTables(f.ctx, { locationId: f.location.id, labels: ['N9'], place: true })).rejects.toThrow(/Choose the dining area/);
  });
});

describe('every restaurant and location has its own floor plan', () => {
  beforeEach(resetDatabase);

  it('two locations of one restaurant and a second restaurant: plans, booking maps and access never mix', async () => {
    const a = await createOrderingFixture('Bistro Alfa');
    const b = await createOrderingFixture('Tasca Beta');
    await setup(a);
    await setup(b);
    // Bistro Alfa opens a second location with its own room and tables.
    const second = await db.restaurantLocation.create({ data: { organizationId: a.org.id, name: 'Alfa Porto', slug: 'porto', isPublished: true, reservationsEnabled: true } });
    const rooftop = await saveArea(a.ctx, { locationId: second.id, name: 'Rooftop' });
    await createTables(a.ctx, { locationId: second.id, areaId: rooftop.id, labels: ['R1', 'R2'], seats: 2, place: true });
    await saveFloorPlan(a.ctx, { locationId: second.id, areaId: rooftop.id, placed: [], removed: [], room: { width: 800, height: 500 }, labels: [{ id: 'view', text: 'River view', x: 400, y: 30 }] });

    const plans = await Promise.all([guestFloorPlan(a.location.id), guestFloorPlan(second.id), guestFloorPlan(b.location.id)]);
    // (The fixtures' table 05 is not placed on a plan.)
    expect(plans.map((p) => p.areas.flatMap((x) => x.tables.map((t) => t.label)).sort())).toEqual([['T2', 'T4', 'T6'], ['R1', 'R2'], ['T2', 'T4', 'T6']]);
    expect(plans[1].areas[0]).toMatchObject({ name: 'Rooftop', width: 800, height: 500, labels: [{ text: 'River view' }] });
    const tableIds = plans.map((p) => new Set(p.areas.flatMap((x) => x.tables.map((t) => t.id))));
    expect([...tableIds[0]].some((id) => tableIds[1].has(id) || tableIds[2].has(id))).toBe(false);

    // Each location keeps its own booking mode.
    await updateTableAssignment(a.ctx, { locationId: second.id, mode: 'automatic' });
    expect(tableAssignmentMode(await db.reservationSettings.findUnique({ where: { locationId: a.location.id } }))).toBe('guest');
    expect(tableAssignmentMode(await db.reservationSettings.findUnique({ where: { locationId: second.id } }))).toBe('automatic');

    // A manager restricted to the first location cannot see or change the second one's plan.
    const restricted = { ...a.ctx, locationIds: [a.location.id] };
    await expect(floorPlanForEditor(restricted, second.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(saveFloorPlan(restricted, { locationId: second.id, areaId: rooftop.id, placed: [], removed: [] })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(removeDiningArea(restricted, { locationId: second.id, areaId: rooftop.id })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(updateTableAssignment(restricted, { locationId: second.id, mode: 'staff' })).rejects.toBeInstanceOf(AccessDeniedError);
    // An area of one location cannot be saved through another location of the same restaurant.
    await expect(saveFloorPlan(a.ctx, { locationId: a.location.id, areaId: rooftop.id, placed: [], removed: [] })).rejects.toThrow(/not found/);
    // Tasca Beta's owner reaches neither location of Bistro Alfa.
    for (const loc of [a.location.id, second.id]) await expect(floorPlanForEditor(b.ctx, loc)).rejects.toMatchObject({ reason: 'location' });
    expect((await floorPlanForEditor(b.ctx, b.location.id)).tables.map((t) => t.label).sort()).toEqual(['05', 'T2', 'T4', 'T6']);
  });
});
