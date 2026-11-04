import 'server-only';
import { z } from 'zod';
import type { CountryCode, LanguageCode, OrderChannel, OrderStatus } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { LANGUAGES } from '@/i18n/config';
import { rangesFor, type OpeningHours } from '@/lib/opening-hours';
import { openingHoursSchema } from '@/lib/opening-hours-schema';
import { EVERYWHERE, isValidPostalCode, normalizePostalCode, parseZoneEntry, zonePatternKind, zonePatternMatches, zonePatternSpecificity } from '@/lib/postal';
import { parseMoneyToCents } from '@/lib/money';
import { zonedParts, zonedTimeToUtc } from '@/lib/time';
import { audit, logError } from '../audit';
import { db, type Tx } from '../db';
import { assertModule, hasModule } from '../modules';
import { UserFacingError } from '../errors';
import { asIdentity, type ClientIdentity } from '../client-identity';
import { limitPublic, rateLimit } from '../rate-limit';
import { canPreviewOrg } from './storefront';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { createOrderRecord, OrderRejectedError, trackingTokenFor } from './orders';
import { recomputeOrderPayment } from './bills';
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
/**
 * Same as publicLocation, but also finds an unpublished location when a member of the restaurant
 * asked for a draft preview. Callers must switch ordering off for previews.
 */
async function previewOrPublicLocation(orgSlug: string, locationSlug: string | null | undefined, preview: boolean) {
  const pub = await publicLocation(orgSlug, locationSlug);
  if (pub || !preview) return pub ? { ...pub, isPreview: false } : null;
  const org = await db.restaurantOrganization.findUnique({ where: { slug: orgSlug } });
  if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED' || !(await canPreviewOrg(org.id, true))) return null;
  const location = await db.restaurantLocation.findFirst({
    where: { organizationId: org.id, ...(locationSlug ? { slug: locationSlug } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { takeawaySettings: true, deliverySettings: true, deliveryZones: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
  });
  return location ? { org, location, isPreview: !location.isPublished } : null;
}
export { previewOrPublicLocation };
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
  pickupPoint: z.preprocess((v) => (typeof v === 'string' ? v.trim() || null : null), z.string().max(120).nullable()),
});

export async function updateTakeawaySettings(ctx: TenantContext, input: unknown) {
  await assertModule(ctx.org.id, 'takeaway');
  const d = takeawaySettingsSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const data = { leadTimeMinutes: d.leadTimeMinutes, slotMinutes: d.slotMinutes, minOrderCents: d.minOrder ?? 0, paused: d.paused, pickupHours: d.pickupHours ?? Prisma.DbNull, pickupPoint: d.pickupPoint };
  await db.takeawaySettings.upsert({ where: { locationId: d.locationId }, update: data, create: { locationId: d.locationId, ...data } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'takeaway.settings_updated', entityType: 'RestaurantLocation', entityId: d.locationId, metadata: { ...data, pickupHours: d.pickupHours ? 'custom' : 'opening hours' } });
}

// =============================================================== M9-02 pickup slots

export type PickupOptions = { asap: { allowed: boolean; minutes: number }; slots: { value: string; minuteOfDay: number; dayOffset: number }[] };

/** Most slots offered at once, so the picker stays usable on a phone. */
const MAX_PICKUP_SLOTS = 96;
/** How far ahead to look for the next open day when today has no time left. */
const PICKUP_LOOKAHEAD_DAYS = 7;

/** Open ranges on one weekday, including a range that started the previous day and runs past midnight. */
function rangesOnDay(hours: OpeningHours, weekday: number): Array<[number, number]> {
  return [
    ...rangesFor(hours, weekday),
    ...rangesFor(hours, (weekday + 6) % 7)
      .filter(([, c]) => c > 1440)
      .map(([, c]) => [0, c - 1440] as [number, number]),
  ];
}

/**
 * Pickup times in the location's time zone. Hours = pickup hours, else opening hours. If
 * neither is configured, only "as soon as possible" is offered.
 *
 * When today has no time left — the guest is browsing at 23:30, or the restaurant is closed
 * today — the next open day is offered instead. Without that, a late guest was simply told
 * "no pickup times are available" and could not order at all, which lost the order rather than
 * moving it to tomorrow. Each slot carries `dayOffset` so the picker can label it.
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
  const earliestAt = now.getTime() + lead * 60_000;
  const slots: PickupOptions['slots'] = [];
  // Stop at the first day that has any time left: today's remaining slots if there are any,
  // otherwise the next day the restaurant is actually open.
  for (let dayOffset = 0; dayOffset < PICKUP_LOOKAHEAD_DAYS && slots.length === 0; dayOffset++) {
    const p = zonedParts(new Date(now.getTime() + dayOffset * 86_400_000), location.timeZone);
    const minutes = new Set<number>();
    for (const [o, c] of rangesOnDay(hours, p.weekday)) {
      for (let m = Math.ceil(o / step) * step; m < c; m += step) minutes.add(m);
    }
    for (const m of [...minutes].sort((a, b) => a - b)) {
      // Compared as absolute instants, so the lead time is respected across midnight and
      // across a daylight-saving change.
      const at = zonedTimeToUtc(p.year, p.month, p.day, Math.floor(m / 60), m % 60, location.timeZone);
      if (at.getTime() < earliestAt) continue;
      slots.push({ minuteOfDay: m, value: at.toISOString(), dayOffset });
      if (slots.length >= MAX_PICKUP_SLOTS) break;
    }
  }
  const p0 = zonedParts(now, location.timeZone);
  const nowMin = p0.hour * 60 + p0.minute;
  // "As soon as possible" only when the restaurant is open now and would still be open when the
  // food is ready.
  const openNowWithTime = rangesOnDay(hours, p0.weekday).some(([o, c]) => nowMin >= o && nowMin + lead <= c);
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

/** Two identical submissions raced: the unique (locationId, idempotencyKey) index wins; return that order. */
async function idempotentSubmit<T extends { duplicate: boolean }>(locationId: string, idempotencyKey: string, trackingToken: string, run: () => Promise<T>): Promise<T | { orderNumber: number; trackingToken: string; status: OrderStatus; duplicate: true }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId, idempotencyKey } } });
      if (again) return { orderNumber: again.number, trackingToken, status: again.status, duplicate: true };
    }
    throw e;
  }
}

/** Takeaway/delivery throttling: per guest, per trusted IP, per phone number and per location (audit BUG-05). */
export const REMOTE_ORDER_LIMITS = { guest: [10, 600], ip: [60, 600], phone: [8, 3600], location: [400, 600] } as const;
/** Returns the function that counts the order against the location's cap once it is placed. */
async function limitRemoteOrder(locationId: string, who: ClientIdentity, phone: string) {
  const L = REMOTE_ORDER_LIMITS;
  const countForLocation = await limitPublic(`order:${locationId}`, who, { guest: [...L.guest], ip: [...L.ip], scope: { key: 'location', limit: [...L.location] } });
  await rateLimit(`order:phone:${locationId}:${phone.replace(/\D/g, '')}`, ...L.phone, true);
  return async <T extends { duplicate: boolean }>(result: T) => {
    // The order exists: a failure to count it must not turn the guest's success into an error.
    if (!result.duplicate) await countForLocation().catch((e) => logError('rate-limit-count', e));
    return result;
  };
}

export async function submitPickupOrder(input: unknown, client: string | ClientIdentity, now = new Date()) {
  const d = submitPickupSchema.parse(input);
  const pl = await publicLocation(d.orgSlug, d.locationSlug);
  if (!pl) throw new OrderRejectedError('not_found');
  const { location, org } = pl;
  const blocked = channelAvailable(pl, 'TAKEAWAY', now);
  if (blocked) throw new OrderRejectedError(`ordering_${blocked}`);
  if (!(await hasModule(org.id, 'takeaway'))) throw new OrderRejectedError('module_not_available');
  const trackingToken = trackingTokenFor(location.id, d.idempotencyKey);
  const existing = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: d.idempotencyKey } } });
  if (existing) return { orderNumber: existing.number, trackingToken, status: existing.status, duplicate: true };
  const pickupAt = resolvePickup(d.pickup, pickupOptions(location, location.takeawaySettings, now), now);
  if (!pickupAt) throw new OrderRejectedError('pickup_unavailable');
  const placed = await limitRemoteOrder(location.id, asIdentity(client), d.phone);
  return placed(await idempotentSubmit(location.id, d.idempotencyKey, trackingToken, () => db.$transaction(async (tx) => {
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
  })));
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
  await assertModule(ctx.org.id, 'delivery');
  const d = deliverySettingsSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const { locationId, deliveryHours, ...rest } = d;
  const data = { ...rest, deliveryHours: deliveryHours ?? Prisma.DbNull };
  await db.deliverySettings.upsert({ where: { locationId }, update: data, create: { locationId, ...data } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'delivery.settings_updated', entityType: 'RestaurantLocation', entityId: locationId, metadata: rest });
}

/**
 * Where a zone delivers, from what the owner typed (comma, semicolon or new line separated):
 * postal areas ("4700" = every 4700-xxx code), exact codes, towns ("Braga") or "*" for
 * everywhere. Lenient on format; refuses only values that cannot be a postal code or a town.
 */
export function parseZonePatterns(country: CountryCode, raw: string): string[] {
  const entries = raw.split(/[,\n;]/).map((p) => p.trim()).filter(Boolean);
  if (entries.length === 0) throw new UserFacingError(`Add at least one postal area or town (e.g. ${country === 'PT' ? '4700, Braga' : '28001, Madrid'}), or * for everywhere.`);
  const out: string[] = [];
  for (const e of entries) {
    const p = parseZoneEntry(country, e);
    if (!p) throw new UserFacingError(`“${e}” is not a valid ${country === 'PT' ? 'Portuguese' : 'Spanish'} postal code, postal area or town. Use e.g. ${country === 'PT' ? '4700, 4700-123 or Braga' : '280, 28013 or Madrid'}.`);
    if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  // "Everywhere" already covers every other entry of the same zone.
  return out.includes(EVERYWHERE) ? [EVERYWHERE] : out;
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

/** Restaurant-defined delivery zone. Fees come only from these zones (no distance pricing: no paid map service). */
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

export type ZoneTestResult = { valid: boolean; zone: { name: string; feeCents: number; minOrderCents: number; freeDeliveryThresholdCents: number | null; estimatedMinutes: number | null } | null; needsCity: boolean; postalCode: string };

/** Owner's check: which active zone (and fee) a guest at this postal code and town would get. Reads only. */
export async function testDeliveryAddress(ctx: TenantContext, input: unknown): Promise<ZoneTestResult> {
  const d = z.object({ locationId: z.string().min(1), postalCode: z.string().trim().max(12), city: z.string().trim().max(80).default('') }).parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const location = await db.restaurantLocation.findFirstOrThrow({ where: { id: d.locationId, organizationId: ctx.org.id }, include: { deliveryZones: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } });
  const { valid, zone, needsCity } = findZone(location.country, location.deliveryZones, d.postalCode, d.city);
  return {
    valid,
    needsCity,
    postalCode: normalizePostalCode(location.country, d.postalCode),
    zone: zone && { name: zone.name, feeCents: zone.feeCents, minOrderCents: zone.minOrderCents, freeDeliveryThresholdCents: zone.freeDeliveryThresholdCents, estimatedMinutes: zone.estimatedMinutes },
  };
}

/**
 * The zone that delivers to this address. Several zones can cover it (e.g. "Braga centre" 4700
 * and "Everywhere"): the most specific match wins, then the zone added first. `needsCity`: no
 * zone yet, but a town-based zone might match once the guest types their town.
 */
export function findZone<Z extends { postalCodePatterns: string[]; isActive: boolean }>(country: CountryCode, zones: Z[], postal: string, city = ''): { valid: boolean; zone: Z | null; needsCity: boolean } {
  if (!isValidPostalCode(country, postal)) return { valid: false, zone: null, needsCity: false };
  let best: { zone: Z; score: number } | null = null;
  for (const zn of zones) {
    if (!zn.isActive) continue;
    const score = Math.max(0, ...zn.postalCodePatterns.filter((p) => zonePatternMatches(country, postal, city, p)).map(zonePatternSpecificity));
    if (score > 0 && (!best || score > best.score)) best = { zone: zn, score };
  }
  const needsCity = !best && !city.trim() && zones.some((zn) => zn.isActive && zn.postalCodePatterns.some((p) => zonePatternKind(p) === 'town'));
  return { valid: true, zone: best?.zone ?? null, needsCity };
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
  /** Not covered yet: a zone is set by town, and the guest has not typed theirs. */
  needsCity: boolean;
  issues: Awaited<ReturnType<typeof quoteCart>>['issues'];
};

export async function quoteDelivery(pl: PublicLocation, postal: string, lang: LanguageCode, items: unknown, now = new Date(), couponCode?: string, city = ''): Promise<DeliveryQuote> {
  const { location } = pl;
  const q = await quoteCart({ locationId: location.id, channel: 'DELIVERY', lang, items: cartSchema.parse(items), now });
  const promo = await computeDiscounts(db, { organizationId: location.organizationId, locationId: location.id, channel: 'DELIVERY', couponCode, lines: q.lines, subtotalCents: q.subtotalCents, now });
  const after = q.subtotalCents - promo.totalCents;
  const { valid, zone, needsCity } = findZone(location.country, location.deliveryZones, postal, city);
  const est = zone?.estimatedMinutes ?? (location.deliverySettings?.prepEstimateMinutes ?? 25) + (location.deliverySettings?.deliveryEstimateMinutes ?? 30);
  if (!zone) return { valid, covered: false, needsCity, feeCents: 0, minOrderCents: 0, freeFromCents: null, subtotalCents: q.subtotalCents, discountCents: promo.totalCents, totalCents: after, meetsMinimum: false, estimatedMinutes: est, issues: q.issues };
  const free = zone.freeDeliveryThresholdCents !== null && after >= zone.freeDeliveryThresholdCents;
  const fee = free ? 0 : zone.feeCents;
  return {
    valid,
    covered: true,
    needsCity: false,
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
export async function submitDeliveryOrder(input: unknown, client: string | ClientIdentity, now = new Date()) {
  const d = submitDeliverySchema.parse(input);
  const pl = await publicLocation(d.orgSlug, d.locationSlug);
  if (!pl) throw new OrderRejectedError('not_found');
  const { location, org } = pl;
  const blocked = channelAvailable(pl, 'DELIVERY', now);
  if (blocked) throw new OrderRejectedError(`ordering_${blocked}`);
  if (!(await hasModule(org.id, 'delivery'))) throw new OrderRejectedError('module_not_available');
  const settings = location.deliverySettings;
  if (d.paymentMethod === 'CASH_ON_DELIVERY' && !(settings?.cashOnDeliveryEnabled ?? true)) throw new OrderRejectedError('payment_method_unavailable');
  if (d.paymentMethod === 'CARD_TERMINAL' && !settings?.cardOnDeliveryEnabled) throw new OrderRejectedError('payment_method_unavailable');
  const trackingToken = trackingTokenFor(location.id, d.idempotencyKey);
  const existing = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: d.idempotencyKey } } });
  if (existing) return { orderNumber: existing.number, trackingToken, status: existing.status, duplicate: true };
  const { valid, zone } = findZone(location.country, location.deliveryZones, d.postalCode, d.city);
  if (!valid) throw new OrderRejectedError('invalid_postal_code');
  if (!zone) throw new OrderRejectedError('outside_delivery_zone');
  const placed = await limitRemoteOrder(location.id, asIdentity(client), d.phone);
  return placed(await idempotentSubmit(location.id, d.idempotencyKey, trackingToken, () => db.$transaction(async (tx) => {
    // Order number first: the location row stays locked until this transaction ends, so delivery
    // orders placed at the same moment are counted one after the other and cannot exceed the cap.
    const { orderSequence } = await tx.restaurantLocation.update({ where: { id: location.id }, data: { orderSequence: { increment: 1 } }, select: { orderSequence: true } });
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
    // The restaurant's drivers receive the order automatically: one driver gets it at once;
    // with several, it stays open to all of them and the first to confirm pickup takes it.
    const drivers = await locationDrivers(org.id, location.id, tx);
    await tx.deliveryOrderDetails.create({
      data: {
        orderId: order.id,
        zoneId: zone.id,
        recipientName: d.customerName,
        addressLine: d.address,
        postalCode: normalizePostalCode(location.country, d.postalCode),
        city: d.city,
        phone: d.phone,
        notes: d.deliveryNotes?.trim() || null,
        driverMembershipId: drivers.length === 1 ? drivers[0].id : null,
      },
    });
    await tx.notification.create({ data: { organizationId: org.id, locationId: location.id, type: 'NEW_ORDER', title: `New delivery order #${order.number} — ${zone.name}`, entityId: order.id } });
    return { orderNumber: order.number, trackingToken, status: order.status, duplicate: false, deliveryFeeCents: fee };
  })));
}

// =============================================================== M9-07/08 drivers

export async function listDrivers(ctx: TenantContext) {
  return db.restaurantMembership.findMany({ where: { organizationId: ctx.org.id, status: 'ACTIVE', role: 'DELIVERY_STAFF' }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
}

/**
 * The drivers who receive this location's delivery orders: every active member with the
 * "Delivery staff" role who works there (no locations set = every location). Set up once on the
 * Staff page; nobody picks a driver per order.
 */
export async function locationDrivers(organizationId: string, locationId: string, tx: Tx | typeof db = db) {
  const all = await tx.restaurantMembership.findMany({ where: { organizationId, status: 'ACTIVE', role: 'DELIVERY_STAFF' }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
  return all.filter((d) => d.locationIds.length === 0 || d.locationIds.includes(locationId));
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

/**
 * Staff screens (Live Orders): when the location has drivers, pickup and delivery are confirmed by
 * the driver on their phone, so staff never repeat that step. Without driver accounts (the owner
 * delivers himself) staff mark it as before.
 */
export async function assertStaffMayMoveDelivery(ctx: TenantContext, orderId: string, to: unknown) {
  if (to !== 'OUT_FOR_DELIVERY' && to !== 'DELIVERED') return;
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: ctx.org.id }, select: { channel: true, locationId: true } });
  if (!order || order.channel !== 'DELIVERY') return;
  if ((await locationDrivers(ctx.org.id, order.locationId)).length > 0) throw new UserFacingError('The driver confirms this on their phone (My deliveries) when they collect and deliver the order.');
}

/**
 * A delivery is open to every driver of its location while nobody has it: not assigned yet, or
 * assigned to someone who no longer works here (a deactivated account cannot block it).
 */
export const openDelivery = { OR: [{ driverMembershipId: null }, { driver: { status: { not: 'ACTIVE' as const } } }] };

/**
 * The driver's list, without anyone assigning it: the deliveries given to this driver plus the
 * open ones at the locations they work at (with several drivers, the first to confirm pickup
 * takes it). Finished deliveries: their own, of the last 12 hours.
 */
export async function myDeliveries(ctx: TenantContext) {
  const here = ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {};
  return db.order.findMany({
    where: {
      organizationId: ctx.org.id,
      channel: 'DELIVERY',
      ...here,
      OR: [
        { status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] }, delivery: { OR: [{ driverMembershipId: ctx.membershipId }, openDelivery] } },
        { status: { in: ['DELIVERED', 'COMPLETED'] }, updatedAt: { gte: new Date(Date.now() - 12 * 3600_000) }, delivery: { driverMembershipId: ctx.membershipId } },
      ],
    },
    include: { delivery: true, items: { where: { voidedAt: null }, select: { quantity: true, nameSnapshot: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Driver status update, READY → OUT_FOR_DELIVERY → DELIVERED. Confirming pickup (the staff
 * handed the bag over) also takes an open delivery for this driver; if another driver confirmed
 * first, this one is told so and nothing changes. Only the driver who has it can mark it
 * delivered. Optionally records the cash collected (cash on delivery) for the remaining balance.
 */
export async function driverUpdate(ctx: TenantContext, orderId: string, to: 'OUT_FOR_DELIVERY' | 'DELIVERED', cashCollected = false) {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: ctx.org.id, channel: 'DELIVERY' }, include: { delivery: { include: { driver: { select: { status: true } } } } } });
  if (!order?.delivery) throw new UserFacingError('Delivery not found.', 404);
  await assertLocationAccess(ctx, order.locationId);
  const from = to === 'OUT_FOR_DELIVERY' ? 'READY' : 'OUT_FOR_DELIVERY';
  if (order.status !== from) throw new UserFacingError('status_conflict', 409, { current: order.status });
  // The guest chose card at the door: the driver's terminal takes it, never recorded as cash
  // (the driver page hides the cash box for these; a direct request is refused here too).
  if (to === 'DELIVERED' && cashCollected && order.paymentMethodIntent === 'CARD_TERMINAL') {
    throw new UserFacingError('This order is paid by card at the door, so it cannot be recorded as cash. Confirm the delivery without “cash collected”.');
  }
  const mine = order.delivery.driverMembershipId === ctx.membershipId;
  const open = !order.delivery.driverMembershipId || order.delivery.driver?.status !== 'ACTIVE';
  if (!mine && !(to === 'OUT_FOR_DELIVERY' && open)) throw new UserFacingError(to === 'OUT_FOR_DELIVERY' ? 'Another driver already has this delivery.' : 'This delivery is not assigned to you.', 403);
  const { changeOrderStatus } = await import('./orders');
  if (!mine) {
    // Take it, unless another driver confirmed at the same moment.
    const taken = await db.deliveryOrderDetails.updateMany({ where: { orderId: order.id, ...openDelivery }, data: { driverMembershipId: ctx.membershipId } });
    if (taken.count !== 1) throw new UserFacingError('Another driver already has this delivery.', 409);
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'delivery.driver_assigned', entityType: 'Order', entityId: order.id, metadata: { membershipId: ctx.membershipId, by: 'driver_pickup' } });
  }
  // The cash is recorded in the same transaction as DELIVERED (audit OPS-53): never a delivered
  // order whose collected cash failed to save, nor cash on an order that did not become delivered.
  const recordCash =
    to === 'DELIVERED' && cashCollected
      ? async (tx: Tx) => {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
          const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
          const due = fresh.totalCents - fresh.paidCents;
          if (due <= 0) return;
          const p = await tx.paymentRecord.create({ data: { organizationId: ctx.org.id, orderId: order.id, amountCents: due, method: 'CASH_ON_DELIVERY', recordedById: ctx.userId, note: 'Collected by driver' } });
          await recomputeOrderPayment(tx, order.id);
          await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'payment.recorded', entityType: 'Order', entityId: order.id, metadata: { method: 'CASH_ON_DELIVERY', amountCents: due, payments: [p.id], by: 'driver' } }, tx);
        }
      : undefined;
  try {
    await changeOrderStatus(ctx, { orderId: order.id, expectedFrom: from, to }, recordCash);
  } catch (e) {
    // Status changed meanwhile (e.g. cancelled): give the delivery back as it was.
    if (!mine) await db.deliveryOrderDetails.updateMany({ where: { orderId: order.id, driverMembershipId: ctx.membershipId }, data: { driverMembershipId: order.delivery.driverMembershipId } });
    throw e;
  }
}
