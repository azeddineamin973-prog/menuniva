import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { LanguageCode, ReservationStatus } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { LANGUAGES } from '@/i18n/config';
import { naturalCompare, type TableStatus } from '@/lib/floor-plan';
import { rangesFor, type OpeningHours } from '@/lib/opening-hours';
import { openingHoursSchema } from '@/lib/opening-hours-schema';
import { zonedParts, zonedTimeToUtc } from '@/lib/time';
import { audit, logError } from '../audit';
import { hashToken } from '../crypto';
import { db, type Tx } from '../db';
import { assertModule, hasModule } from '../modules';
import { env } from '../env';
import { UserFacingError } from '../errors';
import { asIdentity, type ClientIdentity } from '../client-identity';
import { assertBelowLimit, countSuccess, limitPublic } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';

/** Reservations that occupy capacity / tables. */
export const HOLDING: ReservationStatus[] = ['REQUESTED', 'CONFIRMED', 'ARRIVED'];

const TRANSITIONS: Partial<Record<ReservationStatus, ReservationStatus[]>> = {
  REQUESTED: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['ARRIVED', 'NO_SHOW', 'CANCELLED'],
  ARRIVED: ['COMPLETED'],
};

type Settings = {
  slotMinutes: number;
  durationMinutes: number;
  bufferMinutes: number;
  maxPartySize: number;
  maxCoversPerSlot: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  bookableHours: unknown;
  guestTableChoice?: boolean;
  autoAssignTables?: boolean;
};
const DEFAULTS: Settings = { slotMinutes: 30, durationMinutes: 90, bufferMinutes: 15, maxPartySize: 8, maxCoversPerSlot: 20, minNoticeMinutes: 60, maxDaysAhead: 60, bookableHours: null, guestTableChoice: false, autoAssignTables: false };

// ------------------------------------------------------------------ settings (M10-05)

export const reservationSettingsSchema = z.object({
  locationId: z.string().min(1),
  slotMinutes: z.coerce.number().int().refine((n) => [15, 30, 60].includes(n), 'invalid_slot'),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  bufferMinutes: z.coerce.number().int().min(0).max(120),
  maxPartySize: z.coerce.number().int().min(1).max(100),
  maxCoversPerSlot: z.coerce.number().int().min(1).max(2000),
  minNoticeMinutes: z.coerce.number().int().min(0).max(10080),
  maxDaysAhead: z.coerce.number().int().min(1).max(365),
  bookableHours: z.preprocess((v) => (typeof v === 'string' && v ? JSON.parse(v) : null), openingHoursSchema.nullable()),
});

export async function updateReservationSettings(ctx: TenantContext, input: unknown) {
  await assertModule(ctx.org.id, 'reservations');
  const d = reservationSettingsSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const { locationId, bookableHours, ...rest } = d;
  const data = { ...rest, bookableHours: bookableHours ?? Prisma.DbNull };
  await db.reservationSettings.upsert({ where: { locationId }, update: data, create: { locationId, ...data } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'reservations.settings_updated', entityType: 'RestaurantLocation', entityId: locationId, metadata: rest });
}

/**
 * How tables get onto online requests, per location:
 * - `staff` (default): guests choose a time; staff assign tables.
 * - `automatic`: each request holds the smallest free table that fits, until staff confirm or change it.
 * - `guest`: guests may pick a free table on the floor plan; a request without a pick is assigned
 *   automatically when `autoFallback` is on, otherwise by staff.
 * Every request stays a request: the restaurant confirms it.
 */
export const TABLE_ASSIGNMENT_MODES = ['staff', 'automatic', 'guest'] as const;
export type TableAssignmentMode = (typeof TABLE_ASSIGNMENT_MODES)[number];
export function tableAssignmentMode(s: { guestTableChoice?: boolean; autoAssignTables?: boolean } | null | undefined): TableAssignmentMode {
  return s?.guestTableChoice ? 'guest' : s?.autoAssignTables ? 'automatic' : 'staff';
}

export async function updateTableAssignment(ctx: TenantContext, input: unknown) {
  await assertModule(ctx.org.id, 'reservations');
  const d = z.object({ locationId: z.string().min(1), mode: z.enum(TABLE_ASSIGNMENT_MODES), autoFallback: z.boolean().default(true) }).parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const data = { guestTableChoice: d.mode === 'guest', autoAssignTables: d.mode === 'automatic' || (d.mode === 'guest' && d.autoFallback) };
  await db.reservationSettings.upsert({ where: { locationId: d.locationId }, update: data, create: { locationId: d.locationId, ...data } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'reservations.table_assignment', entityType: 'RestaurantLocation', entityId: d.locationId, metadata: { mode: d.mode, ...data } });
  return { mode: d.mode, ...data };
}

// ------------------------------------------------------------------ availability (M10-06)

export type Slot = { time: string; startsAt: string; available: boolean };
export type Availability = { slots: Slot[]; reason: 'ok' | 'hours_not_configured' | 'party_too_large' | 'date_out_of_range' | 'closed' };

function dayBounds(dateStr: string, tz: string) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const start = zonedTimeToUtc(y, mo, d, 0, 0, tz);
  const next = zonedTimeToUtc(y, mo, d + 1, 0, 0, tz); // Date.UTC rolls over months; DST-safe
  return { y, mo, d, weekday: zonedParts(zonedTimeToUtc(y, mo, d, 12, 0, tz), tz).weekday, start, next, end: new Date(next.getTime() + 12 * 3600_000) };
}

/**
 * Bookable start times for one date. Capacity counts guests of every reservation that is
 * requested, confirmed or arrived and overlaps the visit (duration). Never shows a time
 * outside the restaurant's configured hours, and nothing at all if hours are not configured.
 */
export async function availability(
  tx: Tx | typeof db,
  location: { id: string; timeZone: string; openingHours: unknown },
  settings: Settings | null,
  dateStr: string,
  partySize: number,
  now = new Date(),
): Promise<Availability> {
  const s = settings ?? DEFAULTS;
  const hours = (s.bookableHours ?? location.openingHours ?? null) as OpeningHours | null;
  if (!hours) return { slots: [], reason: 'hours_not_configured' };
  if (partySize > s.maxPartySize) return { slots: [], reason: 'party_too_large' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { slots: [], reason: 'date_out_of_range' };
  const day = dayBounds(dateStr, location.timeZone);
  const today = zonedParts(now, location.timeZone);
  const todayStart = zonedTimeToUtc(today.year, today.month, today.day, 0, 0, location.timeZone);
  const diffDays = Math.round((day.start.getTime() - todayStart.getTime()) / 86400_000);
  if (diffDays < 0 || diffDays > s.maxDaysAhead) return { slots: [], reason: 'date_out_of_range' };
  const ranges = rangesFor(hours, day.weekday);
  if (!ranges.length) return { slots: [], reason: 'closed' };
  const existing = await tx.reservation.findMany({ where: { locationId: location.id, status: { in: HOLDING }, startsAt: { lt: day.end }, endsAt: { gt: day.start } }, select: { startsAt: true, endsAt: true, partySize: true } });
  const earliest = now.getTime() + s.minNoticeMinutes * 60_000;
  const slots: Slot[] = [];
  for (const [o, c] of ranges) {
    for (let m = Math.ceil(o / s.slotMinutes) * s.slotMinutes; m + s.durationMinutes <= c; m += s.slotMinutes) {
      const startsAt = zonedTimeToUtc(day.y, day.mo, day.d, Math.floor(m / 60), m % 60, location.timeZone);
      if (startsAt.getTime() < earliest) continue;
      const ends = startsAt.getTime() + s.durationMinutes * 60_000;
      const covers = existing.filter((r) => r.startsAt.getTime() < ends && r.endsAt.getTime() > startsAt.getTime()).reduce((n, r) => n + r.partySize, 0);
      const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
      slots.push({ time: `${hh}:${String(m % 60).padStart(2, '0')}`, startsAt: startsAt.toISOString(), available: covers + partySize <= s.maxCoversPerSlot });
    }
  }
  return { slots, reason: 'ok' };
}

/**
 * What each table offers a guest at one start time (the booking floor plan). A table is free when no
 * requested, confirmed or arrived reservation holds it during the visit plus the table buffer (the
 * same window staff assignment checks). When the time itself is full, no table is offered. Tables
 * without a seat count are never offered online: MenuNiva does not guess capacities.
 */
export async function tableStatuses(location: { id: string; timeZone: string; openingHours: unknown }, settings: Settings | null, dateStr: string, time: string, partySize: number, now = new Date()) {
  const s = settings ?? DEFAULTS;
  const [av, tables] = await Promise.all([availability(db, location, settings, dateStr, partySize, now), db.restaurantTable.findMany({ where: bookableTables(location.id), select: { id: true, seats: true } })]);
  const slot = av.reason === 'ok' ? av.slots.find((x) => x.time === time) : undefined;
  const fixed = (t: { seats: number | null }): TableStatus | null => (t.seats === null ? 'not_bookable' : t.seats < partySize ? 'too_small' : null);
  if (!slot?.available) return { slotAvailable: false, tables: tables.map((t) => ({ id: t.id, status: fixed(t) ?? ('booked' as TableStatus) })) };
  const start = new Date(slot.startsAt);
  const end = new Date(start.getTime() + (s.durationMinutes + s.bufferMinutes) * 60_000);
  const busy = await busyTables(db, tables.map((t) => t.id), start, end);
  // Only the table and whether it can be booked: never who booked it, for how many, or when.
  return { slotAvailable: true, tables: tables.map((t) => ({ id: t.id, status: fixed(t) ?? ((busy.has(t.id) ? 'booked' : 'available') as TableStatus) })) };
}

/** Tables a location can take reservations on: active, and not in a removed dining area. */
const bookableTables = (locationId: string) => ({ locationId, isActive: true, OR: [{ areaId: null }, { area: { isActive: true } }] });

/** Tables held by a requested, confirmed or arrived reservation during [start, end). */
async function busyTables(client: Tx | typeof db, tableIds: string[], start: Date, end: Date) {
  if (!tableIds.length) return new Set<string>();
  const rows = await client.reservationTableAssignment.findMany({ where: { tableId: { in: tableIds }, reservation: { status: { in: HOLDING } }, startsAt: { lt: end }, endsAt: { gt: start } }, select: { tableId: true } });
  return new Set(rows.map((r) => r.tableId));
}

/**
 * Automatic assignment: the smallest free table that seats the party (then by dining area and
 * table order), checked again under the table's lock so staff assigning at the same moment cannot
 * double-book it. Tables without a seat count are never picked. Null when nothing fits.
 */
async function pickFreeTable(tx: Tx, locationId: string, partySize: number, start: Date, end: Date) {
  const candidates = await tx.restaurantTable.findMany({
    where: { ...bookableTables(locationId), seats: { gte: partySize } },
    select: { id: true, label: true, seats: true, sortOrder: true, area: { select: { sortOrder: true } } },
  });
  candidates.sort((a, b) => a.seats! - b.seats! || (a.area?.sortOrder ?? 1e6) - (b.area?.sortOrder ?? 1e6) || a.sortOrder - b.sortOrder || naturalCompare(a.label, b.label));
  const busy = await busyTables(tx, candidates.map((c) => c.id), start, end);
  for (const t of candidates) {
    if (busy.has(t.id)) continue;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'table:' + t.id}))`;
    if (!(await busyTables(tx, [t.id], start, end)).has(t.id)) return { id: t.id, label: t.label };
  }
  return null;
}

// ------------------------------------------------------------------ guest request (M10-07)

export const reservationRequestSchema = z.object({
  orgSlug: z.string().max(60),
  locationSlug: z.string().max(60).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.coerce.number().int().min(1).max(100),
  name: z.string().trim().min(2, 'required').max(80),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'invalid_phone'),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().email().max(254).optional()),
  specialRequest: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
  language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]),
  /** A table the guest chose on the floor plan (only when the restaurant allows it). */
  tableId: z.string().min(1).max(40).optional(),
});

export function reservationTokenFor(locationId: string, key: string) {
  return createHmac('sha256', env.APP_SECRET).update(`reservation:${locationId}:${key}`).digest('base64url').slice(0, 32);
}

export class ReservationRejectedError extends UserFacingError {
  constructor(code: string) {
    super(code, 422);
  }
}

/**
 * A guest REQUESTS a reservation; the restaurant confirms it. Availability is re-checked
 * inside a transaction holding a per-location lock, so two guests cannot take the last seats.
 */
export async function requestReservation(input: unknown, client: string | ClientIdentity, now = new Date()) {
  const d = reservationRequestSchema.parse(input);
  const org = await db.restaurantOrganization.findUnique({ where: { slug: d.orgSlug } });
  if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED') throw new ReservationRejectedError('not_found');
  if (!(await hasModule(org.id, 'reservations'))) throw new ReservationRejectedError('module_not_available');
  const location = await db.restaurantLocation.findFirst({ where: { organizationId: org.id, isPublished: true, reservationsEnabled: true, ...(d.locationSlug ? { slug: d.locationSlug } : {}) }, include: { reservationSettings: true }, orderBy: { createdAt: 'asc' } });
  if (!location) throw new ReservationRejectedError('not_found');
  const token = reservationTokenFor(location.id, d.idempotencyKey);
  const existing = await db.reservation.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: d.idempotencyKey } } });
  if (existing) return { token, status: existing.status, duplicate: true };
  // A request holds seats until the restaurant answers, so requests are capped per day: per trusted
  // IP (every attempt) and per phone number (requests made, from any device); the location cap
  // counts only requests that were made. One person cannot fill a restaurant's evening.
  const countForLocation = await limitPublic(`reservation:${location.id}`, asIdentity(client), { guest: [5, 3600], ip: [RESERVATION_LIMITS.ipPerDay, 86400], scope: { key: 'location', limit: [200, 3600] } });
  const phoneKey = `reservation:phone:${location.id}:${d.phone.replace(/\D/g, '')}`;
  await assertBelowLimit(phoneKey, RESERVATION_LIMITS.phonePerDay, 86400);
  const s = location.reservationSettings ?? DEFAULTS;
  const made = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'res:' + location.id}))`;
    const av = await availability(tx, location, location.reservationSettings, d.date, d.partySize, now);
    if (av.reason !== 'ok') throw new ReservationRejectedError(av.reason);
    const slot = av.slots.find((x) => x.time === d.time);
    if (!slot || !slot.available) throw new ReservationRejectedError('slot_unavailable');
    const startsAt = new Date(slot.startsAt);
    // A table chosen on the floor plan (or picked automatically) is held with the request, in the
    // same window and under the same lock as staff assignment, so two requests cannot hold one
    // table for overlapping visits. It is still a request: staff confirm it, and can change the table.
    let table: { id: string; label: string; source: 'GUEST' | 'AUTOMATIC' } | null = null;
    const tableEnd = new Date(startsAt.getTime() + (s.durationMinutes + s.bufferMinutes) * 60_000);
    if (d.tableId) {
      if (!location.reservationSettings?.guestTableChoice) throw new ReservationRejectedError('table_unavailable');
      const t = await tx.restaurantTable.findFirst({ where: { id: d.tableId, ...bookableTables(location.id) }, select: { id: true, label: true, seats: true } });
      if (!t || t.seats === null) throw new ReservationRejectedError('table_unavailable');
      if (t.seats < d.partySize) throw new ReservationRejectedError('table_too_small');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'table:' + t.id}))`;
      if ((await busyTables(tx, [t.id], startsAt, tableEnd)).has(t.id)) throw new ReservationRejectedError('table_unavailable');
      table = { id: t.id, label: t.label, source: 'GUEST' };
    } else if (location.reservationSettings?.autoAssignTables) {
      const t = await pickFreeTable(tx, location.id, d.partySize, startsAt, tableEnd);
      if (t) table = { ...t, source: 'AUTOMATIC' };
    }
    const r = await tx.reservation.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + s.durationMinutes * 60_000),
        partySize: d.partySize,
        name: d.name,
        phone: d.phone,
        email: d.email ?? null,
        specialRequest: d.specialRequest || null,
        language: d.language,
        trackingTokenHash: hashToken(token),
        idempotencyKey: d.idempotencyKey,
      },
    });
    if (table) await tx.reservationTableAssignment.create({ data: { reservationId: r.id, tableId: table.id, startsAt, endsAt: tableEnd, source: table.source } });
    const tableNote = table ? ` — table ${table.label} (${table.source === 'GUEST' ? "guest's choice" : 'automatic'})` : location.reservationSettings?.autoAssignTables ? ' — no free table fits, assign one' : '';
    await tx.notification.create({ data: { organizationId: org.id, locationId: location.id, type: 'RESERVATION_REQUEST', title: `Reservation request: ${d.partySize} guests ${d.date} ${d.time}${tableNote}`, entityId: r.id } });
    return { token, status: r.status, duplicate: false };
  });
  // The request exists: a failure to count it must not turn the guest's success into an error.
  await Promise.all([countForLocation(), countSuccess(phoneKey, RESERVATION_LIMITS.phonePerDay, 86400)]).catch((e) => logError('rate-limit-count', e));
  return made;
}

/** Daily caps on reservation requests for one location (see requestReservation). */
export const RESERVATION_LIMITS = { ipPerDay: 10, phonePerDay: 3 } as const;

export async function trackReservation(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await db.reservation.findUnique({
    where: { trackingTokenHash: hashToken(token) },
    select: {
      startsAt: true,
      partySize: true,
      status: true,
      language: true,
      assignments: { select: { source: true, table: { select: { label: true } } } },
      location: { select: { name: true, timeZone: true, phone: true, organization: { select: { name: true, slug: true } } } },
    },
  });
  if (!r) return null;
  // The guest sees the table they picked themselves at once; a table the restaurant (or automatic
  // assignment) holds only once the reservation is confirmed, since it may still change.
  const settled = r.status === 'CONFIRMED' || r.status === 'ARRIVED' || r.status === 'COMPLETED';
  return { ...r, assignments: r.assignments.filter((a) => settled || (a.source === 'GUEST' && r.status === 'REQUESTED')).map((a) => ({ table: a.table })) };
}

/** How close to the booking a guest may still cancel online. Inside this, they must call. */
export const GUEST_CANCEL_NOTICE_MINUTES = 60;

/**
 * Lets the guest who holds the private link cancel their own reservation, which frees the
 * capacity for everyone else. Only possible while the booking is still ahead of us by the notice
 * period: cancelling a table five minutes before the sitting is a phone call, not a web form.
 *
 * The token is the authorisation — it is unguessable and only the guest has it — and only this
 * one reservation can ever be reached with it.
 */
export async function cancelReservationByToken(token: string, client: string | ClientIdentity, now = new Date()): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'too_late' | 'not_cancellable' }> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: 'not_found' };
  const hash = hashToken(token);
  const existing = await db.reservation.findUnique({ where: { trackingTokenHash: hash }, select: { id: true, organizationId: true, locationId: true, status: true, startsAt: true, name: true } });
  if (!existing) return { ok: false, reason: 'not_found' };
  // Already cancelled or finished: say so plainly rather than pretending to act.
  if (!['REQUESTED', 'CONFIRMED'].includes(existing.status)) return { ok: false, reason: 'not_cancellable' };
  if (existing.startsAt.getTime() - now.getTime() < GUEST_CANCEL_NOTICE_MINUTES * 60_000) return { ok: false, reason: 'too_late' };
  await limitPublic(`reservation-cancel:${existing.locationId}`, asIdentity(client), { guest: [10, 3600], ip: [30, 3600] });
  await db.$transaction(async (tx) => {
    // Status is re-checked in the write so two taps cannot cancel twice or fight the restaurant.
    const res = await tx.reservation.updateMany({ where: { id: existing.id, status: { in: ['REQUESTED', 'CONFIRMED'] } }, data: { status: 'CANCELLED' } });
    if (res.count !== 1) return;
    // Table holds are released with the reservation; capacity is derived from status.
    await tx.reservationTableAssignment.deleteMany({ where: { reservationId: existing.id } });
    await tx.notification.create({
      data: { organizationId: existing.organizationId, locationId: existing.locationId, type: 'RESERVATION_REQUEST', title: `Reservation cancelled by the guest — ${existing.name}`, entityId: existing.id },
    });
    await audit({ organizationId: existing.organizationId, actorUserId: null, action: 'reservation.cancelled_by_guest', entityType: 'Reservation', entityId: existing.id }, tx);
  });
  return { ok: true };
}

// ------------------------------------------------------------------ management (M10-08/09)

export const reservationStatusSchema = z.object({
  reservationId: z.string().min(1),
  to: z.enum(['CONFIRMED', 'REJECTED', 'CANCELLED', 'ARRIVED', 'NO_SHOW', 'COMPLETED']),
  expectedFrom: z.enum(['REQUESTED', 'CONFIRMED', 'ARRIVED', 'REJECTED', 'CANCELLED', 'NO_SHOW', 'COMPLETED']),
  note: z.string().trim().max(300).optional(),
});

async function ownedReservation(ctx: TenantContext, id: string, tx: Tx | typeof db = db) {
  const r = await tx.reservation.findFirst({ where: { id, organizationId: ctx.org.id } });
  if (!r) throw new UserFacingError('Reservation not found.', 404);
  await assertLocationAccess(ctx, r.locationId);
  return r;
}

export async function changeReservationStatus(ctx: TenantContext, input: unknown) {
  const d = reservationStatusSchema.parse(input);
  const r = await ownedReservation(ctx, d.reservationId);
  if (r.status !== d.expectedFrom) throw new UserFacingError('status_conflict', 409, { current: r.status });
  if (!TRANSITIONS[r.status]?.includes(d.to)) throw new UserFacingError(`Cannot change a reservation from ${r.status} to ${d.to}.`);
  if (d.to === 'CONFIRMED') {
    // Re-check that confirming still fits a table assigned to it (no double booking).
    const assignments = await db.reservationTableAssignment.findMany({ where: { reservationId: r.id } });
    for (const a of assignments) await assertTableFree(db, a.tableId, a.startsAt, a.endsAt, r.id);
  }
  const res = await db.reservation.updateMany({ where: { id: r.id, status: d.expectedFrom }, data: { status: d.to, ...(d.note ? { internalNote: d.note } : {}) } });
  if (res.count !== 1) throw new UserFacingError('status_conflict', 409);
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'reservation.status_changed', entityType: 'Reservation', entityId: r.id, metadata: { from: r.status, to: d.to } });
}

async function assertTableFree(tx: Tx | typeof db, tableId: string, startsAt: Date, endsAt: Date, exceptReservationId: string) {
  const clash = await tx.reservationTableAssignment.findFirst({
    where: { tableId, reservationId: { not: exceptReservationId }, reservation: { status: { in: HOLDING } }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    include: { reservation: { select: { name: true, startsAt: true } } },
  });
  if (clash) throw new UserFacingError(`This table is already booked at that time (${clash.reservation.name}).`);
}

/**
 * Assigns a table. The table is blocked for the visit plus the buffer time. A per-table lock
 * inside the transaction makes simultaneous assignments of the same table impossible.
 */
export async function assignReservationTable(ctx: TenantContext, reservationId: string, tableId: string) {
  return db.$transaction(async (tx) => {
    const r = await ownedReservation(ctx, reservationId, tx);
    if (!HOLDING.includes(r.status)) throw new UserFacingError('Only active reservations can get a table.');
    const table = await tx.restaurantTable.findFirst({ where: { id: tableId, organizationId: ctx.org.id, locationId: r.locationId, isActive: true } });
    if (!table) throw new UserFacingError('Choose an active table of this location.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'table:' + table.id}))`;
    const s = (await tx.reservationSettings.findUnique({ where: { locationId: r.locationId } })) ?? DEFAULTS;
    const endsAt = new Date(r.endsAt.getTime() + s.bufferMinutes * 60_000);
    await assertTableFree(tx, table.id, r.startsAt, endsAt, r.id);
    await tx.reservationTableAssignment.upsert({
      where: { reservationId_tableId: { reservationId: r.id, tableId: table.id } },
      update: { startsAt: r.startsAt, endsAt },
      create: { reservationId: r.id, tableId: table.id, startsAt: r.startsAt, endsAt },
    });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'reservation.table_assigned', entityType: 'Reservation', entityId: r.id, metadata: { table: table.label, seats: table.seats, party: r.partySize } }, tx);
    return { warning: table.seats && table.seats < r.partySize ? `Table ${table.label} has ${table.seats} seats for ${r.partySize} guests.` : null };
  });
}

export async function unassignReservationTable(ctx: TenantContext, reservationId: string, tableId: string) {
  const r = await ownedReservation(ctx, reservationId);
  await db.reservationTableAssignment.deleteMany({ where: { reservationId: r.id, tableId } });
}

export async function reservationsForDay(ctx: TenantContext, locationId: string, dateStr: string) {
  await assertLocationAccess(ctx, locationId);
  const location = await db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId } });
  const { start, next } = dayBounds(dateStr, location.timeZone);
  return db.reservation.findMany({
    where: { organizationId: ctx.org.id, locationId, startsAt: { gte: start, lt: next } },
    include: { assignments: { include: { table: { select: { id: true, label: true, seats: true } } } } },
    orderBy: { startsAt: 'asc' },
  });
}
