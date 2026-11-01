import 'server-only';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { LABEL_LIMITS, ROOM_LIMITS, TABLE_SHAPES, type PlanArea, type PlanLabel, type PlanTable } from '@/lib/floor-plan';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';

/**
 * Floor plans, one per dining area of each location, built by each restaurant itself: the room's
 * size and labels, and where each of its existing tables stands (shape, seats). The owner arranges
 * them (tables.manage); guests see the plan when booking only if the restaurant lets them choose.
 * Nothing here invents tables or capacities: only tables the restaurant created are drawn, and a
 * table without a seat count is shown but never offered online. Every query is scoped to the
 * organization and the location the member may access.
 */

const planTableSelect = { id: true, label: true, seats: true, areaId: true, planX: true, planY: true, planShape: true, planRotation: true } as const;
const planAreaSelect = { id: true, name: true, planWidth: true, planHeight: true, planLabels: true } as const;
type Row = { id: string; label: string; seats: number | null; areaId: string | null; planX: number | null; planY: number | null; planShape: PlanTable['shape']; planRotation: number };
type AreaRow = { id: string; name: string; planWidth: number; planHeight: number; planLabels: unknown };
const toPlanTable = (t: Row): PlanTable => ({ id: t.id, label: t.label, seats: t.seats, shape: t.planShape, rotation: t.planRotation, x: t.planX!, y: t.planY! });

const labelInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
  text: z.string().trim().min(1).max(LABEL_LIMITS.maxLength),
  x: z.number().int().min(0).max(ROOM_LIMITS.maxW),
  y: z.number().int().min(0).max(ROOM_LIMITS.maxH),
});
/** Labels as stored; anything malformed (edited by hand, older data) is left out rather than shown. */
export function parseLabels(json: unknown): PlanLabel[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((l) => {
    const r = labelInput.safeParse(l);
    return r.success ? [r.data] : [];
  });
}
const toArea = (a: AreaRow, tables: PlanTable[]): PlanArea => ({ id: a.id, name: a.name, width: a.planWidth, height: a.planHeight, labels: parseLabels(a.planLabels), tables });

/**
 * The guest view of a location: active dining areas with the tables placed on them, plus the
 * active tables with a seat count that are not placed on any plan (offered as a simple list).
 * Only what a guest needs to choose: no QR codes, sessions, reservations or guest details.
 */
export async function guestFloorPlan(locationId: string): Promise<{ areas: PlanArea[]; unplaced: Omit<PlanTable, 'x' | 'y'>[] }> {
  const [areas, tables] = await Promise.all([
    db.diningArea.findMany({ where: { locationId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: planAreaSelect }),
    db.restaurantTable.findMany({ where: { locationId, isActive: true, OR: [{ areaId: null }, { area: { isActive: true } }] }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: planTableSelect }),
  ]);
  const placed = (t: Row) => t.areaId !== null && t.planX !== null && t.planY !== null;
  return {
    // A drawn plan shows every table (the room as it is), seat count or not.
    areas: areas.map((a) => toArea(a, tables.filter((t) => t.areaId === a.id && placed(t)).map(toPlanTable))).filter((a) => a.tables.length > 0),
    // The list only offers what can be booked: a table without a seat count is left out.
    unplaced: tables.filter((t) => !placed(t) && t.seats !== null).map((t) => ({ id: t.id, label: t.label, seats: t.seats, shape: t.planShape, rotation: t.planRotation })),
  };
}

/** Everything the owner's builder needs for one location. */
export async function floorPlanForEditor(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  const [areas, tables, settings] = await Promise.all([
    db.diningArea.findMany({ where: { locationId, organizationId: ctx.org.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: planAreaSelect }),
    db.restaurantTable.findMany({ where: { locationId, organizationId: ctx.org.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: planTableSelect }),
    db.reservationSettings.findUnique({ where: { locationId }, select: { guestTableChoice: true, autoAssignTables: true } }),
  ]);
  const areaIds = new Set(areas.map((a) => a.id));
  return {
    areas: areas.map((a) => ({ id: a.id, name: a.name, width: a.planWidth, height: a.planHeight, labels: parseLabels(a.planLabels) })),
    // A table of a removed (inactive) area counts as not placed.
    tables: tables.map((t) => (t.areaId && !areaIds.has(t.areaId) ? { ...t, areaId: null, planX: null, planY: null } : t)),
    guestTableChoice: settings?.guestTableChoice ?? false,
    autoAssignTables: settings?.autoAssignTables ?? false,
  };
}

const placedInput = z.object({
  tableId: z.string().min(1).max(40),
  x: z.number().int().min(0).max(ROOM_LIMITS.maxW),
  y: z.number().int().min(0).max(ROOM_LIMITS.maxH),
  shape: z.enum(TABLE_SHAPES),
  rotation: z.union([z.literal(0), z.literal(90)]),
  seats: z.number().int().min(1).max(50).nullable(),
});
export const floorPlanInput = z.object({
  locationId: z.string().min(1),
  areaId: z.string().min(1),
  /** Tables drawn on this area, with their position, shape and seats. */
  placed: z.array(placedInput).max(300),
  /** Tables taken off this area's plan (they keep their area and seats). */
  removed: z.array(z.string().min(1).max(40)).max(300).default([]),
  /** The room's size (unchanged when absent). */
  room: z.object({ width: z.number().int().min(ROOM_LIMITS.minW).max(ROOM_LIMITS.maxW), height: z.number().int().min(ROOM_LIMITS.minH).max(ROOM_LIMITS.maxH) }).optional(),
  /** The room's labels, replacing the previous ones (unchanged when absent). */
  labels: z.array(labelInput).max(LABEL_LIMITS.maxPerArea).optional(),
});

/** Saves one dining area's plan in one transaction. Only active tables of this location can be used. */
export async function saveFloorPlan(ctx: TenantContext, input: unknown) {
  const d = floorPlanInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const area = await db.diningArea.findFirst({ where: { id: d.areaId, locationId: d.locationId, organizationId: ctx.org.id, isActive: true }, select: { id: true, planWidth: true, planHeight: true } });
  if (!area) throw new UserFacingError('Dining area not found.', 404);
  const ids = [...new Set([...d.placed.map((p) => p.tableId), ...d.removed])];
  if (ids.length !== d.placed.length + d.removed.length) throw new UserFacingError('A table appears twice in the plan.');
  const room = { w: d.room?.width ?? area.planWidth, h: d.room?.height ?? area.planHeight };
  // Never moved silently: the builder keeps everything inside the room before saving.
  if (d.placed.some((p) => p.x > room.w || p.y > room.h)) throw new UserFacingError('A table is outside the room. Make the room bigger or move the table.');
  if (d.labels?.some((l) => l.x > room.w || l.y > room.h)) throw new UserFacingError('A label is outside the room.');
  if (d.labels && new Set(d.labels.map((l) => l.id)).size !== d.labels.length) throw new UserFacingError('A label appears twice in the plan.');
  const owned = ids.length ? await db.restaurantTable.count({ where: { id: { in: ids }, locationId: d.locationId, organizationId: ctx.org.id, isActive: true } }) : 0;
  if (owned !== ids.length) throw new UserFacingError('Some tables do not belong to this location.');
  await db.$transaction(async (tx) => {
    // Tables still on this area beyond the new room's walls would be drawn outside it.
    if (d.room) {
      const outside = await tx.restaurantTable.count({ where: { areaId: area.id, id: { notIn: ids }, planX: { not: null }, OR: [{ planX: { gt: room.w } }, { planY: { gt: room.h } }] } });
      if (outside) throw new UserFacingError('A table is outside the room. Make the room bigger or move the table.');
      await tx.diningArea.update({ where: { id: area.id }, data: { planWidth: room.w, planHeight: room.h } });
    }
    if (d.labels) await tx.diningArea.update({ where: { id: area.id }, data: { planLabels: d.labels.length ? d.labels : Prisma.DbNull } });
    for (const p of d.placed) {
      await tx.restaurantTable.update({ where: { id: p.tableId }, data: { areaId: area.id, planX: p.x, planY: p.y, planShape: p.shape, planRotation: p.rotation, seats: p.seats } });
    }
    if (d.removed.length) await tx.restaurantTable.updateMany({ where: { id: { in: d.removed }, areaId: area.id }, data: { planX: null, planY: null } });
    await audit(
      { organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tables.floor_plan_saved', entityType: 'DiningArea', entityId: area.id, metadata: { placed: d.placed.length, removed: d.removed.length, room: `${room.w}x${room.h}`, labels: d.labels?.length ?? null } },
      tx,
    );
  });
  // What was stored, so the builder marks exactly this as saved (not edits made while saving).
  return { areaId: area.id, placed: d.placed, removed: d.removed, room: { width: room.w, height: room.h }, labels: d.labels ?? null };
}
export type SavedFloorPlan = Awaited<ReturnType<typeof saveFloorPlan>>;

/**
 * Removes a dining area from the floor plan. Its tables are kept (with their seats, QR codes and
 * reservations) and stay bookable; they only lose their place on this plan.
 */
export async function removeDiningArea(ctx: TenantContext, input: unknown) {
  const d = z.object({ locationId: z.string().min(1), areaId: z.string().min(1) }).parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const area = await db.diningArea.findFirst({ where: { id: d.areaId, locationId: d.locationId, organizationId: ctx.org.id, isActive: true }, select: { id: true, name: true } });
  if (!area) throw new UserFacingError('Dining area not found.', 404);
  const moved = await db.$transaction(async (tx) => {
    const res = await tx.restaurantTable.updateMany({ where: { areaId: area.id, organizationId: ctx.org.id }, data: { areaId: null, planX: null, planY: null } });
    await tx.diningArea.update({ where: { id: area.id }, data: { isActive: false } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tables.area_removed', entityType: 'DiningArea', entityId: area.id, metadata: { name: area.name, tables: res.count } }, tx);
    return res.count;
  });
  return { tables: moved };
}
