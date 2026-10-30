import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { publicLocation, quoteDelivery, saveDeliveryZone, submitPickupOrder } from '@/server/services/fulfilment';
import { submitTableOrder } from '@/server/services/orders';
import { savePromotion } from '@/server/services/promotions';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const base = { channels: ['TABLE', 'TAKEAWAY', 'DELIVERY'], combinable: false, isActive: true, priority: 0 };
const table = (f: F, items: unknown[], extra: Record<string, unknown> = {}) =>
  submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items, ...extra }, `k${Math.random()}`);
const dish = (f: F, quantity = 1) => ({ productId: f.dish.id, quantity, modifiers: [] });
const tea = (f: F, quantity = 1) => ({ productId: f.tea.id, quantity, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] });

describe('TEST 11: percentage and 2×1 promotions on real orders', () => {
  beforeEach(resetDatabase);

  it('10 % off a table order: server amounts and OrderDiscount snapshot', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: 'Test 10 %', type: 'PERCENTAGE', percent: '10' });
    await table(f, [dish(f), tea(f, 2)]);
    const o = await db.order.findFirstOrThrow({ include: { discounts: true } });
    expect([o.subtotalCents, o.discountCents, o.totalCents]).toEqual([2190, 169 + 50, 2190 - 219]);
    expect(o.discounts.map((d) => [d.description, d.amountCents])).toEqual([['Test 10 %', 219]]);
  });

  it('2×1 on tea (category) for takeaway; client cannot claim any discount itself', async () => {
    const f = await createOrderingFixture();
    const teaCat = (await db.menuProduct.findUniqueOrThrow({ where: { id: f.tea.id } })).categoryId;
    await savePromotion(f.ctx, { ...base, name: 'Chá 2×1', type: 'BUY_X_GET_Y', buyQuantity: '1', getQuantity: '1', categoryIds: [teaCat], channels: ['TAKEAWAY'] });
    await submitPickupOrder({ orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [tea(f, 3), dish(f)], pickup: 'asap', customerName: 'Test', phone: '+351900000000', discountCents: 99999 } as never, 'k');
    const o = await db.order.findFirstOrThrow();
    expect([o.subtotalCents, o.discountCents, o.totalCents]).toEqual([750 + 1590, 250, 750 + 1590 - 250]);
    // not valid on the table channel
    await table(f, [tea(f, 2)]);
    const t = await db.order.findFirstOrThrow({ where: { channel: 'TABLE' } });
    expect(t.discountCents).toBe(0);
  });

  it('non-combinable promotions are never applied together (no double discount)', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: 'A 10 %', type: 'PERCENTAGE', percent: '10' });
    await savePromotion(f.ctx, { ...base, name: 'B 5 €', type: 'FIXED_AMOUNT', amount: '5,00' });
    await table(f, [dish(f, 2)]);
    const o = await db.order.findFirstOrThrow({ include: { discounts: true } });
    expect(o.discounts).toHaveLength(1);
    expect(o.discountCents).toBe(500); // the larger single saving (5,00 > 3,38)
  });
});

describe('M10-02 coupons, limits, dates, minimums', () => {
  beforeEach(resetDatabase);

  it('code required; wrong code refused; usage limit enforced under concurrency', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: 'Code 20 %', type: 'PERCENTAGE', percent: '20', couponCode: 'bem vindo', couponLimit: '1' });
    await table(f, [dish(f)]);
    expect((await db.order.findFirstOrThrow()).discountCents).toBe(0); // no code → no discount
    await expect(table(f, [dish(f)], { couponCode: 'WRONG' })).rejects.toMatchObject({ code: 'coupon_invalid' });
    const results = await Promise.allSettled([1, 2, 3].map(() => table(f, [dish(f)], { couponCode: 'BEMVINDO' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.orderDiscount.count()).toBe(1);
    expect((await db.coupon.findFirstOrThrow()).usageCount).toBe(1);
  });

  it('respects start/end dates and minimum order', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: 'Future', type: 'PERCENTAGE', percent: '50', startsAt: new Date(Date.now() + 86400_000).toISOString() });
    await savePromotion(f.ctx, { ...base, name: 'Min 20', type: 'FIXED_AMOUNT', amount: '3', minOrder: '20,00' });
    await table(f, [dish(f)]);
    expect((await db.order.findFirstOrThrow()).discountCents).toBe(0);
    await table(f, [dish(f, 2)]);
    expect((await db.order.findFirstOrThrow({ where: { subtotalCents: 3380 } })).discountCents).toBe(300);
    await expect(savePromotion(f.ctx, { ...base, name: 'Bad', type: 'PERCENTAGE', percent: '10', startsAt: '2026-12-02T10:00', endsAt: '2026-12-01T10:00' })).rejects.toThrow();
  });

  it('delivery: free-delivery threshold is checked after discounts', async () => {
    const f = await createOrderingFixture();
    await saveDeliveryZone(f.ctx, { locationId: f.location.id, name: 'Z', patterns: '4700-*', fee: '2,50', freeFrom: '30,00' });
    await savePromotion(f.ctx, { ...base, name: '10 %', type: 'PERCENTAGE', percent: '10' });
    const q = await quoteDelivery((await publicLocation(f.org.slug))!, '4700-001', 'pt', [dish(f, 2)]); // 35,80 − 3,58 = 32,22 → free
    expect(q).toMatchObject({ subtotalCents: 3580, discountCents: 358, feeCents: 0, totalCents: 3222 });
  });

  it('promotions cannot reference another tenant’s dishes', async () => {
    const a = await createOrderingFixture('Test A');
    const b = await createOrderingFixture('Test B');
    await expect(savePromotion(a.ctx, { ...base, name: 'Cross tenant', type: 'PERCENTAGE', percent: '10', productIds: [b.dish.id] })).rejects.toThrow(/Invalid dish/);
  });
});
