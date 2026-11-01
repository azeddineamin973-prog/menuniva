import 'server-only';
import { z } from 'zod';
import { PLAN_H, PLAN_W, TABLE_SHAPES, type PlanArea, type PlanTable } from '@/lib/floor-plan';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';

/**
 * Floor plans: where each existing table stands in its dining area, its shape and seats. The owner
 * arranges them (tables.manage); guests see the plan when booking if the restaurant allows it.
 * Nothing here invents tables or capacities: only tables the restaurant created are drawn, and a
 * table without a seat count is shown but never offered online.
 */

const planTableSelect = { id: true, label: true, seats: true, areaId: true, planX: true, planY: true, planShape: true, planRotation: true } as const;
type Row = { id: string; label: string; seats: number | null; areaId: string | null; planX: number | null; planY: number | null; planShape: PlanTable['shape']; planRotation: number };
const toPlanTable = (t: Row): PlanTable => ({ id: t.id, label: t.label, seats: t.seats, shape: t.planShape, rotation: t.planRotation, x: t.planX!, y: t.planY! });

/**
 * The guest view of a location: active dining areas with the tables placed on them, plus the
 * active tables with a seat count that are not placed on any plan (offered as a simple list).
 * No QR codes, no sessions.
 */
export async function guestFloorPlan(locationId: string): Promise<{ areas: PlanArea[]; unplaced: Omit<PlanTable, 'x' | 'y'>[] }> {
  const [areas, tables] = await Promise.all([
    db.diningArea.findMany({ where: { locationId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
    db.restaurantTable.findMany({ where: { locationId, isActive: true, OR: [{ areaId: null }, { area: { isActive: true } }] }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: planTableSelect }),
  ]);
  const placed = (t: Row) => t.areaId !== null && t.planX !== null && t.planY !== null;
  return {
    // A drawn plan shows every table (the room as it is), seat count or not.
    areas: areas.map((a) => ({ id: a.id, name: a.name, tables: tables.filter((t) => t.areaId === a.id && placed(t)).map(toPlanTable) })).filter((a) => a.tables.length > 0),
    // The list only offers what can be booked: a table without a seat count is left out.
    unplaced: tables.filter((t) => !placed(t) && t.seats !== null).map((t) => ({ id: t.id, label: t.label, seats: t.seats, shape: t.planShape, rotation: t.planRotation })),
  };
}

/** Everything the owner's editor needs for one location. */
export async function floorPlanForEditor(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  const [areas, tables, settings] = await Promise.all([
    db.diningArea.findMany({ where: { locationId, organizationId: ctx.org.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
    db.restaurantTable.findMany({ where: { locationId, organizationId: ctx.org.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: planTableSelect }),
    db.reservationSettings.findUnique({ where: { locationId }, select: { guestTableChoice: true } }),
  ]);
  return { areas, tables, guestTableChoice: settings?.guestTableChoice ?? false };
}

const placedInput = z.object({
  tableId: z.string().min(1).max(40),
  x: z.number().int().min(0).max(PLAN_W),
  y: z.number().int().min(0).max(PLAN_H),
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
});

/** Saves one dining area's plan in one transaction. Only active tables of this location can be used. */
export async function saveFloorPlan(ctx: TenantContext, input: unknown) {
  const d = floorPlanInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const area = await db.diningArea.findFirst({ where: { id: d.areaId, locationId: d.locationId, organizationId: ctx.org.id, isActive: true } });
  if (!area) throw new UserFacingError('Dining area not found.', 404);
  const ids = [...new Set([...d.placed.map((p) => p.tableId), ...d.removed])];
  if (ids.length !== d.placed.length + d.removed.length) throw new UserFacingError('A table appears twice in the plan.');
  const owned = await db.restaurantTable.count({ where: { id: { in: ids }, locationId: d.locationId, organizationId: ctx.org.id, isActive: true } });
  if (owned !== ids.length) throw new UserFacingError('Some tables do not belong to this location.');
  await db.$transaction(async (tx) => {
    for (const p of d.placed) {
      await tx.restaurantTable.update({ where: { id: p.tableId }, data: { areaId: area.id, planX: p.x, planY: p.y, planShape: p.shape, planRotation: p.rotation, seats: p.seats } });
    }
    if (d.removed.length) await tx.restaurantTable.updateMany({ where: { id: { in: d.removed }, areaId: area.id }, data: { planX: null, planY: null } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tables.floor_plan_saved', entityType: 'DiningArea', entityId: area.id, metadata: { placed: d.placed.length, removed: d.removed.length } }, tx);
  });
  // What was stored, so the editor marks exactly this as saved (not edits made while saving).
  return { areaId: area.id, placed: d.placed, removed: d.removed };
}
export type SavedFloorPlan = Awaited<ReturnType<typeof saveFloorPlan>>;
