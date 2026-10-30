import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { recordPayment, voidPayment } from '@/server/services/bills';
import { ordersCsv, resolveRange, restaurantAnalytics } from '@/server/services/analytics';
import { changeOrderStatus, submitTableOrder } from '@/server/services/orders';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
async function order(f: F, items: { productId: string; quantity: number; modifiers?: { optionId: string; quantity: number }[] }[]) {
  const o = await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: items.map((i) => ({ modifiers: [], ...i })) }, `k${Math.random()}`);
  return db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: o.orderNumber } });
}
async function complete(f: F, id: string) {
  await changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'NEW', to: 'ACCEPTED' });
  await db.kitchenTicket.updateMany({ where: { orderId: id }, data: { status: 'READY' } });
  await changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'ACCEPTED', to: 'READY' });
  await changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'READY', to: 'COMPLETED' });
}
const today = (f: F) => resolveRange(f.location.timeZone, 'today');

describe('M12-01/03 analytics (TEST 18)', () => {
  beforeEach(resetDatabase);

  it('TEST 18: order value, collected payments, cancelled value and unpaid stay separate', async () => {
    const f = await createOrderingFixture();
    const paid = await order(f, [{ productId: f.dish.id, quantity: 1 }]); // 16,90 paid in full
    const unpaid = await order(f, [{ productId: f.dish.id, quantity: 1 }]); // 16,90 completed, never paid
    const partial = await order(f, [{ productId: f.dish.id, quantity: 2 }]); // 33,80, 5,00 paid
    const cancelled = await order(f, [{ productId: f.dish.id, quantity: 1 }]); // 16,90 cancelled
    await recordPayment(f.ctx, { orderId: paid.id, method: 'CASH', amountCents: 1690 });
    await recordPayment(f.ctx, { orderId: partial.id, method: 'CARD_TERMINAL', amountCents: 500 });
    const mistake = await recordPayment(f.ctx, { orderId: unpaid.id, method: 'CASH', amountCents: 1000 });
    expect(mistake).toBeDefined();
    const wrong = await db.paymentRecord.findFirstOrThrow({ where: { orderId: unpaid.id } });
    await voidPayment(f.ctx, wrong.id, 'Wrong order selected');
    await complete(f, paid.id);
    await complete(f, unpaid.id);
    await changeOrderStatus(f.ctx, { orderId: cancelled.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Guest left' });

    const a = await restaurantAnalytics(f.ctx, f.location.id, today(f));
    expect(a.money).toMatchObject({
      orderValueCents: 1690 + 1690 + 3380, // cancelled excluded
      collectedCents: 1690 + 500, // voided payment excluded
      cancelledValueCents: 1690,
      unpaidCents: 1690 + 2880,
      unpaidFinishedCents: 1690, // completed but never paid
    });
    expect(a.money.collectedByMethod).toEqual([['CASH', 1690], ['CARD_TERMINAL', 500]]);
    expect(a.orders).toMatchObject({ total: 4, completed: 2, cancelled: 1, averageCents: Math.round(6760 / 3) });
    expect(a.orders.byChannel.TABLE).toEqual({ count: 3, valueCents: 6760 });
    expect(a.topItems[0]).toMatchObject({ name: 'Test dish', quantity: 4, valueCents: 6760 });
    expect(a.topCategories[0]).toMatchObject({ name: 'Test mains', quantity: 4 });
  });

  it('days and hours follow the location time zone, not UTC', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { timeZone: 'Europe/Madrid' } });
    const late = await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    const early = await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    // 23:30 UTC on 1 Nov = 00:30 on 2 Nov in Madrid; 22:30 UTC = 23:30 on 1 Nov in Madrid.
    await db.order.update({ where: { id: late.id }, data: { createdAt: new Date('2026-11-01T23:30:00Z') } });
    await db.order.update({ where: { id: early.id }, data: { createdAt: new Date('2026-11-01T22:30:00Z') } });
    const nov1 = await restaurantAnalytics(f.ctx, f.location.id, resolveRange('Europe/Madrid', 'custom', '2026-11-01', '2026-11-01'));
    const nov2 = await restaurantAnalytics(f.ctx, f.location.id, resolveRange('Europe/Madrid', 'custom', '2026-11-02', '2026-11-02'));
    expect(nov1.orders.total).toBe(1);
    expect(nov1.byHour.find((h) => h.count > 0)?.hour).toBe(23);
    expect(nov2.orders.total).toBe(1);
    expect(nov2.byHour.find((h) => h.count > 0)?.hour).toBe(0);
    const both = await restaurantAnalytics(f.ctx, f.location.id, resolveRange('Europe/Madrid', 'custom', '2026-11-01', '2026-11-02'));
    expect(both.byDay.map((d) => [d.date, d.count])).toEqual([['2026-11-01', 1], ['2026-11-02', 1]]);
  });

  it('reservations, feedback and upsell figures come from stored records', async () => {
    const f = await createOrderingFixture();
    const startsAt = new Date();
    const res = (status: string, partySize: number) =>
      db.reservation.create({ data: { organizationId: f.org.id, locationId: f.location.id, startsAt, endsAt: new Date(startsAt.getTime() + 5400_000), partySize, name: 'Test', phone: '+351900000000', status: status as never, idempotencyKey: randomUUID(), trackingTokenHash: randomUUID(), language: 'pt' } });
    await res('CONFIRMED', 4);
    await res('NO_SHOW', 2);
    await db.customerFeedback.createMany({ data: [{ organizationId: f.org.id, locationId: f.location.id, rating: 2, status: 'RESOLVED' }, { organizationId: f.org.id, locationId: f.location.id, rating: 5 }, { organizationId: f.org.id, locationId: f.location.id, rating: 1 }] });
    const rule = await db.upsellRule.create({ data: { organizationId: f.org.id, triggerProductId: f.dish.id, suggestedProductId: f.tea.id } });
    await db.upsellEvent.createMany({ data: [{ organizationId: f.org.id, ruleId: rule.id, eventType: 'SHOWN' }, { organizationId: f.org.id, ruleId: rule.id, eventType: 'SHOWN' }, { organizationId: f.org.id, ruleId: rule.id, eventType: 'ACCEPTED' }] });
    const a = await restaurantAnalytics(f.ctx, f.location.id, resolveRange(f.location.timeZone, '7d'));
    expect(a.reservations).toMatchObject({ total: 2, covers: 4, byStatus: { CONFIRMED: 1, NO_SHOW: 1 } });
    expect(a.feedback).toEqual({ count: 3, average: 2.7, complaints: 2, complaintsResolved: 1 });
    expect(a.upsell).toEqual({ shown: 2, accepted: 1, acceptanceRate: 50 });
  });

  it('M12-04 CSV: one row per order with separate value / paid / unpaid columns', async () => {
    const f = await createOrderingFixture();
    const o = await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    await recordPayment(f.ctx, { orderId: o.id, method: 'CASH', amountCents: 690 });
    const c = await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    await changeOrderStatus(f.ctx, { orderId: c.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Test' });
    const csv = await ordersCsv(f.ctx, f.location.id, today(f));
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('order_number,local_date (Europe/Lisbon),local_time,channel,table,status,payment_status,subtotal_eur,discount_eur,delivery_fee_eur,order_value_eur,paid_eur,unpaid_eur');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^1,\d{4}-\d{2}-\d{2},\d{2}:\d{2},TABLE,05,NEW,PARTIALLY_PAID,16\.90,0\.00,0\.00,16\.90,6\.90,10\.00$/);
    expect(lines[2]).toMatch(/,CANCELLED,UNPAID,16\.90,0\.00,0\.00,16\.90,0\.00,0\.00$/);
  });

  it('TEST 15 (analytics): another restaurant cannot read this location', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await order(a, [{ productId: a.dish.id, quantity: 1 }]);
    await expect(restaurantAnalytics(b.ctx, a.location.id, today(a))).rejects.toThrow();
    await expect(ordersCsv(b.ctx, a.location.id, today(a))).rejects.toThrow();
    expect((await restaurantAnalytics(b.ctx, b.location.id, today(b))).orders.total).toBe(0);
  });
});
