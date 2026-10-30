import 'server-only';
import { z } from 'zod';
import type { CountryCode, LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { LANGUAGES } from '@/i18n/config';
import { openingHoursSchema, rangesFor, type OpeningHours } from '@/lib/opening-hours';
import { isValidPostalCode, normalizePostalCode, postalCodeMatches } from '@/lib/postal';
import { parseMoneyToCents } from '@/lib/money';
import { zonedParts, zonedTimeToUtc } from '@/lib/time';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { rateLimit } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { createOrderRecord, OrderRejectedError, trackingTokenFor } from './orders';
import { cartSchema, quoteCart } from './pricing';
import { computeDiscounts, consumeUsage } from './promotions';

// =============================================================== shared

const LANG = z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]);
const phoneSchema = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'invalid_phone');
const optCents = (label: string) =>
  z.preprocess((v) => (v === '' || v == null ? null : v), z.union([z.string(), z.number()]).nullable()).transform((v, ctx) => {
    if (v === null) return null;
    const c = parseMoneyToCents(v);
    if (c === null) {
      ctx.addIssue({ code: 'custom', message: `invalid_${label}` });
      return z.NEVER;
    }
    return c;
  });

async function publicLocation(orgSlug: string, locationSlug?: string | null) {
  const org = await db.restaurantOrganization.findUnique({ where: { slug: orgSlug } });
  if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED') return null;
  const location = await db.restaurantLocation.findFirst({
    where: { organizationId: org.id, isPublished: true, ...(locationSlug ? { slug: locationSlug } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { takeawaySettings: true, deliverySettings: true, deliveryZones: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
  });
  return location ? { org, location } : null;
}
export type PublicLocation = NonNullable<Awaited<ReturnType<typeof publicLocation>>>;
export { publicLocation };

function isOpenNow(hours: OpeningHours | null, timeZone: string, now: Date) {
  if (!hours) return true; // not configured → not restricted (the restaurant controls pausing)
  const p = zonedParts(now, timeZone);
  const m = p.hour * 60 + p.minute;
  const prev = (p.weekday + 6) % 7;
  return rangesFor(hours, p.weekday).some(([o, c]) => m >= o && m < c) || rangesFor(hours, prev).some(([, c]) => c > 1440 && m + 1440 < c);
}

// =============================================================== M9-01 takeaway settings

export const takeawaySettingsSchema = z.object({
  locationId: z.string().min(1),
  leadTimeMinutes: z.coerce.number().int().min(0).max(240),
  slotMinutes: z.coerce.number().int().refine((n) => [5, 10, 15, 20, 30, 60].includes(n), 'invalid_slot'),
  minOrder: optCents('min_order'),
  paused: z.boolean(),
  pickupHours: z.preprocess((v) => (typeof v === 'string' && v ? JSON.parse(v) : null), openingHoursSchema.nullable()),
});

export async function updateTakeawaySettings(ctx: TenantContext, input: unknown) {
  const d = takeawaySettingsSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const data = { leadTimeMinutes: d.leadTimeMinutes, slotMinutes: d.slotMinutes, minOrderCents: d.minOrder ?? 0, paused: d.paused, pickupHours: d.pickupHours ?? Prisma.DbNull };
  await db.takeawaySettings.upsert({ where: { locationId: d.locationId }, update: data, create: { locationId: d.locationId, ...data } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'takeaway.settings_updated', entityType: 'RestaurantLocation', entityId: d.locationId, metadata: { ...data, pickupHours: d.pickupHours ? 'custom' : 'opening hours' } });
}

// =============================================================== M9-02 pickup slots

export type PickupOptions = { asap: { allowed: boolean; minutes: number }; slots: { value: string; minuteOfDay: number }[] };

/**
 * Pickup times for today in the location's time zone. Hours = pickup hours, else opening
 * hours. If neither is configured, only "as soon as possible" is offered.
 */
export function pickupOptions(
  location: { timeZone: string; openingHours: unknown },
  settings: { leadTimeMinutes: number; slotMinutes: number; pickupHours: unknown } | null,
  now = new Date(),
): PickupOptions {
  const lead = settings?.leadTimeMinutes ?? 20;
  const step = settings?.slotMinutes ?? 15;
  const hours = (settings?.pickupHours ?? location.openingHours ?? null) as OpeningHours | null;
  if (!hours) return { asap: { allowed: true, minutes: lead }, slots: [] };
  const p = zonedParts(now, location.timeZone);
  const nowMin = p.hour * 60 + p.minute;
  const earliest = nowMin + lead;
  const ranges: Array<[number, number]> = [...rangesFor(hours, p.weekday), ...rangesFor(hours, (p.weekday + 6) % 7).filter(([, c]) => c > 1440).map(([, c]) => [0, c - 1440] as [number, number])];
  const minutes = new Set<number>();
  for (const [o, c] of ranges) {
    for (let m = Math.ceil(Math.max(o, earliest) / step) * step; m < c && minutes.size < 96; m += step) minutes.add(m);
  }
  const slots = [...minutes].sort((a, b) => a - b).map((m) => ({ minuteOfDay: m, value: zonedTimeToUtc(p.year, p.month, p.day, Math.floor(m / 60), m % 60, location.timeZone).toISOString() }));
  const openNowWithTime = ranges.some(([o, c]) => nowMin >= o && earliest <= c);
  return { asap: { allowed: openNowWithTime, minutes: lead }, slots };
}

export function resolvePickup(choice: string, opts: PickupOptions, now = new Date()): Date | null {
  if (choice === 'asap') return opts.asap.allowed ? new Date(now.getTime() + opts.asap.minutes * 60_000) : null;
  return opts.slots.some((s) => s.value === choice) ? new Date(choice) : null;
}

// =============================================================== M9-03 takeaway checkout

const contactSchema = { customerName: z.string().trim().min(2, 'required').max(80), phone: phoneSchema };

export const submitPickupSchema = z.object({
  orgSlug: z.string().max(60),
  locationSlug: z.string().max(60).optional(),
  idempotencyKey: z.string().uuid(),
  language: LANG,
  items: cartSchema,
  notes: z.string().trim().max(300).optional(),
  pickup: z.string().max(40),
  couponCode: z.string().trim().max(30).optional(),
  ...contactSchema,
});

function channelAvailable(pl: PublicLocation, channel: Exclude<OrderChannel, 'TABLE'>, now: Date) {
  const { location } = pl;
  if (location.orderingPaused) return 'paused';
  if (channel === 'TAKEAWAY') {
    if (!location.takeawayEnabled) return 'channel_disabled';
    if (location.takeawaySettings?.paused) return 'paused';
  } else {
    if (!location.deliveryEnabled) return 'channel_disabled';
    if (location.deliverySettings?.paused) return 'paused';
    const hours = (location.deliverySettings?.deliveryHours ?? location.openingHours ?? null) as OpeningHours | null;
    if (!isOpenNow(hours, location.timeZone, now)) return 'closed';
  }
  return null;
}

export async function submitPickupOrder(input: unknown, clientKey: string, now = new Date()) {
  const d = submitPickupSchema.parse(input);
  const pl = await publicLocation(d.orgSlug, d.locationSlug);
  if (!pl) throw new OrderRejectedError('not_found');
  const { location, org } = pl;
  const blocked = channelAvailable(pl, 'TAKEAWAY', now);
  if (blocked) throw new OrderRejectedError(`ordering_${blocked}`);
  const trackingToken = trackingTokenFor(location.id, d.idempotencyKey);
  const existing = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: d.idempotencyKey } } });
  if (existing) return { orderNumber: existing.number, trackingToken, status: existing.status, duplicate: true };
  const pickupAt = resolvePickup(d.pickup, pickupOptions(location, location.takeawaySettings, now), now);
  if (!pickupAt) throw new OrderRejectedError('pickup_unavailable');
  await rateLimit(`order:client:${location.id}:${clientKey}`, 8, 600);
  return db.$transaction(async (tx) => {
    const quote = await quoteCart({ locationId: location.id, channel: 'TAKEAWAY', lang: d.language, items: d.items, now }, tx);
    if (quote.issues.length) throw new OrderRejectedError('items_unavailable', quote.issues);
    const min = location.takeawaySettings?.minOrderCents ?? 0;
    if (quote.subtotalCents < min) throw new OrderRejectedError('below_minimum', [], { minOrderCents: min });
    const promo = await computeDiscounts(tx, { organizationId: org.id, locationId: location.id, channel: 'TAKEAWAY', couponCode: d.couponCode, lines: quote.lines, subtotalCents: quote.subtotalCents, now });
    if (d.couponCode && promo.couponStatus === 'invalid') throw new OrderRejectedError('coupon_invalid');
    const { orderSequence } = await tx.restaurantLocation.update({ where: { id: location.id }, data: { orderSequence: { increment: 1 } }, select: { orderSequence: true } });
    const order = await createOrderRecord(tx, {
      organizationId: org.id,
      locationId: location.id,
      number: orderSequence,
      channel: 'TAKEAWAY',
      language: d.language,
      customerName: d.customerName,
      customerPhone: d.phone,
      customerNotes: d.notes?.trim() || null,
      pickupAt,
      idempotencyKey: d.idempotencyKey,
      trackingToken,
      quote,
      discountCents: promo.totalCents,
    });
    await consumeUsage(tx, org.id, order.id, promo.discounts);
    await tx.order.update({ where: { id: order.id }, data: { paymentMethodIntent: 'PAY_AT_COUNTER' } });
    await tx.notification.create({ data: { organizationId: org.id, locationId: location.id, type: 'NEW_ORDER', title: `New takeaway order #${order.number} — ${d.customerName}`, entityId: order.id } });
    return { orderNumber: order.number, trackingToken, status: order.status, duplicate: false };
  });
}

// =============================================================== M9-04/05 delivery settings & zones

export const deliverySettingsSchema = z.object({
  locationId: z.string().min(1),
  prepEstimateMinutes: z.coerce.number().int().min(0).max(240),
  deliveryEstimateMinutes: z.coerce.number().int().min(0).max(240),
  maxActiveOrders: z.coerce.number().int().min(1).max(500),
  cashOnDeliveryEnabled: z.boolean(),
  cardOnDeliveryEnabled: z.boolean(),
  paused: z.boolean(),
  deliveryHours: z.preprocess((v) => (typeof v === 'string' && v ? JSON.parse(v) : null), openingHoursSchema.nullable()),
});

export async function updateDeliverySettings(ctx: TenantContext, input: unknown) {
  const d = deliverySettingsSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const { locationId, deliveryHours, ...rest } = d;
  const data = { ...rest, deliveryHours: deliveryHours ?? Prisma.DbNull };
  await db.deliverySettings.upsert({ where: { locationId }, update: data, create: { locationId, ...data } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'delivery.settings_updated', entityType: 'RestaurantLocation', entityId: locationId, metadata: rest });
}

/** Validates zone patterns for the country: exact codes must be valid; prefixes end with *. */
export function parseZonePatterns(country: CountryCode, raw: string): string[] {
  const patterns = [...new Set(raw.split(/[,\n;]/).map((p) => p.trim().replace(/\s+/g, '')).filter(Boolean))];
  if (patterns.length === 0) throw new UserFacingError('Add at least one postal code or prefix (e.g. 4700-* or 4700-123).');
  for (const p of patterns) {
    if (p.endsWith('*')) {
      const prefix = p.slice(0, -1);
      const ok = country === 'PT' ? /^\d{1,4}(-\d{0,3})?$/.test(prefix) : /^\d{1,5}$/.test(prefix);
      if (!ok || !prefix) throw new UserFacingError(`“${p}” is not a valid ${country === 'PT' ? 'Portuguese' : 'Spanish'} postal-code prefix.`);
    } else if (!isValidPostalCode(country, p)) throw new UserFacingError(`“${p}” is not a valid ${country === 'PT' ? 'Portuguese (0000-000)' : 'Spanish (00000)'} postal code.`);
  }
  return patterns.map((p) => (p.endsWith('*') ? p : normalizePostalCode(country, p)));
}

export const zoneSchema = z.object({
  id: z.string().optional(),
  locationId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  patterns: z.string().max(2000),
  fee: optCents('fee'),
  minOrder: optCents('min_order'),
  freeFrom: optCents('free_from'),
  estimatedMinutes: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(300).nullable()),
  isActive: z.boolean().default(true),
});

/** Restaurant-defined delivery zone. Fees come only from these zones (no distance pricing without a routing provider). */
export async function saveDeliveryZone(ctx: TenantContext, input: unknown) {
  const d = zoneSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const location = await db.restaurantLocation.findUniqueOrThrow({ where: { id: d.locationId } });
  if (d.fee === null) throw new UserFacingError('Enter the delivery fee for this zone (0 for free delivery).');
  const data = {
    name: d.name,
    postalCodePatterns: parseZonePatterns(location.country, d.patterns),
    feeCents: d.fee,
    minOrderCents: d.minOrder ?? 0,
    freeDeliveryThresholdCents: d.freeFrom,
    estimatedMinutes: d.estimatedMinutes,
    isActive: d.isActive,
  };
  if (d.id) {
    const z0 = await db.deliveryZone.findFirst({ where: { id: d.id, organizationId: ctx.org.id, locationId: d.locationId } });
    if (!z0) throw new UserFacingError('Zone not found.', 404);
    await db.deliveryZone.update({ where: { id: z0.id }, data });
  } else {
    const max = await db.deliveryZone.aggregate({ where: { locationId: d.locationId }, _max: { sortOrder: true } });
    await db.deliveryZone.create({ data: { organizationId: ctx.org.id, locationId: d.locationId, sortOrder: (max._max.sortOrder ?? 0) + 1, ...data } });
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'delivery.zone_saved', entityType: 'DeliveryZone', entityId: d.id ?? null, metadata: data });
}

export async function deleteDeliveryZone(ctx: TenantContext, zoneId: string) {
  const z0 = await db.deliveryZone.findFirst({ where: { id: zoneId, organizationId: ctx.org.id } });
  if (!z0) throw new UserFacingError('Zone not found.', 404);
  await assertLocationAccess(ctx, z0.locationId);
  await db.deliveryZone.update({ where: { id: z0.id }, data: { isActive: false } });
}

export function findZone<Z extends { postalCodePatterns: string[]; isActive: boolean }>(country: CountryCode, zones: Z[], postal: string): { valid: boolean; zone: Z | null } {
  if (!isValidPostalCode(country, postal)) return { valid: false, zone: null };
  const zone = zones.find((zn) => zn.isActive && zn.postalCodePatterns.some((p) => postalCodeMatches(country, postal, p))) ?? null;
  return { valid: true, zone };
}

// =============================================================== M9-06 delivery quote & checkout

export type DeliveryQuote = {
  valid: boolean;
  covered: boolean;
  zoneName?: string;
  feeCents: number;
  minOrderCents: number;
  freeFromCents: number | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  meetsMinimum: boolean;
  estimatedMinutes: number;
  issues: Awaited<ReturnType<typeof quoteCart>>['issues'];
};

export async function quoteDelivery(pl: PublicLocation, postal: string, lang: LanguageCode, items: unknown, now = new Date(), couponCode?: string): Promise<DeliveryQuote> {
  const { location } = pl;
  const q = await quoteCart({ locationId: location.id, channel: 'DELIVERY', lang, items: cartSchema.parse(items), now });
  const promo = await computeDiscounts(db, { organizationId: location.organizationId, locationId: location.id, channel: 'DELIVERY', couponCode, lines: q.lines, subtotalCents: q.subtotalCents, now });
  const after = q.subtotalCents - promo.totalCents;
  const { valid, zone } = findZone(location.country, location.deliveryZones, postal);
  const est = zone?.estimatedMinutes ?? (location.deliverySettings?.prepEstimateMinutes ?? 25) + (location.deliverySettings?.deliveryEstimateMinutes ?? 30);
  if (!zone) return { valid, covered: false, feeCents: 0, minOrderCents: 0, freeFromCents: null, subtotalCents: q.subtotalCents, discountCents: promo.totalCents, totalCents: after, meetsMinimum: false, estimatedMinutes: est, issues: q.issues };
  const free = zone.freeDeliveryThresholdCents !== null && after >= zone.freeDeliveryThresholdCents;
  const fee = free ? 0 : zone.feeCents;
  return {
    valid,
    covered: true,
    zoneName: zone.name,
    feeCents: fee,
    minOrderCents: zone.minOrderCents,
    freeFromCents: zone.freeDeliveryThresholdCents,
    subtotalCents: q.subtotalCents,
    discountCents: promo.totalCents,
    totalCents: after + fee,
    meetsMinimum: q.subtotalCents >= zone.minOrderCents,
    estimatedMinutes: est,
    issues: q.issues,
  };
}

export const submitDeliverySchema = z.object({
  orgSlug: z.string().max(60),
  locationSlug: z.string().max(60).optional(),
  idempotencyKey: z.string().uuid(),
  language: LANG,
  items: cartSchema,
  notes: z.string().trim().max(300).optional(),
  ...contactSchema,
  address: z.string().trim().min(4, 'required').max(200),
  postalCode: z.string().trim().max(12),
  city: z.string().trim().min(2, 'required').max(80),
  deliveryNotes: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'CARD_TERMINAL']),
  couponCode: z.string().trim().max(30).optional(),
});

/** Restaurant delivery order. Coverage, fee and totals are computed on the server only. */
export async function submitDeliveryOrder(input: unknown, clientKey: string, now = new Date()) {
  const d = submitDeliverySchema.parse(input);
  const pl = await publicLocation(d.orgSlug, d.locationSlug);
  if (!pl) throw new OrderRejectedError('not_found');
  const { location, org } = pl;
  const blocked = channelAvailable(pl, 'DELIVERY', now);
  if (blocked) throw new OrderRejectedError(`ordering_${blocked}`);
  const settings = location.deliverySettings;
  if (d.paymentMethod === 'CASH_ON_DELIVERY' && !(settings?.cashOnDeliveryEnabled ?? true)) throw new OrderRejectedError('payment_method_unavailable');
  if (d.paymentMethod === 'CARD_TERMINAL' && !settings?.cardOnDeliveryEnabled) throw new OrderRejectedError('payment_method_unavailable');
  const trackingToken = trackingTokenFor(location.id, d.idempotencyKey);
  const existing = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: d.idempotencyKey } } });
  if (existing) return { orderNumber: existing.number, trackingToken, status: existing.status, duplicate: true };
  const { valid, zone } = findZone(location.country, location.deliveryZones, d.postalCode);
  if (!valid) throw new OrderRejectedError('invalid_postal_code');
  if (!zone) throw new OrderRejectedError('outside_delivery_zone');
  await rateLimit(`order:client:${location.id}:${clientKey}`, 8, 600);
  return db.$transaction(async (tx) => {
    const active = await tx.order.count({ where: { locationId: location.id, channel: 'DELIVERY', status: { in: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } } });
    if (active >= (settings?.maxActiveOrders ?? 10)) throw new OrderRejectedError('delivery_busy');
    const quote = await quoteCart({ locationId: location.id, channel: 'DELIVERY', lang: d.language, items: d.items, now }, tx);
    if (quote.issues.length) throw new OrderRejectedError('items_unavailable', quote.issues);
    // Minimum order uses the goods subtotal; the free-delivery threshold uses the amount after discounts.
    if (quote.subtotalCents < zone.minOrderCents) throw new OrderRejectedError('below_minimum', [], { minOrderCents: zone.minOrderCents });
    const promo = await computeDiscounts(tx, { organizationId: org.id, locationId: location.id, channel: 'DELIVERY', couponCode: d.couponCode, lines: quote.lines, subtotalCents: quote.subtotalCents, now });
    if (d.couponCode && promo.couponStatus === 'invalid') throw new OrderRejectedError('coupon_invalid');
    const afterDiscount = quote.subtotalCents - promo.totalCents;
    const fee = zone.freeDeliveryThresholdCents !== null && afterDiscount >= zone.freeDeliveryThresholdCents ? 0 : zone.feeCents;
    const { orderSequence } = await tx.restaurantLocation.update({ where: { id: location.id }, data: { orderSequence: { increment: 1 } }, select: { orderSequence: true } });
    const order = await createOrderRecord(tx, {
      organizationId: org.id,
      locationId: location.id,
      number: orderSequence,
      channel: 'DELIVERY',
      language: d.language,
      customerName: d.customerName,
      customerPhone: d.phone,
      customerNotes: d.notes?.trim() || null,
      idempotencyKey: d.idempotencyKey,
      trackingToken,
      quote,
      deliveryFeeCents: fee,
      discountCents: promo.totalCents,
    });
    await consumeUsage(tx, org.id, order.id, promo.discounts);
    await tx.order.update({ where: { id: order.id }, data: { paymentMethodIntent: d.paymentMethod } });
    await tx.deliveryOrderDetails.create({
      data: { orderId: order.id, zoneId: zone.id, recipientName: d.customerName, addressLine: d.address, postalCode: normalizePostalCode(location.country, d.postalCode), city: d.city, phone: d.phone, notes: d.deliveryNotes?.trim() || null },
    });
    await tx.notification.create({ data: { organizationId: org.id, locationId: location.id, type: 'NEW_ORDER', title: `New delivery order #${order.number} — ${zone.name}`, entityId: order.id } });
    return { orderNumber: order.number, trackingToken, status: order.status, duplicate: false, deliveryFeeCents: fee };
  });
}

// =============================================================== M9-07/08 drivers

export async function listDrivers(ctx: TenantContext) {
  return db.restaurantMembership.findMany({ where: { organizationId: ctx.org.id, status: 'ACTIVE', role: 'DELIVERY_STAFF' }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
}

export async function assignDriver(ctx: TenantContext, orderId: string, membershipId: string | null) {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: ctx.org.id, channel: 'DELIVERY' }, include: { delivery: true } });
  if (!order?.delivery) throw new UserFacingError('Delivery order not found.', 404);
  await assertLocationAccess(ctx, order.locationId);
  if (['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status)) throw new UserFacingError('This delivery is finished.');
  if (membershipId) {
    const m = await db.restaurantMembership.findFirst({ where: { id: membershipId, organizationId: ctx.org.id, status: 'ACTIVE' } });
    if (!m || m.role !== 'DELIVERY_STAFF') throw new UserFacingError('Choose an active delivery staff member.');
    if (m.locationIds.length && !m.locationIds.includes(order.locationId)) throw new UserFacingError('This person does not work at this location.');
  }
  await db.deliveryOrderDetails.update({ where: { orderId: order.id }, data: { driverMembershipId: membershipId } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'delivery.driver_assigned', entityType: 'Order', entityId: order.id, metadata: { membershipId } });
}

/** Deliveries assigned to the signed-in staff member (driver view). */
export async function myDeliveries(ctx: TenantContext) {
  return db.order.findMany({
    where: {
      organizationId: ctx.org.id,
      channel: 'DELIVERY',
      delivery: { driverMembershipId: ctx.membershipId },
      OR: [{ status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } }, { status: { in: ['DELIVERED', 'COMPLETED'] }, updatedAt: { gte: new Date(Date.now() - 12 * 3600_000) } }],
    },
    include: { delivery: true, items: { where: { voidedAt: null }, select: { quantity: true, nameSnapshot: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Driver status update: only the assigned driver, only READY → OUT_FOR_DELIVERY →
 * DELIVERED. Optionally records the cash collected (cash on delivery) for the remaining balance.
 */
export async function driverUpdate(ctx: TenantContext, orderId: string, to: 'OUT_FOR_DELIVERY' | 'DELIVERED', cashCollected = false) {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: ctx.org.id, channel: 'DELIVERY' }, include: { delivery: true } });
  if (!order?.delivery) throw new UserFacingError('Delivery not found.', 404);
  if (order.delivery.driverMembershipId !== ctx.membershipId) throw new UserFacingError('This delivery is not assigned to you.', 403);
  const from = to === 'OUT_FOR_DELIVERY' ? 'READY' : 'OUT_FOR_DELIVERY';
  if (order.status !== from) throw new UserFacingError('status_conflict', 409, { current: order.status });
  const { changeOrderStatus } = await import('./orders');
  await changeOrderStatus(ctx, { orderId: order.id, expectedFrom: from, to });
  if (to === 'DELIVERED' && cashCollected && order.paidCents < order.totalCents) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      const due = fresh.totalCents - fresh.paidCents;
      if (due <= 0) return;
      await tx.paymentRecord.create({ data: { organizationId: ctx.org.id, orderId: order.id, amountCents: due, method: 'CASH_ON_DELIVERY', recordedById: ctx.userId, note: 'Collected by driver' } });
      await tx.order.update({ where: { id: order.id }, data: { paidCents: fresh.totalCents, paymentStatus: 'PAID' } });
      await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'payment.recorded', entityType: 'Order', entityId: order.id, metadata: { method: 'CASH_ON_DELIVERY', amountCents: due } }, tx);
    });
  }
}
