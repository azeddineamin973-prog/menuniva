import 'server-only';
import QRCode from 'qrcode';
import { z } from 'zod';
import { audit } from '../audit';
import { newPublicToken } from '../crypto';
import { db } from '../db';
import { env } from '../env';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';

// ---------------------------------------------------------------- stations

export const stationInput = z.object({
  id: z.string().optional(),
  locationId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  type: z.enum(['KITCHEN', 'CAFE', 'DESSERTS', 'DRINKS', 'OTHER']),
  isActive: z.boolean().default(true),
});

export async function saveStation(ctx: TenantContext, input: unknown) {
  const d = stationInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  if (d.id) {
    const s = await db.kitchenStation.findFirst({ where: { id: d.id, organizationId: ctx.org.id } });
    if (!s) throw new UserFacingError('Station not found.', 404);
    await db.kitchenStation.update({ where: { id: s.id }, data: { name: d.name, type: d.type, isActive: d.isActive } });
  } else {
    const max = await db.kitchenStation.aggregate({ where: { locationId: d.locationId }, _max: { sortOrder: true } });
    await db.kitchenStation.create({ data: { organizationId: ctx.org.id, locationId: d.locationId, name: d.name, type: d.type, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: d.id ? 'station.updated' : 'station.created', entityType: 'KitchenStation', entityId: d.id ?? null, metadata: { name: d.name } });
}

/** Assigns a station to many products at once (routing). */
export async function routeProducts(ctx: TenantContext, stationId: string | null, productIds: string[]) {
  if (stationId) {
    const s = await db.kitchenStation.findFirst({ where: { id: stationId, organizationId: ctx.org.id } });
    if (!s) throw new UserFacingError('Station not found.');
  }
  const res = await db.menuProduct.updateMany({ where: { id: { in: productIds }, organizationId: ctx.org.id }, data: { stationId } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'station.products_routed', entityType: 'KitchenStation', entityId: stationId, metadata: { count: res.count } });
  return res.count;
}

// ---------------------------------------------------------------- areas & tables

export const areaInput = z.object({ id: z.string().optional(), locationId: z.string().min(1), name: z.string().trim().min(1).max(80), floor: z.string().trim().max(40).optional() });

export async function saveArea(ctx: TenantContext, input: unknown) {
  const d = areaInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  if (d.id) {
    const a = await db.diningArea.findFirst({ where: { id: d.id, organizationId: ctx.org.id } });
    if (!a) throw new UserFacingError('Area not found.', 404);
    await db.diningArea.update({ where: { id: a.id }, data: { name: d.name, floor: d.floor || null } });
  } else {
    const max = await db.diningArea.aggregate({ where: { locationId: d.locationId }, _max: { sortOrder: true } });
    await db.diningArea.create({ data: { organizationId: ctx.org.id, locationId: d.locationId, name: d.name, floor: d.floor || null, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  }
}

export const tablesInput = z.object({
  locationId: z.string().min(1),
  areaId: z.string().nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(20)).min(1).max(200),
  seats: z.number().int().min(1).max(50).nullable().optional(),
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
  if (d.areaId) {
    const area = await db.diningArea.findFirst({ where: { id: d.areaId, locationId: d.locationId, organizationId: ctx.org.id } });
    if (!area) throw new UserFacingError('Invalid area.');
  }
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
    for (const label of d.labels) {
      const t = await tx.restaurantTable.create({ data: { organizationId: ctx.org.id, locationId: d.locationId, areaId: d.areaId ?? null, label, seats: d.seats ?? null, sortOrder: ++order } });
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
    const area = await db.diningArea.findFirst({ where: { id: d.areaId, locationId: t.locationId } });
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
    include: { area: true, qrTokens: { where: { isActive: true }, take: 1 }, sessions: { where: { status: 'OPEN' }, take: 1 } },
  });
}
