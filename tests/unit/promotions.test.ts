import { describe, expect, it } from 'vitest';
import { applyPromotions, type PromoLine, type PromoRule } from '@/lib/promotions';

const rule = (p: Partial<PromoRule>): PromoRule => ({
  id: p.id ?? 'r',
  name: p.name ?? 'Promo',
  type: p.type ?? 'PERCENTAGE',
  percentBasisPoints: p.percentBasisPoints ?? null,
  amountCents: p.amountCents ?? null,
  buyQuantity: p.buyQuantity ?? null,
  getQuantity: p.getQuantity ?? null,
  comboPriceCents: p.comboPriceCents ?? null,
  productIds: p.productIds ?? [],
  categoryIds: p.categoryIds ?? [],
  minOrderCents: p.minOrderCents ?? 0,
  priority: p.priority ?? 0,
  combinable: p.combinable ?? false,
});
const line = (key: string, productId: string, unitCents: number, quantity: number, categoryId = 'mains'): PromoLine => ({ key, productId, categoryId, unitCents, quantity });

describe('TEST 11 (engine): percentage and 2×1', () => {
  it('10 % off everything, rounded half-up per line', () => {
    const r = applyPromotions([line('a', 'tajine', 1690, 1), line('b', 'tea', 250, 2)], [rule({ percentBasisPoints: 1000 })], 2190);
    expect(r.totalCents).toBe(169 + 50);
  });
  it('2×1 (buy 1 get 1) makes the cheaper unit free, in groups', () => {
    const r = applyPromotions([line('a', 'tajine', 1690, 2), line('b', 'tajine2', 1500, 1)], [rule({ type: 'BUY_X_GET_Y', buyQuantity: 1, getQuantity: 1 })], 4880);
    // units 1690, 1690, 1500 → one complete group (1690 + 1690) → 1690 free; 1500 alone pays
    expect(r.totalCents).toBe(1690);
  });
  it('2×1 restricted to a category', () => {
    const r = applyPromotions([line('a', 'tea', 250, 3, 'drinks'), line('b', 'tajine', 1690, 2)], [rule({ type: 'BUY_X_GET_Y', buyQuantity: 1, getQuantity: 1, categoryIds: ['drinks'] })], 4130);
    expect(r.totalCents).toBe(250);
  });
});

describe('other promotion types and rules', () => {
  it('fixed amount is capped by the eligible amount (never negative)', () => {
    expect(applyPromotions([line('a', 'tea', 250, 1)], [rule({ type: 'FIXED_AMOUNT', amountCents: 500 })], 250).totalCents).toBe(250);
    expect(applyPromotions([line('a', 'tea', 250, 2), line('b', 'x', 1000, 1)], [rule({ type: 'FIXED_AMOUNT', amountCents: 300 })], 1500).totalCents).toBe(300);
  });
  it('combo price for complete sets only', () => {
    const r = applyPromotions([line('a', 'tajine', 1690, 2), line('b', 'tea', 250, 1)], [rule({ type: 'COMBO', productIds: ['tajine', 'tea'], comboPriceCents: 1700 })], 3630);
    expect(r.totalCents).toBe(1690 + 250 - 1700); // one set
  });
  it('minimum order', () => {
    expect(applyPromotions([line('a', 'tea', 250, 1)], [rule({ percentBasisPoints: 1000, minOrderCents: 2000 })], 250).totalCents).toBe(0);
  });
  it('non-combinable: only the best/priority promotion applies — no double discount', () => {
    const lines = [line('a', 'tajine', 1690, 2)];
    const r = applyPromotions(lines, [rule({ id: 'p10', percentBasisPoints: 1000 }), rule({ id: 'b1g1', type: 'BUY_X_GET_Y', buyQuantity: 1, getQuantity: 1 })], 3380);
    expect(r.discounts.map((d) => d.promotionId)).toEqual(['b1g1']);
    expect(r.totalCents).toBe(1690);
    const prio = applyPromotions(lines, [rule({ id: 'p10', percentBasisPoints: 1000, priority: 5 }), rule({ id: 'b1g1', type: 'BUY_X_GET_Y', buyQuantity: 1, getQuantity: 1 })], 3380);
    expect(prio.discounts.map((d) => d.promotionId)).toEqual(['p10']);
  });
  it('combinable promotions stack on what remains, never beyond the subtotal', () => {
    const lines = [line('a', 'tajine', 1000, 2)];
    const r = applyPromotions(lines, [rule({ id: 'b1g1', type: 'BUY_X_GET_Y', buyQuantity: 1, getQuantity: 1, combinable: true, priority: 2 }), rule({ id: 'p50', percentBasisPoints: 5000, combinable: true })], 2000);
    expect(r.discounts.map((d) => [d.promotionId, d.amountCents])).toEqual([['b1g1', 1000], ['p50', 500]]);
    const big = applyPromotions(lines, [rule({ id: 'f1', type: 'FIXED_AMOUNT', amountCents: 1500, combinable: true }), rule({ id: 'f2', type: 'FIXED_AMOUNT', amountCents: 1500, combinable: true })], 2000);
    expect(big.totalCents).toBe(2000);
  });
});
