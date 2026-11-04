import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { audit, logError } from '../audit';
import { db, type Tx } from '../db';
import { UserFacingError } from '../errors';
import { type TenantContext } from '../tenant';
import { eraseLoyaltyAccount } from './loyalty';

/**
 * GDPR tools (M13-02) for guest personal data held by ONE restaurant:
 * - access/portability: export everything linked to a phone number or email;
 * - erasure: anonymise it (amounts and dish lines stay for the restaurant's accounting);
 * - retention: contact details of finished orders, past reservations, feedback follow-ups and
 *   inactive loyalty members are erased after the restaurant's retention period.
 * Identifiers are never written to the audit log (only a hash and counts).
 */

export const ERASED = '[erased]';
const FINISHED = ['COMPLETED', 'DELIVERED', 'CANCELLED'] as const;

export type GuestKey = { kind: 'phone'; digits: string } | { kind: 'email'; email: string };

/** Accepts a phone number (≥ 9 digits, any formatting) or an email address. */
export function parseGuestKey(raw: string): GuestKey {
  const v = raw.trim();
  if (v.includes('@')) {
    const email = z.string().trim().toLowerCase().email().max(254).safeParse(v);
    if (!email.success) throw new UserFacingError('Enter a valid email address or phone number.');
    return { kind: 'email', email: email.data };
  }
  const digits = v.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) throw new UserFacingError('Enter a valid email address or phone number.');
  return { kind: 'phone', digits };
}
const keyHash = (k: GuestKey) => createHash('sha256').update(k.kind === 'phone' ? k.digits : k.email).digest('hex').slice(0, 16);

/**
 * A phone matches when its digits end with the searched number's last 9 digits, so
 * "+351 912 345 678", "912345678" and "00351912345678" are the same guest.
 */
async function matchingIds(organizationId: string, k: GuestKey, tx: Tx | typeof db = db) {
  if (k.kind === 'email') {
    const [reservations, feedback] = await Promise.all([
      tx.reservation.findMany({ where: { organizationId, email: { equals: k.email, mode: 'insensitive' } }, select: { id: true } }),
      tx.customerFeedback.findMany({ where: { organizationId, contactInfo: { equals: k.email, mode: 'insensitive' } }, select: { id: true } }),
    ]);
    return { orders: [] as string[], reservations: reservations.map((r) => r.id), feedback: feedback.map((f) => f.id), loyalty: [] as string[] };
  }
  const tail = `%${k.digits.slice(-9)}`;
  const [orders, deliveries, reservations, feedback, loyalty] = await Promise.all([
    tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE "organizationId" = ${organizationId} AND regexp_replace(coalesce("customerPhone", ''), '\\D', '', 'g') LIKE ${tail}`,
    tx.$queryRaw<{ id: string }[]>`SELECT d."orderId" AS id FROM "DeliveryOrderDetails" d JOIN "Order" o ON o.id = d."orderId" WHERE o."organizationId" = ${organizationId} AND regexp_replace(d.phone, '\\D', '', 'g') LIKE ${tail}`,
    tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Reservation" WHERE "organizationId" = ${organizationId} AND regexp_replace(phone, '\\D', '', 'g') LIKE ${tail}`,
    tx.$queryRaw<{ id: string }[]>`SELECT id FROM "CustomerFeedback" WHERE "organizationId" = ${organizationId} AND regexp_replace(coalesce("contactInfo", ''), '\\D', '', 'g') LIKE ${tail}`,
    tx.$queryRaw<{ id: string }[]>`SELECT id FROM "LoyaltyAccount" WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE ${tail}`,
  ]);
  return {
    orders: [...new Set([...orders, ...deliveries].map((r) => r.id))],
    reservations: reservations.map((r) => r.id),
    feedback: feedback.map((r) => r.id),
    loyalty: loyalty.map((r) => r.id),
  };
}

export async function findGuestData(ctx: TenantContext, raw: string) {
  const k = parseGuestKey(raw);
  const ids = await matchingIds(ctx.org.id, k);
  return { orders: ids.orders.length, reservations: ids.reservations.length, feedback: ids.feedback.length, loyalty: ids.loyalty.length };
}

/** Everything this restaurant holds about the guest, as a portable JSON document. */
export async function exportGuestData(ctx: TenantContext, raw: string) {
  const k = parseGuestKey(raw);
  const ids = await matchingIds(ctx.org.id, k);
  const [orders, reservations, feedback, loyalty] = await Promise.all([
    db.order.findMany({
      where: { id: { in: ids.orders }, organizationId: ctx.org.id },
      orderBy: { createdAt: 'asc' },
      select: {
        number: true, channel: true, status: true, createdAt: true, customerName: true, customerPhone: true, customerNotes: true, totalCents: true, paidCents: true, currency: true,
        items: { select: { customerNameSnapshot: true, nameSnapshot: true, quantity: true, lineTotalCents: true, notes: true } },
        delivery: { select: { recipientName: true, addressLine: true, postalCode: true, city: true, phone: true, notes: true } },
      },
    }),
    db.reservation.findMany({ where: { id: { in: ids.reservations }, organizationId: ctx.org.id }, orderBy: { startsAt: 'asc' }, select: { startsAt: true, partySize: true, name: true, phone: true, email: true, specialRequest: true, status: true, createdAt: true } }),
    db.customerFeedback.findMany({ where: { id: { in: ids.feedback }, organizationId: ctx.org.id }, select: { createdAt: true, rating: true, categories: true, comment: true, contactName: true, contactInfo: true } }),
    db.loyaltyAccount.findMany({ where: { id: { in: ids.loyalty }, organizationId: ctx.org.id }, select: { phone: true, name: true, balance: true, marketingOptIn: true, marketingOptInAt: true, birthday: true, consentAt: true, createdAt: true, transactions: { select: { type: true, amount: true, createdAt: true, note: true } } } }),
  ]);
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'privacy.data_exported', entityType: 'GuestData', metadata: { keyHash: keyHash(k), orders: orders.length, reservations: reservations.length, feedback: feedback.length, loyalty: loyalty.length } });
  return { restaurant: ctx.org.name, generatedAt: new Date().toISOString(), note: 'Personal data held by this restaurant on MenuNiva. Amounts are in cents.', orders, reservations, feedback, loyalty };
}

async function eraseIds(tx: Tx, organizationId: string, ids: { orders: string[]; reservations: string[]; feedback: string[]; loyalty: string[] }) {
  const o = await tx.order.updateMany({ where: { id: { in: ids.orders }, organizationId }, data: { customerName: null, customerPhone: null, customerNotes: null } });
  await tx.orderItem.updateMany({ where: { orderId: { in: ids.orders }, organizationId, notes: { not: null } }, data: { notes: null } });
  await tx.deliveryOrderDetails.updateMany({ where: { orderId: { in: ids.orders }, order: { organizationId } }, data: { recipientName: ERASED, addressLine: ERASED, phone: ERASED, notes: null } });
  const r = await tx.reservation.updateMany({ where: { id: { in: ids.reservations }, organizationId }, data: { name: ERASED, phone: ERASED, email: null, specialRequest: null } });
  const f = await tx.customerFeedback.updateMany({ where: { id: { in: ids.feedback }, organizationId }, data: { contactName: null, contactInfo: null, wantsFollowUp: false } });
  for (const id of ids.loyalty) await eraseLoyaltyAccount(tx, id);
  return { orders: o.count, reservations: r.count, feedback: f.count, loyalty: ids.loyalty.length };
}

/** Guest erasure request. The staff member must type ERASE to confirm. */
export async function eraseGuestData(ctx: TenantContext, raw: string, confirmation: string) {
  if (confirmation.trim().toUpperCase() !== 'ERASE') throw new UserFacingError('Type ERASE to confirm.');
  const k = parseGuestKey(raw);
  return db.$transaction(async (tx) => {
    const counts = await eraseIds(tx, ctx.org.id, await matchingIds(ctx.org.id, k, tx));
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'privacy.data_erased', entityType: 'GuestData', metadata: { keyHash: keyHash(k), ...counts } }, tx);
    return counts;
  });
}

export async function updateRetention(ctx: TenantContext, days: unknown) {
  const d = z.coerce.number().int().min(30).max(3650).parse(days);
  await db.restaurantSettings.upsert({ where: { organizationId: ctx.org.id }, update: { dataRetentionDays: d }, create: { organizationId: ctx.org.id, dataRetentionDays: d } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'privacy.retention_updated', entityType: 'RestaurantSettings', metadata: { days: d } });
}

/**
 * Retention job (run daily: `npm run retention`). Per restaurant, erases guest contact data older
 * than its retention period, then removes expired platform security records.
 */
export async function applyRetention(now = new Date()) {
  const orgs = await db.restaurantOrganization.findMany({ select: { id: true, settings: { select: { dataRetentionDays: true } } } });
  const totals = { orders: 0, reservations: 0, feedback: 0, loyalty: 0 };
  let failedRestaurants = 0;
  for (const org of orgs) {
    // One restaurant that cannot be processed (e.g. a very large first run) is logged and retried
    // the next day; it never stops the others.
    try {
      await retainOrg(org, now, totals);
    } catch (e) {
      failedRestaurants++;
      await logError('retention', e, { organizationId: org.id });
    }
  }
  const day = 86400_000;
  const [sessions, resets, setupTokens, invitations, buckets, tableDevices, errors] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 30 * day) } }, { usedAt: { lt: new Date(now.getTime() - 30 * day) } }] } }),
    db.platformSetupToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 30 * day) } } }),
    db.invitation.deleteMany({ where: { acceptedAt: null, OR: [{ expiresAt: { lt: new Date(now.getTime() - 30 * day) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * day) } }] } }),
    db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 2 * day) } } }),
    // Phone authorisations of table seatings closed more than 30 days ago (only hashes; orders keep
    // their data, the link to the phone is cleared).
    db.tableSessionDevice.deleteMany({ where: { tableSession: { status: 'CLOSED', closedAt: { lt: new Date(now.getTime() - 30 * day) } } } }),
    db.errorLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * day) } } }),
  ]);
  return { guestData: totals, failedRestaurants, platform: { sessions: sessions.count, resetTokens: resets.count, setupTokens: setupTokens.count, invitations: invitations.count, rateLimitBuckets: buckets.count, tableDevices: tableDevices.count, errorLogs: errors.count } };
}

async function retainOrg(org: { id: string; settings: { dataRetentionDays: number } | null }, now: Date, totals: { orders: number; reservations: number; feedback: number; loyalty: number }) {
  {
    const cutoff = new Date(now.getTime() - (org.settings?.dataRetentionDays ?? 730) * 86400_000);
    const [orders, deliveries, reservations, feedback, loyalty] = await Promise.all([
      db.order.findMany({ where: { organizationId: org.id, status: { in: [...FINISHED] }, createdAt: { lt: cutoff }, OR: [{ customerName: { not: null } }, { customerPhone: { not: null } }, { customerNotes: { not: null } }] }, select: { id: true } }),
      db.deliveryOrderDetails.findMany({ where: { order: { organizationId: org.id, status: { in: [...FINISHED] }, createdAt: { lt: cutoff } }, NOT: { phone: ERASED } }, select: { orderId: true } }),
      db.reservation.findMany({ where: { organizationId: org.id, endsAt: { lt: cutoff }, NOT: { name: ERASED } }, select: { id: true } }),
      db.customerFeedback.findMany({ where: { organizationId: org.id, createdAt: { lt: cutoff }, OR: [{ contactName: { not: null } }, { contactInfo: { not: null } }] }, select: { id: true } }),
      // Members with no activity (joining or any stamp/point movement) within the period.
      db.loyaltyAccount.findMany({ where: { organizationId: org.id, deletedAt: null, createdAt: { lt: cutoff }, transactions: { none: { createdAt: { gte: cutoff } } } }, select: { id: true } }),
    ]);
    const ids = { orders: [...new Set([...orders.map((x) => x.id), ...deliveries.map((x) => x.orderId)])], reservations: reservations.map((x) => x.id), feedback: feedback.map((x) => x.id), loyalty: loyalty.map((x) => x.id) };
    if (!ids.orders.length && !ids.reservations.length && !ids.feedback.length && !ids.loyalty.length) return;
    // A first run on years of data can erase many rows: more time than the 5 s default.
    const c = await db.$transaction((tx) => eraseIds(tx, org.id, ids), { timeout: 60_000 });
    await audit({ organizationId: org.id, action: 'privacy.retention_applied', entityType: 'GuestData', metadata: { ...c, cutoff: cutoff.toISOString() } });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += c[k];
  }
}
