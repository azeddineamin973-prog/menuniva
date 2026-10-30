import 'server-only';
import { z } from 'zod';
import type { OrderChannel } from '@/generated/prisma/enums';
import { parseMoneyToCents } from '@/lib/money';
import { applyPromotions, type AppliedDiscount, type PromoRule } from '@/lib/promotions';
import { audit } from '../audit';
import { db, type Tx } from '../db';
import { assertModule, hasModule } from '../modules';
import { UserFacingError } from '../errors';
import type { TenantContext } from '../tenant';
import type { QuotedLine } from './pricing';

export const normalizeCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '');

/** Promotions that apply right now to this location and channel (+ the coupon, if valid). */
export async function loadRules(tx: Tx | typeof db, p: { organizationId: string; locationId: string; channel: OrderChannel; couponCode?: string | null; now?: Date }) {
  const now = p.now ?? new Date();
  const promos = await tx.promotion.findMany({
    where: {
      organizationId: p.organizationId,
      isActive: true,
      channels: { has: p.channel },
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    include: { coupons: true },
  });
  const code = p.couponCode ? normalizeCode(p.couponCode) : null;
  let couponStatus: 'none' | 'valid' | 'invalid' = code ? 'invalid' : 'none';
  const rules: PromoRule[] = [];
  for (const pr of promos) {
    if (pr.locationIds.length && !pr.locationIds.includes(p.locationId)) continue;
    if (pr.usageLimit !== null && pr.usageCount >= pr.usageLimit) continue;
    let couponCode: string | null = null;
    if (pr.requiresCode) {
      const c = code ? pr.coupons.find((x) => x.code === code && x.isActive && (x.usageLimit === null || x.usageCount < x.usageLimit)) : null;
      if (!c) continue;
      couponCode = c.code;
      couponStatus = 'valid';
    }
    rules.push({ ...pr, couponCode });
  }
  return { rules, couponStatus };
}

export async function computeDiscounts(
  tx: Tx | typeof db,
  p: { organizationId: string; locationId: string; channel: OrderChannel; couponCode?: string | null; lines: QuotedLine[]; subtotalCents: number; now?: Date },
) {
  // Without the promotions module no promotion applies; a typed code is reported as invalid.
  // The module check must use `tx`: computeDiscounts runs inside the order transaction, and asking
  // the pool for a second connection there starved the pool with 10+ simultaneous orders (BUG-01).
  const enabled = await hasModule(p.organizationId, 'promotions', tx);
  const { rules, couponStatus } = enabled ? await loadRules(tx, p) : { rules: [], couponStatus: p.couponCode ? ('invalid' as const) : ('none' as const) };
  const res = applyPromotions(
    p.lines.map((l, i) => ({ key: String(i), productId: l.productId, categoryId: l.categoryId, unitCents: l.unitPriceCents + l.modifiersUnitCents, quantity: l.quantity })),
    rules,
    p.subtotalCents,
  );
  // A valid code whose promotion gave no saving (e.g. minimum not reached) is reported as such.
  const usedCode = res.discounts.some((d) => d.couponCode);
  return { ...res, couponStatus: couponStatus === 'valid' && !usedCode ? ('not_applicable' as const) : couponStatus };
}

/**
 * Counts promotion and coupon usage inside the order transaction. The conditional UPDATE
 * makes usage limits safe under concurrency: if a limit was reached meanwhile, the order is refused.
 */
export async function consumeUsage(tx: Tx, organizationId: string, orderId: string, discounts: AppliedDiscount[]) {
  for (const d of discounts) {
    const n = await tx.$executeRaw`UPDATE "Promotion" SET "usageCount" = "usageCount" + 1 WHERE id = ${d.promotionId} AND "organizationId" = ${organizationId} AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")`;
    if (n !== 1) throw new UserFacingError('promotion_unavailable', 422);
    if (d.couponCode) {
      const c = await tx.$executeRaw`UPDATE "Coupon" SET "usageCount" = "usageCount" + 1 WHERE "organizationId" = ${organizationId} AND code = ${d.couponCode} AND "isActive" = true AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")`;
      if (c !== 1) throw new UserFacingError('promotion_unavailable', 422);
    }
    await tx.orderDiscount.create({ data: { orderId, promotionId: d.promotionId, couponCode: d.couponCode ?? null, description: d.description, amountCents: d.amountCents } });
  }
}

// ------------------------------------------------------------------ management (M10-02/03)

const cents = (label: string) =>
  z.preprocess((v) => (v === '' || v == null ? null : v), z.union([z.string(), z.number()]).nullable()).transform((v, ctx) => {
    if (v === null) return null;
    const c = parseMoneyToCents(v);
    if (c === null) {
      ctx.addIssue({ code: 'custom', message: `invalid_${label}` });
      return z.NEVER;
    }
    return c;
  });
const date = z.preprocess((v) => (v === '' || v == null ? null : new Date(String(v))), z.date().nullable());

export const promotionSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(2).max(80),
    type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y', 'COMBO']),
    percent: z.preprocess((v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.'))), z.number().min(0.01).max(100).nullable()),
    amount: cents('amount'),
    buyQuantity: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(20).nullable()),
    getQuantity: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(20).nullable()),
    comboPrice: cents('combo_price'),
    productIds: z.array(z.string()).default([]),
    categoryIds: z.array(z.string()).default([]),
    channels: z.array(z.enum(['TABLE', 'TAKEAWAY', 'DELIVERY'])).min(1, 'choose_channel'),
    minOrder: cents('min_order'),
    usageLimit: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).nullable()),
    priority: z.coerce.number().int().min(0).max(100).default(0),
    combinable: z.boolean(),
    couponCode: z.string().trim().max(30).optional(),
    couponLimit: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).nullable()),
    startsAt: date,
    endsAt: date,
    isActive: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'PERCENTAGE' && !d.percent) ctx.addIssue({ code: 'custom', path: ['percent'], message: 'required' });
    if (d.type === 'FIXED_AMOUNT' && !d.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'required' });
    if (d.type === 'BUY_X_GET_Y' && (!d.buyQuantity || !d.getQuantity)) ctx.addIssue({ code: 'custom', path: ['buyQuantity'], message: 'required' });
    if (d.type === 'COMBO' && (d.comboPrice === null || d.productIds.length < 2)) ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'combo_needs_two_products_and_price' });
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'end_before_start' });
  });

export async function savePromotion(ctx: TenantContext, input: unknown) {
  await assertModule(ctx.org.id, 'promotions');
  const d = promotionSchema.parse(input);
  const [products, categories] = await Promise.all([
    db.menuProduct.count({ where: { id: { in: d.productIds }, organizationId: ctx.org.id } }),
    db.menuCategory.count({ where: { id: { in: d.categoryIds }, organizationId: ctx.org.id } }),
  ]);
  if (products !== d.productIds.length || categories !== d.categoryIds.length) throw new UserFacingError('Invalid dish or category.');
  const code = d.couponCode ? normalizeCode(d.couponCode) : '';
  if (code && !/^[A-Z0-9_-]{3,30}$/.test(code)) throw new UserFacingError('Codes use 3–30 letters, digits, - or _.');
  const data = {
    name: d.name,
    type: d.type,
    percentBasisPoints: d.type === 'PERCENTAGE' && d.percent ? Math.round(d.percent * 100) : null,
    amountCents: d.type === 'FIXED_AMOUNT' ? d.amount : null,
    buyQuantity: d.type === 'BUY_X_GET_Y' ? d.buyQuantity : null,
    getQuantity: d.type === 'BUY_X_GET_Y' ? d.getQuantity : null,
    comboPriceCents: d.type === 'COMBO' ? d.comboPrice : null,
    productIds: d.productIds,
    categoryIds: d.type === 'COMBO' ? [] : d.categoryIds,
    channels: d.channels,
    minOrderCents: d.minOrder ?? 0,
    usageLimit: d.usageLimit,
    priority: d.priority,
    combinable: d.combinable,
    requiresCode: !!code,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    isActive: d.isActive,
  };
  return db.$transaction(async (tx) => {
    let id = d.id;
    if (id) {
      const ex = await tx.promotion.findFirst({ where: { id, organizationId: ctx.org.id } });
      if (!ex) throw new UserFacingError('Promotion not found.', 404);
      await tx.promotion.update({ where: { id }, data });
    } else id = (await tx.promotion.create({ data: { organizationId: ctx.org.id, ...data } })).id;
    if (code) {
      const clash = await tx.coupon.findUnique({ where: { organizationId_code: { organizationId: ctx.org.id, code } } });
      if (clash && clash.promotionId !== id) throw new UserFacingError('This code is already used by another promotion.');
      await tx.coupon.upsert({
        where: { organizationId_code: { organizationId: ctx.org.id, code } },
        update: { usageLimit: d.couponLimit, isActive: true },
        create: { organizationId: ctx.org.id, promotionId: id, code, usageLimit: d.couponLimit },
      });
      await tx.coupon.updateMany({ where: { promotionId: id, code: { not: code } }, data: { isActive: false } });
    } else await tx.coupon.updateMany({ where: { promotionId: id }, data: { isActive: false } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: d.id ? 'promotion.updated' : 'promotion.created', entityType: 'Promotion', entityId: id, metadata: { ...data, code: code || null } }, tx);
    return { id };
  });
}

export async function listPromotions(ctx: TenantContext) {
  return db.promotion.findMany({ where: { organizationId: ctx.org.id }, include: { coupons: { where: { isActive: true } }, _count: { select: { orderDiscounts: true } } }, orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }] });
}
