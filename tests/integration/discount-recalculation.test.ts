import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { changeOrderItem } from '@/server/services/bills';
import { submitTableOrder } from '@/server/services/orders';
import { savePromotion } from '@/server/services/promotions';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Audit BUG-11: when staff reduce or remove items, the applied promotions are re-evaluated on the
 * remaining items. Before the fix the old discount amount was kept (only capped at the subtotal).
 * Fixture prices: dish 16,90 (mains), tea 2,50 (drinks, required sugar option at 0,00).
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const base = { channels: ['TABLE', 'TAKEAWAY', 'DELIVERY'], combinable: false, isActive: true, priority: 0 };
const dish = (f: F, quantity = 1) => ({ productId: f.dish.id, quantity, modifiers: [] });
const tea = (f: F, quantity = 1) => ({ productId: f.tea.id, quantity, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] });
async function place(f: F, items: unknown[], couponCode?: string) {
  await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items, couponCode }, `k${Math.random()}`);
  return db.order.findFirstOrThrow({ where: { organizationId: f.org.id }, orderBy: { number: 'desc' }, include: { items: true, discounts: true } });
}
const reload = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { discounts: true } });
const itemOf = (o: Awaited<ReturnType<typeof place>>, productId: string) => o.items.find((i) => i.productId === productId)!;

describe('discount recalculation after order changes (audit BUG-11)', () => {
  beforeEach(resetDatabase);

  it('percentage: 10 % follows the new subtotal when a quantity is reduced', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: '10 %', type: 'PERCENTAGE', percent: '10' });
    const o = await place(f, [dish(f, 2)]); // 33,80 − 3,38
    expect([o.subtotalCents, o.discountCents, o.totalCents]).toEqual([3380, 338, 3042]);
    await changeOrderItem(f.ctx, { itemId: itemOf(o, f.dish.id).id, quantity: 1, reason: 'one dish returned' });
    const after = await reload(o.id);
    expect([after.subtotalCents, after.discountCents, after.totalCents]).toEqual([1690, 169, 1521]); // was 338 before the fix
    expect(after.discounts.map((d) => d.amountCents)).toEqual([169]);
  });

  it('2×1: removing one of the two teas removes the free tea', async () => {
    const f = await createOrderingFixture();
    const teaCat = (await db.menuProduct.findUniqueOrThrow({ where: { id: f.tea.id } })).categoryId;
    await savePromotion(f.ctx, { ...base, name: 'Chá 2×1', type: 'BUY_X_GET_Y', buyQuantity: '1', getQuantity: '1', categoryIds: [teaCat] });
    const o = await place(f, [tea(f, 2), dish(f)]);
    expect(o.discountCents).toBe(250);
    await changeOrderItem(f.ctx, { itemId: itemOf(o, f.tea.id).id, quantity: 1, reason: 'one tea not wanted' });
    const after = await reload(o.id);
    expect([after.subtotalCents, after.discountCents, after.totalCents]).toEqual([1940, 0, 1940]);
  });

  it('minimum order: the promotion no longer applies once the subtotal falls below it', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: '3 € from 30 €', type: 'FIXED_AMOUNT', amount: '3,00', minOrder: '30,00' });
    const o = await place(f, [dish(f, 2)]);
    expect(o.discountCents).toBe(300);
    await changeOrderItem(f.ctx, { itemId: itemOf(o, f.dish.id).id, quantity: 1, reason: 'reduced' });
    expect((await reload(o.id)).discountCents).toBe(0);
  });

  it('fixed amount stays (never increases) while the minimum is still met; removing an item entirely re-evaluates', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: '2 € off', type: 'FIXED_AMOUNT', amount: '2,00', couponCode: 'TWO' });
    const o = await place(f, [dish(f), tea(f, 2)], 'TWO');
    expect(o.discountCents).toBe(200);
    await changeOrderItem(f.ctx, { itemId: itemOf(o, f.tea.id).id, quantity: 0, reason: 'teas removed' });
    const after = await reload(o.id);
    expect([after.subtotalCents, after.discountCents, after.totalCents]).toEqual([1690, 200, 1490]);
  });

  it('several combinable promotions are re-evaluated together and each only shrinks', async () => {
    const f = await createOrderingFixture();
    const teaCat = (await db.menuProduct.findUniqueOrThrow({ where: { id: f.tea.id } })).categoryId;
    await savePromotion(f.ctx, { ...base, name: 'Tea 2×1', type: 'BUY_X_GET_Y', buyQuantity: '1', getQuantity: '1', categoryIds: [teaCat], combinable: true, priority: 10 });
    await savePromotion(f.ctx, { ...base, name: '10 % all', type: 'PERCENTAGE', percent: '10', combinable: true, priority: 1 });
    const o = await place(f, [dish(f), tea(f, 2)]); // 21,90: 2×1 = 2,50; 10 % of the rest (19,40) = 1,94
    expect(o.discounts.map((d) => [d.description, d.amountCents]).sort()).toEqual([['10 % all', 194], ['Tea 2×1', 250]]);
    await changeOrderItem(f.ctx, { itemId: itemOf(o, f.tea.id).id, quantity: 1, reason: 'one tea removed' });
    const after = await reload(o.id);
    expect(after.discounts.map((d) => [d.description, d.amountCents]).sort()).toEqual([['10 % all', 194], ['Tea 2×1', 0]]);
    expect([after.subtotalCents, after.discountCents, after.totalCents]).toEqual([1940, 194, 1746]);
  });

  it('a deleted promotion shrinks its discount in proportion; the total is never negative', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: '10 %', type: 'PERCENTAGE', percent: '10' });
    const o = await place(f, [dish(f, 2)]);
    await db.promotion.deleteMany({ where: { organizationId: f.org.id } });
    await changeOrderItem(f.ctx, { itemId: itemOf(o, f.dish.id).id, quantity: 1, reason: 'reduced' });
    const after = await reload(o.id);
    expect(after.discountCents).toBe(169);
    expect(after.totalCents).toBeGreaterThanOrEqual(0);
  });

  it('an audit entry records the discount before and after', async () => {
    const f = await createOrderingFixture();
    await savePromotion(f.ctx, { ...base, name: '10 %', type: 'PERCENTAGE', percent: '10' });
    const o = await place(f, [dish(f, 2)]);
    await changeOrderItem(f.ctx, { itemId: itemOf(o, f.dish.id).id, quantity: 1, reason: 'reduced' });
    const a = await db.auditLog.findFirstOrThrow({ where: { organizationId: f.org.id, action: 'order.item_quantity_reduced' } });
    expect(a.metadata).toMatchObject({ discountBefore: 338, discountAfter: 169, totalAfter: 1521 });
  });
});
