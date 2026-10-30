import 'server-only';
import { z } from 'zod';
import type { LanguageCode } from '@/generated/prisma/enums';
import { audit } from '../audit';
import { hashToken } from '../crypto';
import { db, type Tx } from '../db';
import { assertModule, hasModule } from '../modules';
import { UserFacingError } from '../errors';
import { asIdentity, type ClientIdentity } from '../client-identity';
import { limitPublic } from '../rate-limit';
import type { TenantContext } from '../tenant';

/**
 * Loyalty (Part 16 / M11-06..08).
 * - Joining is voluntary, from the guest's own order page, with explicit consent.
 * - Marketing opt-in is a separate, unticked choice. Birthday only with its own consent.
 * - Stamps/points are earned only when an order is COMPLETED or DELIVERED *and* fully paid.
 * - Nothing here is connected to reviews or feedback (no incentive for reviews).
 * - Earned lots expire after `expiryDays`; redemptions consume the oldest lots first.
 */

type Program = { enabled: boolean; type: 'STAMPS' | 'POINTS'; pointsPerEuro: number; stampsForReward: number; rewardDescription: unknown; expiryDays: number | null };

export function rewardText(program: Pick<Program, 'rewardDescription'> | null, lang: string, fallback: string): string | null {
  const r = (program?.rewardDescription ?? null) as Record<string, string> | null;
  if (!r) return null;
  return r[lang] || r[fallback] || Object.values(r).find(Boolean) || null;
}

/** Normalises what the guest typed into one comparable form. Returns null when it is not a phone number. */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+?\d{9,15}$/.test(s) ? s : null;
}

/** Amount one paid order earns: 1 stamp, or whole points for the goods value (delivery fee excluded). */
export function earnAmount(program: Pick<Program, 'type' | 'pointsPerEuro'>, order: { totalCents: number; deliveryFeeCents: number }): number {
  if (program.type === 'STAMPS') return 1;
  return Math.floor((Math.max(0, order.totalCents - order.deliveryFeeCents) * program.pointsPerEuro) / 100);
}

export const programSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(['STAMPS', 'POINTS']),
    stampsForReward: z.coerce.number().int().min(1).max(10000),
    pointsPerEuro: z.coerce.number().int().min(1).max(100),
    rewardText: z.string().trim().max(200).optional(),
    expiryDays: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().min(30).max(1095).nullable()),
  })
  .refine((d) => !d.enabled || !!d.rewardText, { path: ['rewardText'], message: 'Describe the reward before switching loyalty on.' });

export async function updateLoyaltyProgram(ctx: TenantContext, input: unknown) {
  await assertModule(ctx.org.id, 'loyalty');
  const d = programSchema.parse(input);
  const { sourceLanguage: lang } = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true } });
  const data = { enabled: d.enabled, type: d.type, stampsForReward: d.stampsForReward, pointsPerEuro: d.pointsPerEuro, expiryDays: d.expiryDays, rewardDescription: d.rewardText ? { [lang]: d.rewardText } : undefined };
  await db.loyaltyProgram.upsert({ where: { organizationId: ctx.org.id }, update: data, create: { organizationId: ctx.org.id, ...data } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'loyalty.program_updated', entityType: 'LoyaltyProgram', entityId: ctx.org.id, metadata: { enabled: d.enabled, type: d.type } });
}

// ------------------------------------------------------------------ guest side

const enrolSchema = z
  .object({
    orderToken: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
    phone: z.string().max(30),
    name: z.string().trim().max(80).optional(),
    consent: z.literal(true),
    marketingOptIn: z.boolean().default(false),
    birthday: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
    birthdayConsent: z.boolean().default(false),
  })
  .refine((d) => !d.birthday || d.birthdayConsent, { path: ['birthdayConsent'], message: 'required' });

async function orderByToken(token: string) {
  return db.order.findUnique({ where: { trackingTokenHash: hashToken(token) }, include: { loyaltyAccount: true } });
}

/** What the guest's order page shows about loyalty. Never exposes the phone number. */
export async function loyaltyForOrder(token: string, lang: LanguageCode) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const order = await orderByToken(token);
  if (!order) return null;
  const [program, org] = await Promise.all([db.loyaltyProgram.findUnique({ where: { organizationId: order.organizationId } }), db.restaurantOrganization.findUniqueOrThrow({ where: { id: order.organizationId } })]);
  if (!program?.enabled || !(await hasModule(order.organizationId, 'loyalty'))) return null;
  const account = order.loyaltyAccount && !order.loyaltyAccount.deletedAt ? order.loyaltyAccount : null;
  if (account) await expireLoyalty(order.organizationId, new Date(), account.id);
  const fresh = account ? await db.loyaltyAccount.findUnique({ where: { id: account.id } }) : null;
  const earned = account ? await db.loyaltyTransaction.findFirst({ where: { accountId: account.id, orderId: order.id, type: 'EARN' } }) : null;
  return {
    type: program.type,
    target: program.stampsForReward,
    reward: rewardText(program, lang, org.sourceLanguage),
    expiryDays: program.expiryDays,
    joined: !!fresh,
    balance: fresh?.balance ?? 0,
    earnedForThisOrder: !!earned,
    pendingEarn: earnAmount(program, order),
  };
}

export async function enrolFromOrder(input: unknown, client: string | ClientIdentity) {
  const d = enrolSchema.parse(input);
  const phone = normalizePhone(d.phone);
  if (!phone) throw new UserFacingError('invalid_phone', 422);
  await limitPublic('loyalty-enrol', asIdentity(client), { guest: [5, 3600], ip: [50, 3600] });
  const order = await orderByToken(d.orderToken);
  if (!order || order.status === 'CANCELLED') throw new UserFacingError('not_found', 404);
  const program = await db.loyaltyProgram.findUnique({ where: { organizationId: order.organizationId } });
  if (!program?.enabled) throw new UserFacingError('loyalty_disabled', 422);
  await assertModule(order.organizationId, 'loyalty');
  if (order.loyaltyAccountId && order.loyaltyAccount && !order.loyaltyAccount.deletedAt) throw new UserFacingError('already_joined', 409);
  const now = new Date();
  await db.$transaction(async (tx) => {
    const existing = await tx.loyaltyAccount.findUnique({ where: { organizationId_phone: { organizationId: order.organizationId, phone } } });
    // An existing member's consent choices are never changed from an order page: whoever types a
    // phone number must not be able to opt someone else into marketing.
    const account =
      existing ??
      (await tx.loyaltyAccount.create({
        data: {
          organizationId: order.organizationId,
          phone,
          name: d.name || null,
          consentAt: now,
          marketingOptIn: d.marketingOptIn,
          marketingOptInAt: d.marketingOptIn ? now : null,
          birthday: d.birthday && d.birthdayConsent ? d.birthday : null,
        },
      }));
    await tx.order.update({ where: { id: order.id }, data: { loyaltyAccountId: account.id } });
    await syncLoyaltyForOrder(tx, order.id);
  });
  return { joined: true };
}

// ------------------------------------------------------------------ earning

/**
 * Idempotently brings an order's loyalty earn in line with its state. Called after every status
 * change and payment change. Earns once when the order is finished and fully paid; reverses the
 * earn (ADJUST) if a payment is later voided.
 */
export async function syncLoyaltyForOrder(tx: Tx, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty:${orderId}`}))`;
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { loyaltyAccount: true } });
  if (!order?.loyaltyAccount || order.loyaltyAccount.deletedAt) return;
  const program = await tx.loyaltyProgram.findUnique({ where: { organizationId: order.organizationId } });
  const rows = await tx.loyaltyTransaction.findMany({ where: { orderId, accountId: order.loyaltyAccount.id, type: { in: ['EARN', 'ADJUST'] } } });
  const net = rows.reduce((s, r) => s + r.amount, 0);
  const qualifies = (order.status === 'COMPLETED' || order.status === 'DELIVERED') && order.paymentStatus === 'PAID';
  if (qualifies && net <= 0 && program?.enabled) {
    const amount = earnAmount(program, order);
    if (amount <= 0) return;
    const expiresAt = program.expiryDays ? new Date(Date.now() + program.expiryDays * 86400_000) : null;
    await tx.loyaltyTransaction.create({ data: { accountId: order.loyaltyAccount.id, orderId, type: 'EARN', amount, expiresAt, note: `Order #${order.number}` } });
    await tx.loyaltyAccount.update({ where: { id: order.loyaltyAccount.id }, data: { balance: { increment: amount } } });
  } else if (!qualifies && net > 0) {
    // The ledger stays exact: if the reward was already redeemed, the balance may go below zero.
    await tx.loyaltyTransaction.create({ data: { accountId: order.loyaltyAccount.id, orderId, type: 'ADJUST', amount: -net, note: `Order #${order.number} no longer fully paid` } });
    await tx.loyaltyAccount.update({ where: { id: order.loyaltyAccount.id }, data: { balance: { decrement: net } } });
  }
}

/** Expires earned lots past their date that were not already used (oldest lots are used first). */
export async function expireLoyalty(organizationId: string, now = new Date(), accountId?: string) {
  const accounts = await db.loyaltyAccount.findMany({
    where: { organizationId, deletedAt: null, balance: { gt: 0 }, ...(accountId ? { id: accountId } : {}), transactions: { some: { type: 'EARN', expiresAt: { lte: now } } } },
    select: { id: true },
  });
  let expired = 0;
  for (const a of accounts) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "LoyaltyAccount" WHERE id = ${a.id} FOR UPDATE`;
      const txs = await tx.loyaltyTransaction.findMany({ where: { accountId: a.id }, orderBy: { createdAt: 'asc' } });
      let debits = txs.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
      let toExpire = 0;
      for (const lot of txs.filter((t) => t.amount > 0)) {
        const used = Math.min(lot.amount, debits);
        debits -= used;
        if (lot.expiresAt && lot.expiresAt <= now) toExpire += lot.amount - used;
      }
      const acc = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: a.id } });
      toExpire = Math.min(toExpire, acc.balance);
      if (toExpire > 0) {
        await tx.loyaltyTransaction.create({ data: { accountId: a.id, type: 'EXPIRE', amount: -toExpire, note: 'Expired' } });
        await tx.loyaltyAccount.update({ where: { id: a.id }, data: { balance: { decrement: toExpire } } });
        expired += toExpire;
      }
    });
  }
  return expired;
}

// ------------------------------------------------------------------ staff side

async function ownedAccount(ctx: TenantContext, id: string) {
  const a = await db.loyaltyAccount.findFirst({ where: { id, organizationId: ctx.org.id, deletedAt: null } });
  if (!a) throw new UserFacingError('Member not found.', 404);
  return a;
}

/** Members, optionally only those (with birthday consent) whose birthday falls in `birthdayMonth` (1–12). */
export async function loyaltyMembers(ctx: TenantContext, search?: string, birthdayMonth?: number) {
  await expireLoyalty(ctx.org.id);
  const q = search?.trim();
  const phone = q ? normalizePhone(q) : null;
  return db.loyaltyAccount.findMany({
    where: {
      organizationId: ctx.org.id,
      deletedAt: null,
      ...(q ? { OR: [{ phone: { contains: phone ?? q.replace(/\s/g, '') } }, { name: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(birthdayMonth ? { birthday: { startsWith: `${String(birthdayMonth).padStart(2, '0')}-` } } : {}),
    },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 5 } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function redeemReward(ctx: TenantContext, accountId: string) {
  await assertModule(ctx.org.id, 'loyalty');
  const program = await db.loyaltyProgram.findUnique({ where: { organizationId: ctx.org.id } });
  if (!program) throw new UserFacingError('Loyalty is not set up.');
  const a = await ownedAccount(ctx, accountId);
  await expireLoyalty(ctx.org.id, new Date(), a.id);
  await db.$transaction(async (tx) => {
    const res = await tx.loyaltyAccount.updateMany({ where: { id: a.id, balance: { gte: program.stampsForReward } }, data: { balance: { decrement: program.stampsForReward } } });
    if (res.count !== 1) throw new UserFacingError(`Not enough ${program.type === 'STAMPS' ? 'stamps' : 'points'} for a reward yet.`);
    await tx.loyaltyTransaction.create({ data: { accountId: a.id, type: 'REDEEM', amount: -program.stampsForReward, note: `Redeemed by staff` } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'loyalty.redeemed', entityType: 'LoyaltyAccount', entityId: a.id, metadata: { amount: program.stampsForReward } }, tx);
  });
}

/** Deletes a member on request: personal data is erased and history removed. */
/** Erases a member's personal data and history (used by staff deletion, guest data requests and retention). */
export async function eraseLoyaltyAccount(tx: Tx, accountId: string) {
  await tx.loyaltyTransaction.deleteMany({ where: { accountId } });
  await tx.order.updateMany({ where: { loyaltyAccountId: accountId }, data: { loyaltyAccountId: null } });
  await tx.loyaltyAccount.update({
    where: { id: accountId },
    data: { phone: `deleted:${accountId}`, name: null, birthday: null, marketingOptIn: false, marketingOptInAt: null, balance: 0, deletedAt: new Date() },
  });
}

export async function deleteLoyaltyAccount(ctx: TenantContext, accountId: string) {
  const a = await ownedAccount(ctx, accountId);
  await db.$transaction(async (tx) => {
    await eraseLoyaltyAccount(tx, a.id);
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'loyalty.member_deleted', entityType: 'LoyaltyAccount', entityId: a.id }, tx);
  });
}

export async function setMarketingOptIn(ctx: TenantContext, accountId: string, optIn: boolean) {
  const a = await ownedAccount(ctx, accountId);
  // Staff may only withdraw marketing consent (e.g. on the guest's request), never grant it.
  if (optIn) throw new UserFacingError('Marketing consent can only be given by the guest.');
  await db.loyaltyAccount.update({ where: { id: a.id }, data: { marketingOptIn: false, marketingOptInAt: null } });
}
