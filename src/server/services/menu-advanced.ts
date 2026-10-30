import 'server-only';
import { z } from 'zod';
import { parseMoneyToCents } from '@/lib/money';
import { slugify } from '@/lib/slug';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { COUNTRY_DEFAULTS } from './organizations';

// ---------------------------------------------------------------- location overrides (M4-05)

const optPrice = z.preprocess((v) => (v === undefined || v === null ? '' : String(v)), z.string());

export const overrideInput = z.object({
  productId: z.string().min(1),
  locationId: z.string().min(1),
  isAvailable: z.boolean(),
  soldOut: z.boolean(),
  dineIn: optPrice,
  takeaway: optPrice,
  delivery: optPrice,
});

function centsOrNull(raw: string, label: string): number | null {
  if (!raw.trim()) return null; // empty = use the base price
  const c = parseMoneyToCents(raw);
  if (c === null) throw new UserFacingError(`Invalid ${label} price. Use a format like 12,50.`);
  return c;
}

/** Location-specific availability and prices. Empty price = inherit the restaurant base price. */
export async function saveLocationOverride(ctx: TenantContext, input: unknown) {
  const d = overrideInput.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const product = await db.menuProduct.findFirst({ where: { id: d.productId, organizationId: ctx.org.id } });
  if (!product) throw new UserFacingError('Product not found.', 404);
  const data = {
    isAvailable: d.isAvailable,
    soldOut: d.soldOut,
    dineInPriceCents: centsOrNull(d.dineIn, 'dine-in'),
    takeawayPriceCents: centsOrNull(d.takeaway, 'takeaway'),
    deliveryPriceCents: centsOrNull(d.delivery, 'delivery'),
  };
  await db.productLocationOverride.upsert({
    where: { productId_locationId: { productId: product.id, locationId: d.locationId } },
    update: data,
    create: { productId: product.id, locationId: d.locationId, ...data },
  });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.location_override_saved', entityType: 'MenuProduct', entityId: product.id, metadata: { locationId: d.locationId, ...data } });
}

// ---------------------------------------------------------------- availability schedules (M4-08)

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid_time');
export const scheduleInput = z.object({
  target: z.enum(['product', 'category']),
  id: z.string().min(1),
  ranges: z
    .array(z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), start: hhmm, end: hhmm }))
    .max(14),
});

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/**
 * Replaces the availability schedule of a dish or category. No ranges = always available.
 * Times are in the location's time zone; ranges must end after they start (same day).
 */
export async function saveSchedule(ctx: TenantContext, input: unknown) {
  const d = scheduleInput.parse(input);
  const owner =
    d.target === 'product'
      ? await db.menuProduct.findFirst({ where: { id: d.id, organizationId: ctx.org.id }, select: { id: true } })
      : await db.menuCategory.findFirst({ where: { id: d.id, organizationId: ctx.org.id }, select: { id: true } });
  if (!owner) throw new UserFacingError('Not found.', 404);
  const rows = d.ranges.flatMap((r) => {
    const start = toMin(r.start);
    const end = toMin(r.end);
    if (end <= start) throw new UserFacingError('Each time range must end after it starts (e.g. 12:00–15:00).');
    return [...new Set(r.days)].map((dayOfWeek) => ({ dayOfWeek, startMinute: start, endMinute: end }));
  });
  const key = d.target === 'product' ? { productId: owner.id } : { categoryId: owner.id };
  await db.$transaction([db.availabilitySchedule.deleteMany({ where: key }), db.availabilitySchedule.createMany({ data: rows.map((r) => ({ ...r, ...key })) })]);
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.schedule_saved', entityType: d.target, entityId: owner.id, metadata: { ranges: rows.length } });
}

// ---------------------------------------------------------------- tax classes (M4-14)

/**
 * Commonly used VAT rates offered as starting points ONLY. The restaurant must confirm each
 * class with its accountant; nothing is applied until it explicitly approves.
 */
export const TAX_SUGGESTIONS = {
  PT: [
    { name: 'IVA taxa normal (Continente)', rateBasisPoints: 2300 },
    { name: 'IVA taxa intermédia (Continente)', rateBasisPoints: 1300 },
    { name: 'IVA taxa reduzida (Continente)', rateBasisPoints: 600 },
  ],
  ES: [
    { name: 'IVA general', rateBasisPoints: 2100 },
    { name: 'IVA reducido', rateBasisPoints: 1000 },
    { name: 'IVA superreducido', rateBasisPoints: 400 },
  ],
} as const;

export const taxClassInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  rate: z.string().trim().regex(/^\d{1,2}([.,]\d{1,2})?$/, 'invalid_rate'),
  approved: z.boolean(),
});

export async function saveTaxClass(ctx: TenantContext, input: unknown) {
  const d = taxClassInput.parse(input);
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { country: true } });
  const [i, f = ''] = d.rate.replace(',', '.').split('.');
  const bps = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (bps > 3000) throw new UserFacingError('Rate looks too high. Check the percentage.');
  const data = { name: d.name, rateBasisPoints: bps, approvedAt: d.approved ? new Date() : null };
  if (d.id) {
    const tc = await db.taxClass.findFirst({ where: { id: d.id, organizationId: ctx.org.id } });
    if (!tc) throw new UserFacingError('Tax class not found.', 404);
    await db.taxClass.update({ where: { id: tc.id }, data });
  } else {
    await db.taxClass.create({ data: { organizationId: ctx.org.id, country: org.country, ...data } });
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'tax.class_saved', entityType: 'TaxClass', entityId: d.id ?? null, metadata: data });
}

export async function deleteTaxClass(ctx: TenantContext, id: string) {
  const tc = await db.taxClass.findFirst({ where: { id, organizationId: ctx.org.id }, include: { _count: { select: { products: true } } } });
  if (!tc) throw new UserFacingError('Tax class not found.', 404);
  if (tc._count.products > 0) throw new UserFacingError('This tax class is used by dishes. Change them first.');
  await db.taxClass.delete({ where: { id: tc.id } });
}

// ---------------------------------------------------------------- locations (M3-07)

export const locationInput = z.object({ name: z.string().trim().min(2).max(100), city: z.string().trim().max(80).optional() });

/** Adds a location (branch) within the plan's location limit. */
export async function createLocation(ctx: TenantContext, input: unknown) {
  const d = locationInput.parse(input);
  if (ctx.role !== 'RESTAURANT_OWNER') throw new UserFacingError('Only owners can add locations.');
  const [org, sub, count] = await Promise.all([
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { country: true } }),
    db.subscription.findUnique({ where: { organizationId: ctx.org.id }, include: { plan: true } }),
    db.restaurantLocation.count({ where: { organizationId: ctx.org.id } }),
  ]);
  const limit = (sub?.plan.limits as { locations?: number } | null)?.locations ?? 1;
  if (count >= limit) throw new UserFacingError(`Your plan includes ${limit} location${limit > 1 ? 's' : ''}. Upgrade the plan to add more.`);
  let slug = slugify(d.name);
  for (let n = 2; await db.restaurantLocation.findFirst({ where: { organizationId: ctx.org.id, slug } }); n++) slug = `${slugify(d.name)}-${n}`;
  const location = await db.restaurantLocation.create({
    data: {
      organizationId: ctx.org.id,
      slug,
      name: d.name,
      city: d.city || null,
      country: org.country,
      timeZone: COUNTRY_DEFAULTS[org.country].timeZone,
      takeawaySettings: { create: {} },
      deliverySettings: { create: {} },
      reservationSettings: { create: {} },
      reviewSettings: { create: {} },
    },
  });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'location.created', entityType: 'RestaurantLocation', entityId: location.id, metadata: { name: d.name } });
  return { id: location.id };
}
