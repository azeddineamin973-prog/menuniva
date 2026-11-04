import 'server-only';
import QRCode from 'qrcode';
import { z } from 'zod';
import { freeSpot, TABLE_SHAPES } from '@/lib/floor-plan';
import { audit } from '../audit';
import { newPublicToken } from '../crypto';
import { db, type Tx } from '../db';
import { env } from '../env';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { NO_PREPARATION } from './routing';

// ---------------------------------------------------------------- stations

export const stationInput = z.object({
  id: z.string().optional(),
  locationId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  type: z.enum(['KITCHEN', 'CAFE', 'DESSERTS', 'DRINKS', 'OTHER']),
  isActive: z.boolean().default(true),
  /** The owner read which dishes stop being orderable here while the station is off. */
  confirmDependents: z.boolean().default(false),
});

export async function saveStation(ctx: TenantContext, input: unknown) {
  const d = stationInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  if (d.id) {
    // A station is edited from its own location: staff limited to one location cannot reach
    // another location's station by posting their own location id.
    const s = await db.kitchenStation.findFirst({ where: { id: d.id, organizationId: ctx.org.id, locationId: d.locationId } });
    if (!s) throw new UserFacingError('Station not found.', 404);
    await db.$transaction(async (tx) => {
      if (s.isActive && !d.isActive) await assertStationCanSwitchOff(tx, ctx, s, d.confirmDependents);
      await tx.kitchenStation.update({ where: { id: s.id }, data: { name: d.name, type: d.type, isActive: d.isActive } });
    });
  } else {
    const max = await db.kitchenStation.aggregate({ where: { locationId: d.locationId }, _max: { sortOrder: true } });
    await db.kitchenStation.create({ data: { organizationId: ctx.org.id, locationId: d.locationId, name: d.name, type: d.type, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: d.id ? 'station.updated' : 'station.created', entityType: 'KitchenStation', entityId: d.id ?? null, metadata: { name: d.name, isActive: d.isActive } });
}

/**
 * Switching a station off must not hide work or quietly move it (audit OPS-09):
 * - open tickets, and new orders still waiting to be accepted with items for it, must be
 *   finished or cancelled first: an off screen is not listed on the kitchen page;
 * - dishes routed to it stop being orderable at this location while it is off. Nothing is moved
 *   to another station and the routing is kept, so switching it back on restores everything.
 * The station row stays locked until the switch is saved; accepting an order takes a shared lock
 * on the same row, so an order cannot be accepted onto it in between.
 */
async function assertStationCanSwitchOff(tx: Tx, ctx: TenantContext, s: { id: string; name: string; locationId: string }, confirmed: boolean) {
  await tx.$queryRaw`SELECT id FROM "KitchenStation" WHERE id = ${s.id} FOR UPDATE`;
  const [open, waiting] = await Promise.all([
    tx.kitchenTicket.findMany({ where: { stationId: s.id, status: { in: ['PENDING', 'PREPARING'] }, order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY'] } } }, select: { order: { select: { number: true } } } }),
    tx.order.findMany({ where: { organizationId: ctx.org.id, status: 'NEW', items: { some: { stationId: s.id, voidedAt: null } } }, select: { number: true } }),
  ]);
  const numbers = [...new Set([...open.map((t) => t.order.number), ...waiting.map((o) => o.number)])].sort((a, b) => a - b);
  if (numbers.length) throw new UserFacingError(`${s.name} still has open orders (${numbers.map((n) => `#${n}`).join(', ')}). Finish or cancel them before switching it off.`);
  const [dishes, others] = await Promise.all([
    tx.menuProduct.count({
      where: {
        organizationId: ctx.org.id,
        status: { not: 'ARCHIVED' },
        OR: [{ stationId: s.id }, { stationId: null, noPreparation: false, category: { defaultStationId: s.id } }],
      },
    }),
    tx.kitchenStation.count({ where: { locationId: s.locationId, isActive: true, id: { not: s.id } } }),
  ]);
  if (dishes > 0 && !confirmed) {
    throw new UserFacingError(
      others > 0
        ? `${dishes === 1 ? '1 dish is' : `${dishes} dishes are`} prepared at ${s.name}. While it is off, guests cannot order ${dishes === 1 ? 'it' : 'them'} at this location; nothing is sent to another station, and the routing is kept for when you switch it back on. Confirm to switch it off.`
        : `${s.name} is the last kitchen screen at this location. While it is off, orders are no longer shown on any kitchen screen, only on Live Orders, and Ready is set there by hand. Confirm to switch it off.`,
    );
  }
}

/**
 * Sets how many dishes at once are prepared: a station, "use the category's" (null) or
 * NO_PREPARATION (handed over at the counter). With `locationId` (the routing screen of one
 * location), the station must belong to it, and a dish with its own station at another
 * location is left as it is: changing it here would silently change that location.
 */
export async function routeProducts(ctx: TenantContext, stationId: string | null, productIds: string[], locationId?: string) {
  if (locationId) await assertLocationAccess(ctx, locationId);
  const noPreparation = stationId === NO_PREPARATION;
  const target = noPreparation ? null : stationId;
  if (target) {
    const s = await db.kitchenStation.findFirst({ where: { id: target, organizationId: ctx.org.id } });
    if (!s) throw new UserFacingError('Station not found.');
    if (!s.isActive) throw new UserFacingError(`${s.name} is switched off. Switch it on first, or choose another station.`);
    if (locationId && s.locationId !== locationId) throw new UserFacingError('Choose a station of this location.');
  }
  const where = { id: { in: productIds }, organizationId: ctx.org.id, ...(locationId ? { NOT: { station: { is: { locationId: { not: locationId } } } } } : {}) };
  const res = await db.menuProduct.updateMany({ where, data: { stationId: target, noPreparation } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'station.products_routed', entityType: 'KitchenStation', entityId: target, metadata: { count: res.count, noPreparation } });
  return res.count;
}

// ---------------------------------------------------------------- areas & tables

export const areaInput = z.object({ id: z.string().optional(), locationId: z.string().min(1), name: z.string().trim().min(1).max(80), floor: z.string().trim().max(40).optional() });

export async function saveArea(ctx: TenantContext, input: unknown) {
  const d = areaInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  if (d.id) {
    const a = await db.diningArea.findFirst({ where: { id: d.id, organizationId: ctx.org.id, locationId: d.locationId, isActive: true } });
    if (!a) throw new UserFacingError('Area not found.', 404);
    await db.diningArea.update({ where: { id: a.id }, data: { name: d.name, ...(d.floor !== undefined ? { floor: d.floor || null } : {}) } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tables.area_renamed', entityType: 'DiningArea', entityId: a.id, metadata: { from: a.name, to: d.name } });
    return { id: a.id };
  }
  const max = await db.diningArea.aggregate({ where: { locationId: d.locationId }, _max: { sortOrder: true } });
  const created = await db.diningArea.create({ data: { organizationId: ctx.org.id, locationId: d.locationId, name: d.name, floor: d.floor || null, sortOrder: (max._max.sortOrder ?? 0) + 1 }, select: { id: true } });
  return { id: created.id };
}

export const tablesInput = z.object({
  locationId: z.string().min(1),
  areaId: z.string().nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(20)).min(1).max(200),
  seats: z.number().int().min(1).max(50).nullable().optional(),
  /** Floor plan builder: draw the new tables on the area's plan right away, in free spots. */
  place: z.boolean().optional(),
  shape: z.enum(TABLE_SHAPES).optional(),
});

/** "1-10" → ["01".."10"], "A1, A2, Terraço 3" → as typed. */
export function expandTableLabels(input: string): string[] {
  const out: string[] = [];
  for (const part of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = /^(.*?)(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const [, prefix, a, b] = range;
      const from = Number(a);
      const to = Number(b);
      if (to < from || to - from > 199) throw new UserFacingError('Ranges can include at most 200 tables.');
      const width = Math.max(2, b.length);
      for (let n = from; n <= to; n++) out.push(`${prefix}${String(n).padStart(width, '0')}`);
    } else out.push(part);
  }
  return [...new Set(out)];
}

export async function createTables(ctx: TenantContext, input: unknown) {
  const d = tablesInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const area = d.areaId ? await db.diningArea.findFirst({ where: { id: d.areaId, locationId: d.locationId, organizationId: ctx.org.id, isActive: true }, select: { id: true, planWidth: true, planHeight: true } }) : null;
  if (d.areaId && !area) throw new UserFacingError('Invalid area.');
  if (d.place && !area) throw new UserFacingError('Choose the dining area to draw the tables on.');
  await db.$transaction(async (tx) => {
    // Limit and label checks inside the transaction, serialised per restaurant, so two parallel
    // bulk creations cannot exceed the plan's table limit together (audit GAP-05).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tables:${ctx.org.id}`}))`;
    const sub = await tx.subscription.findUnique({ where: { organizationId: ctx.org.id }, include: { plan: true } });
    const limit = (sub?.plan.limits as { tables?: number } | null)?.tables;
    const current = await tx.restaurantTable.count({ where: { organizationId: ctx.org.id, isActive: true } });
    if (limit && current + d.labels.length > limit) throw new UserFacingError(`Your plan allows up to ${limit} tables.`);
    const existing = await tx.restaurantTable.findMany({ where: { locationId: d.locationId, label: { in: d.labels } }, select: { label: true } });
    if (existing.length) throw new UserFacingError(`These table labels already exist: ${existing.map((e) => e.label).join(', ')}`);
    const max = await tx.restaurantTable.aggregate({ where: { locationId: d.locationId }, _max: { sortOrder: true } });
    let order = max._max.sortOrder ?? 0;
    // Placed next to the tables already drawn on this area, never on top of them.
    const shape = d.shape ?? 'ROUND';
    const room = area ? { w: area.planWidth, h: area.planHeight } : null;
    const drawn =
      d.place && area
        ? (await tx.restaurantTable.findMany({ where: { areaId: area.id, isActive: true, planX: { not: null }, planY: { not: null } }, select: { planX: true, planY: true, planShape: true, planRotation: true, seats: true } })).map((t) => ({
            x: t.planX!,
            y: t.planY!,
            shape: t.planShape,
            rotation: t.planRotation,
            seats: t.seats,
          }))
        : [];
    for (const label of d.labels) {
      const spot = d.place && room ? freeSpot(drawn, shape, d.seats ?? null, 0, room) : null;
      const t = await tx.restaurantTable.create({
        data: { organizationId: ctx.org.id, locationId: d.locationId, areaId: d.areaId ?? null, label, seats: d.seats ?? null, sortOrder: ++order, ...(spot ? { planX: spot.x, planY: spot.y, planShape: shape } : {}) },
      });
      if (spot) drawn.push({ ...spot, shape, rotation: 0, seats: d.seats ?? null });
      await tx.tableQRToken.create({ data: { tableId: t.id, token: newPublicToken() } });
    }
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tables.created', entityType: 'RestaurantTable', metadata: { labels: d.labels } }, tx);
  });
  return { created: d.labels.length };
}

async function assertTable(ctx: TenantContext, tableId: string) {
  const t = await db.restaurantTable.findFirst({ where: { id: tableId, organizationId: ctx.org.id } });
  if (!t) throw new UserFacingError('Table not found.', 404);
  await assertLocationAccess(ctx, t.locationId);
  return t;
}

/** Revokes the old QR token and issues a new one (e.g. if a QR code was copied/abused). */
export async function rotateTableQr(ctx: TenantContext, tableId: string) {
  const t = await assertTable(ctx, tableId);
  await db.$transaction([
    db.tableQRToken.updateMany({ where: { tableId: t.id, isActive: true }, data: { isActive: false, revokedAt: new Date() } }),
    db.tableQRToken.create({ data: { tableId: t.id, token: newPublicToken() } }),
  ]);
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tables.qr_rotated', entityType: 'RestaurantTable', entityId: t.id });
}

export async function updateTable(ctx: TenantContext, input: unknown) {
  const d = z.object({ tableId: z.string(), label: z.string().trim().min(1).max(20), seats: z.number().int().min(1).max(50).nullable(), areaId: z.string().nullable(), isActive: z.boolean() }).parse(input);
  const t = await assertTable(ctx, d.tableId);
  if (d.areaId) {
    const area = await db.diningArea.findFirst({ where: { id: d.areaId, locationId: t.locationId, organizationId: ctx.org.id, isActive: true } });
    if (!area) throw new UserFacingError('Invalid area.');
  }
  const clash = await db.restaurantTable.findFirst({ where: { locationId: t.locationId, label: d.label, id: { not: t.id } } });
  if (clash) throw new UserFacingError('Another table already uses this label.');
  await db.restaurantTable.update({ where: { id: t.id }, data: { label: d.label, seats: d.seats, areaId: d.areaId, isActive: d.isActive } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tables.updated', entityType: 'RestaurantTable', entityId: t.id });
}

export async function activeQrToken(tableId: string) {
  return db.tableQRToken.findFirst({ where: { tableId, isActive: true }, orderBy: { createdAt: 'desc' } });
}

export function tableQrUrl(token: string) {
  return `${env.APP_BASE_URL}/t/${token}`;
}

export async function qrSvg(url: string, size = 512) {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#171A1D', light: '#FFFFFF' } });
}

export async function qrPng(url: string, size = 1024) {
  return QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#171A1D', light: '#FFFFFF' } });
}

export async function listTablesForLocation(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  return db.restaurantTable.findMany({
    where: { locationId, organizationId: ctx.org.id },
    orderBy: [{ area: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    include: {
      area: true,
      qrTokens: { where: { isActive: true }, take: 1 },
      // Open seating with its PIN state (never the PIN itself) and the phones authorised for it.
      sessions: {
        where: { status: 'OPEN' },
        take: 1,
        select: { id: true, openedAt: true, openedById: true, pinIssuedAt: true, pinLockedAt: true, pinFailedAttempts: true, _count: { select: { devices: { where: { revokedAt: null } }, orders: { where: { status: 'NEW' } } } } },
      },
      // A guest at a closed table asked staff to open it.
      staffTasks: { where: { type: 'OPEN_TABLE', status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { id: true, createdAt: true }, take: 1 },
    },
  });
}
