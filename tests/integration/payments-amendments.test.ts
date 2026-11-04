import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { can } from '@/lib/permissions';
import { changeOrderItem, recordPayment, voidPayment } from '@/server/services/bills';
import { driverUpdate, saveDeliveryZone, submitDeliveryOrder, submitPickupOrder, updateDeliverySettings } from '@/server/services/fulfilment';
import { changeOrderStatus, changeTicketStatus, stationTickets, submitTableOrder } from '@/server/services/orders';
import { resolveTenantAccess, type TenantContext } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Payments, cancellations and order amendments (restaurant operations audit 2026-11-02):
 * - cancelling and recording a payment at the same moment left a cancelled order with money on it;
 * - item changes read the item before the order lock (a payment for it, or another change, was lost);
 * - changes after the kitchen started, and after dispatch, were applied silently;
 * - the driver's "cash collected" was accepted for card-at-the-door orders (OPS-11) and saved in a
 *   second transaction after DELIVERED (OPS-53); the void reason was not kept (OPS-49).
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const TRIALS = 20;
const reasons = (r: PromiseSettledResult<unknown>[]) => r.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason?.message ?? x));
const rejection = (p: Promise<unknown>) => p.then(() => 'ok').catch((e: Error) => e.message);
const sugar = (f: F) => [{ optionId: f.sugar.id, quantity: 1 }];

async function setup() {
  const f = await createOrderingFixture();
  let n = 0;
  const qr = async () => {
    n += 1;
    const t = await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label: `P${n}`, qrTokens: { create: { token: `pay_${f.org.id}_${n}`.slice(0, 40) } } }, include: { qrTokens: true } });
    return t.qrTokens[0].token;
  };
  /** A table order: dish (Kitchen) × dishes, tea (Café) × teas. */
  const table = async (dishes: number, teas = 0) => {
    const items = [
      ...(dishes ? [{ productId: f.dish.id, quantity: dishes, modifiers: [] }] : []),
      ...(teas ? [{ productId: f.tea.id, quantity: teas, modifiers: sugar(f) }] : []),
    ];
    const r = await submitTableOrder({ qrToken: await qr(), idempotencyKey: randomUUID(), language: 'pt', items }, `pay-guest-${n}`);
    return db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: r.orderNumber }, include: { items: true } });
  };
  const pickup = async () => {
    n += 1;
    const r = await submitPickupOrder({ orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], pickup: 'asap', customerName: 'Test Guest', phone: `+351 93${String(n).padStart(7, '0')}` }, `pay-guest-${n}`);
    return db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: r.orderNumber }, include: { items: true } });
  };
  const state = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { items: { include: { allocations: { include: { payment: true } } } }, payments: true, tickets: true } });
  const accept = (id: string) => changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'NEW', to: 'ACCEPTED' });
  const ticket = (orderId: string, stationId: string) => db.kitchenTicket.findFirstOrThrow({ where: { orderId, stationId } });
  const item = (o: { items: { id: string; productId: string | null }[] }, productId: string) => o.items.find((i) => i.productId === productId)!.id;
  return { f, table, pickup, state, accept, ticket, item };
}

async function deliverySetup(s: Awaited<ReturnType<typeof setup>>) {
  const { f } = s;
  await saveDeliveryZone(f.ctx, { locationId: f.location.id, name: 'Test centro', patterns: '4700-*', fee: '2,50', minOrder: '', freeFrom: '', estimatedMinutes: '40' });
  await updateDeliverySettings(f.ctx, { locationId: f.location.id, prepEstimateMinutes: 20, deliveryEstimateMinutes: 25, maxActiveOrders: 50, cashOnDeliveryEnabled: true, cardOnDeliveryEnabled: true, paused: false, deliveryHours: '' });
  const u = await createTestUser('Test driver');
  await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role: 'DELIVERY_STAFF' } });
  const driver = await resolveTenantAccess(u.id, f.org.slug, 'delivery.driver');
  let n = 0;
  /** A delivery order that is ready and out with the driver. */
  const outForDelivery = async (paymentMethod: 'CASH_ON_DELIVERY' | 'CARD_TERMINAL') => {
    n += 1;
    const r = await submitDeliveryOrder(
      { orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 2, modifiers: [] }], customerName: 'Test Guest', phone: `+351 94${String(n).padStart(7, '0')}`, address: 'Rua de Teste, 10', postalCode: '4700-123', city: 'Braga', paymentMethod },
      `delivery-guest-${n}`,
    );
    const o = await db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: r.orderNumber }, include: { items: true } });
    await s.accept(o.id);
    await changeTicketStatus(f.ctx, { ticketId: (await s.ticket(o.id, f.kitchen.id)).id, expectedFrom: 'PENDING', to: 'READY' });
    await driverUpdate(driver, o.id, 'OUT_FOR_DELIVERY');
    return o;
  };
  return { driver, outForDelivery };
}

describe('cancelling and paying at the same moment', () => {
  beforeEach(resetDatabase);

  it(`an order is never both cancelled and paid: one of the two is refused (${TRIALS} trials)`, async () => {
    const s = await setup();
    for (let i = 0; i < TRIALS; i++) {
      const o = await s.pickup();
      await s.accept(o.id);
      const r = await Promise.allSettled([
        changeOrderStatus(s.f.ctx, { orderId: o.id, expectedFrom: 'ACCEPTED', to: 'CANCELLED', reason: 'Guest left' }),
        recordPayment(s.f.ctx, { orderId: o.id, method: 'CASH', amountCents: o.totalCents }),
      ]);
      expect(reasons(r)).toHaveLength(1);
      expect(reasons(r)[0]).toMatch(/This order was cancelled\.|recorded payment\. Void the payment first/);
      const after = await s.state(o.id);
      const recorded = after.payments.filter((p) => p.status === 'RECORDED');
      if (after.status === 'CANCELLED') expect(recorded).toEqual([]);
      else expect(after).toMatchObject({ status: 'ACCEPTED', paymentStatus: 'PAID', paidCents: o.totalCents });
    }
  });

  it(`a table bill paid while one of its orders is cancelled never takes money for the cancelled order (${TRIALS} trials)`, async () => {
    const s = await setup();
    for (let i = 0; i < TRIALS; i++) {
      const o = await s.table(1);
      await s.accept(o.id);
      await Promise.allSettled([
        changeOrderStatus(s.f.ctx, { orderId: o.id, expectedFrom: 'ACCEPTED', to: 'CANCELLED', reason: 'Wrong table' }),
        recordPayment(s.f.ctx, { sessionId: o.tableSessionId!, method: 'CARD_TERMINAL', amountCents: o.totalCents }),
      ]);
      const after = await s.state(o.id);
      if (after.status === 'CANCELLED') expect(after.payments.filter((p) => p.status === 'RECORDED')).toEqual([]);
    }
  });

  it('void first, then cancel works; the void reason is kept on the payment', async () => {
    const s = await setup();
    const o = await s.pickup();
    const { paymentIds } = await recordPayment(s.f.ctx, { orderId: o.id, method: 'CASH', amountCents: o.totalCents });
    await expect(changeOrderStatus(s.f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Guest left' })).rejects.toThrow(/Void the payment first/);
    await voidPayment(s.f.ctx, paymentIds[0], '  Charged by mistake  ');
    expect(await db.paymentRecord.findUniqueOrThrow({ where: { id: paymentIds[0] } })).toMatchObject({ status: 'VOIDED', voidReason: 'Charged by mistake', voidedById: s.f.owner.id });
    expect(await rejection(voidPayment(s.f.ctx, paymentIds[0], 'again'))).toBe('This payment was already voided.');
    expect(await s.state(o.id)).toMatchObject({ paidCents: 0, paymentStatus: 'UNPAID' });
    await changeOrderStatus(s.f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Guest left' });
    expect(await rejection(recordPayment(s.f.ctx, { orderId: o.id, method: 'CASH', amountCents: 100 }))).toBe('This order was cancelled.');
    expect(await rejection(voidPayment(s.f.ctx, paymentIds[0], ''))).toBe('Give a reason for voiding this payment.');
  });
});

describe('payments: partial, by item, double, overpayment', () => {
  beforeEach(resetDatabase);

  it('partial payments add up to PAID; overpaying and paying twice for the same item are refused', async () => {
    const s = await setup();
    const o = await s.table(2, 1);
    const sid = o.tableSessionId!;
    await recordPayment(s.f.ctx, { sessionId: sid, method: 'CASH', amountCents: 500 });
    expect(await s.state(o.id)).toMatchObject({ paidCents: 500, paymentStatus: 'PARTIALLY_PAID' });
    await recordPayment(s.f.ctx, { sessionId: sid, method: 'CARD_TERMINAL', itemIds: [s.item(o, s.f.tea.id)] });
    expect(await rejection(recordPayment(s.f.ctx, { sessionId: sid, method: 'CASH', itemIds: [s.item(o, s.f.tea.id)] }))).toMatch(/is already paid/);
    const due = (await s.state(o.id)).totalCents - (await s.state(o.id)).paidCents;
    expect(await rejection(recordPayment(s.f.ctx, { sessionId: sid, method: 'CASH', amountCents: due + 1 }))).toMatch(/higher than the remaining balance/);
    await recordPayment(s.f.ctx, { sessionId: sid, method: 'CASH', amountCents: due });
    expect(await s.state(o.id)).toMatchObject({ paymentStatus: 'PAID' });
  });

  it(`two tablets recording the full amount at once: only one payment is stored (${TRIALS} trials)`, async () => {
    const s = await setup();
    for (let i = 0; i < TRIALS; i++) {
      const o = await s.pickup();
      const r = await Promise.allSettled([recordPayment(s.f.ctx, { orderId: o.id, method: 'CASH', amountCents: o.totalCents }), recordPayment(s.f.ctx, { orderId: o.id, method: 'CARD_TERMINAL', amountCents: o.totalCents })]);
      expect(reasons(r)).toHaveLength(1);
      const after = await s.state(o.id);
      expect(after.payments.filter((p) => p.status === 'RECORDED')).toHaveLength(1);
      expect(after.paidCents).toBe(after.totalCents);
    }
  });
});

describe('changing items while they are being paid or changed', () => {
  beforeEach(resetDatabase);

  it(`removing an item while a guest pays for it never leaves money on a removed line (${TRIALS} trials)`, async () => {
    const s = await setup();
    for (let i = 0; i < TRIALS; i++) {
      const o = await s.table(1, 1);
      const teaLine = s.item(o, s.f.tea.id);
      const r = await Promise.allSettled([
        recordPayment(s.f.ctx, { sessionId: o.tableSessionId!, method: 'CASH', itemIds: [teaLine] }),
        changeOrderItem(s.f.ctx, { itemId: teaLine, quantity: 0, reason: 'Changed their mind' }),
      ]);
      expect(reasons(r)).toHaveLength(1);
      const after = await s.state(o.id);
      const tea = after.items.find((x) => x.id === teaLine)!;
      expect(!!tea.voidedAt && tea.allocations.some((a) => a.payment.status === 'RECORDED')).toBe(false);
      expect(after.paidCents).toBeLessThanOrEqual(after.totalCents);
    }
  });

  it(`two reductions of the same line at once: the second works on the first one's result (${TRIALS} trials)`, async () => {
    const s = await setup();
    for (let i = 0; i < TRIALS; i++) {
      const o = await s.table(0, 3);
      const line = o.items[0];
      const r = await Promise.allSettled([
        changeOrderItem(s.f.ctx, { itemId: line.id, quantity: 2, reason: 'One less' }),
        changeOrderItem(s.f.ctx, { itemId: line.id, quantity: 1, reason: 'Two less' }),
      ]);
      const after = await db.orderItem.findUniqueOrThrow({ where: { id: line.id } });
      const logs = await db.auditLog.findMany({ where: { entityId: line.id, action: 'order.item_quantity_reduced' }, orderBy: { createdAt: 'asc' } });
      const steps = logs.map((l) => [(l.metadata as { from: number }).from, (l.metadata as { to: number }).to]);
      if (reasons(r).length === 0) {
        // 3→1 then 2 would add one back (refused), so both succeeding means 3→2→1.
        expect(steps).toEqual([[3, 2], [2, 1]]);
        expect(after.quantity).toBe(1);
      } else {
        expect(reasons(r)[0]).toMatch(/only reduce or remove/);
        expect(steps).toEqual([[3, 1]]);
      }
      expect(after.lineTotalCents).toBe(after.quantity * (after.unitPriceCents + after.modifiersUnitCents));
    }
  });
});

describe('what can change at each stage of an order', () => {
  beforeEach(resetDatabase);

  it('NEW: reduce or remove freely; the kitchen never saw it, so nothing is marked; removing everything cancels it', async () => {
    const s = await setup();
    const o = await s.table(2);
    await changeOrderItem(s.f.ctx, { itemId: o.items[0].id, quantity: 1, reason: 'One less' });
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: o.items[0].id } })).toMatchObject({ quantity: 1, amendedAt: null, originalQuantity: null });
    await changeOrderItem(s.f.ctx, { itemId: o.items[0].id, quantity: 0, reason: 'Guest left' });
    expect(await s.state(o.id)).toMatchObject({ status: 'CANCELLED', cancelReason: 'Guest left', totalCents: 0 });
  });

  it('ACCEPTED, not started: allowed, and the station sees "was N"', async () => {
    const s = await setup();
    const o = await s.table(3, 1);
    await s.accept(o.id);
    await changeOrderItem(s.f.ctx, { itemId: s.item(o, s.f.dish.id), quantity: 1, reason: 'Two less' });
    const k = (await stationTickets(s.f.ctx, s.f.kitchen.id)).tickets.find((t) => t.orderId === o.id)!;
    expect(k.order.items.map((i) => [i.quantity, i.originalQuantity, !!i.amendedAt])).toEqual([[1, 3, true]]);
    // A second reduction keeps the quantity the station first saw.
    await changeOrderItem(s.f.ctx, { itemId: s.item(o, s.f.dish.id), quantity: 0, reason: 'None' }).catch(() => undefined);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: s.item(o, s.f.dish.id) } })).originalQuantity).toBe(3);
  });

  it('PREPARING / READY at the station: refused unless staff confirm they told the station; then shown on its screen', async () => {
    const s = await setup();
    const o = await s.table(2, 1);
    await s.accept(o.id);
    const k = await s.ticket(o.id, s.f.kitchen.id);
    await changeTicketStatus(s.f.ctx, { ticketId: k.id, expectedFrom: 'PENDING', to: 'PREPARING' });
    const dish = s.item(o, s.f.dish.id);
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: dish, quantity: 1, reason: 'One less' }))).toMatch(/kitchen has already started this item/);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: dish } })).quantity).toBe(2);
    await changeOrderItem(s.f.ctx, { itemId: dish, quantity: 1, reason: 'One less', kitchenNotified: true });
    const shown = (await stationTickets(s.f.ctx, s.f.kitchen.id)).tickets.find((t) => t.id === k.id)!;
    expect(shown.order.items.map((i) => [i.quantity, i.originalQuantity])).toEqual([[1, 2]]);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: dish, action: 'order.item_quantity_reduced' } });
    expect(log.metadata).toMatchObject({ from: 2, to: 1, orderStatus: 'PREPARING', prepStatus: 'PREPARING', shownOnStation: true, kitchenNotified: true });

    // Café finished the tea: removing it is a billing correction that still needs the OK.
    const c = await s.ticket(o.id, s.f.cafe.id);
    await changeTicketStatus(s.f.ctx, { ticketId: c.id, expectedFrom: 'PENDING', to: 'READY' });
    const tea = s.item(o, s.f.tea.id);
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: tea, quantity: 0, reason: 'Cold' }))).toMatch(/already prepared/);
    await changeOrderItem(s.f.ctx, { itemId: tea, quantity: 0, reason: 'Cold', kitchenNotified: true });
    // The café ticket stays on its screen, cancelled, with the removed line and the reason.
    const cafe = (await stationTickets(s.f.ctx, s.f.cafe.id)).tickets.find((t) => t.id === c.id)!;
    expect(cafe.status).toBe('CANCELLED');
    expect(cafe.order.items.map((i) => [i.nameSnapshot, !!i.voidedAt, i.voidReason])).toEqual([['Test tea', true, 'Cold']]);
    // …for 15 minutes.
    await db.orderItem.update({ where: { id: tea }, data: { voidedAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await stationTickets(s.f.ctx, s.f.cafe.id)).tickets.find((t) => t.id === c.id)).toBeUndefined();
  });

  it('removing the last open item of an accepted order is refused: cancel the order instead', async () => {
    const s = await setup();
    const o = await s.table(1);
    await s.accept(o.id);
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: o.items[0].id, quantity: 0, reason: 'Guest left' }))).toMatch(/last item of the order\. Cancel the order instead/);
    expect((await s.state(o.id)).status).toBe('ACCEPTED');
  });

  it('removing the last unprepared station item lets the order turn ready when the others are', async () => {
    const s = await setup();
    const o = await s.table(1, 1);
    await s.accept(o.id);
    await changeTicketStatus(s.f.ctx, { ticketId: (await s.ticket(o.id, s.f.kitchen.id)).id, expectedFrom: 'PENDING', to: 'READY' });
    expect((await s.state(o.id)).status).toBe('PREPARING');
    await changeOrderItem(s.f.ctx, { itemId: s.item(o, s.f.tea.id), quantity: 0, reason: 'Out of mint' });
    expect((await s.state(o.id)).status).toBe('READY');
  });

  it('OUT_FOR_DELIVERY, DELIVERED, COMPLETED and CANCELLED: no change at all', async () => {
    const s = await setup();
    const d = await deliverySetup(s);
    const out = await d.outForDelivery('CASH_ON_DELIVERY');
    const dispatched = /out for delivery or delivered\. Its items and total can no longer change/;
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: out.items[0].id, quantity: 1, reason: 'Discount', kitchenNotified: true }))).toMatch(dispatched);
    await driverUpdate(d.driver, out.id, 'DELIVERED');
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: out.items[0].id, quantity: 0, reason: 'Discount', kitchenNotified: true }))).toMatch(dispatched);
    expect((await s.state(out.id)).totalCents).toBe(out.totalCents);
    await changeOrderStatus(s.f.ctx, { orderId: out.id, expectedFrom: 'DELIVERED', to: 'COMPLETED' });
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: out.items[0].id, quantity: 1, reason: 'Discount', kitchenNotified: true }))).toMatch(/Completed or cancelled orders cannot be changed/);
    const c = await s.table(1);
    await changeOrderStatus(s.f.ctx, { orderId: c.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Test' });
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: c.items[0].id, quantity: 0, reason: 'Again' }))).toMatch(/Completed or cancelled orders cannot be changed/);
  });

  it('an item already paid cannot be reduced below what was paid', async () => {
    const s = await setup();
    const o = await s.table(2);
    await recordPayment(s.f.ctx, { sessionId: o.tableSessionId!, method: 'CASH', itemIds: [o.items[0].id] });
    expect(await rejection(changeOrderItem(s.f.ctx, { itemId: o.items[0].id, quantity: 1, reason: 'One less' }))).toMatch(/already paid\. Void that payment first/);
  });
});

describe('cash versus card at the door (server-side)', () => {
  beforeEach(resetDatabase);

  it('a card-at-the-door delivery is never recorded as cash, and nothing changes when it is attempted', async () => {
    const s = await setup();
    const d = await deliverySetup(s);
    const o = await d.outForDelivery('CARD_TERMINAL');
    expect(await rejection(driverUpdate(d.driver, o.id, 'DELIVERED', true))).toMatch(/paid by card at the door, so it cannot be recorded as cash/);
    expect(await s.state(o.id)).toMatchObject({ status: 'OUT_FOR_DELIVERY', paidCents: 0, payments: [] });
    expect(await rejection(recordPayment(s.f.ctx, { orderId: o.id, method: 'CASH_ON_DELIVERY', amountCents: o.totalCents }))).toMatch(/only for delivery orders paid in cash/);
    await driverUpdate(d.driver, o.id, 'DELIVERED');
    // The card payment taken on the terminal is recorded by staff as card.
    await recordPayment(s.f.ctx, { orderId: o.id, method: 'CARD_TERMINAL', amountCents: o.totalCents });
    expect(await s.state(o.id)).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
  });

  it('cash collected by the driver is saved together with DELIVERED', async () => {
    const s = await setup();
    const d = await deliverySetup(s);
    const o = await d.outForDelivery('CASH_ON_DELIVERY');
    await driverUpdate(d.driver, o.id, 'DELIVERED', true);
    const after = await s.state(o.id);
    expect(after).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID', paidCents: o.totalCents });
    expect(after.payments.map((p) => [p.method, p.amountCents])).toEqual([['CASH_ON_DELIVERY', o.totalCents]]);
  });

  it('a status change and its extra step commit together or not at all', async () => {
    const s = await setup();
    const o = await s.pickup();
    await expect(changeOrderStatus(s.f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' }, async () => { throw new Error('payment failed to save'); })).rejects.toThrow('payment failed to save');
    expect(await s.state(o.id)).toMatchObject({ status: 'NEW', tickets: [] });
    expect(await db.orderStatusEvent.count({ where: { orderId: o.id, toStatus: 'ACCEPTED' } })).toBe(0);
  });

  it('"cash on delivery" is refused on a table bill and a pickup order', async () => {
    const s = await setup();
    const t = await s.table(1);
    expect(await rejection(recordPayment(s.f.ctx, { sessionId: t.tableSessionId!, method: 'CASH_ON_DELIVERY', amountCents: t.totalCents }))).toMatch(/only for delivery orders/);
    const p = await s.pickup();
    expect(await rejection(recordPayment(s.f.ctx, { orderId: p.id, method: 'CASH_ON_DELIVERY', amountCents: p.totalCents }))).toMatch(/only for delivery orders/);
    expect(await db.paymentRecord.count()).toBe(0);
  });
});

describe('who may do it', () => {
  beforeEach(resetDatabase);

  it('item changes and voids need orders.modifyItems (owner, manager); waiters may record payments only', () => {
    expect(can('RESTAURANT_OWNER', 'orders.modifyItems')).toBe(true);
    expect(can('RESTAURANT_MANAGER', 'orders.modifyItems')).toBe(true);
    expect(can('WAITER', 'orders.modifyItems')).toBe(false);
    expect(can('WAITER', 'payments.record')).toBe(true);
    expect(can('KITCHEN_STAFF', 'payments.record')).toBe(false);
    expect(can('CAFE_STAFF', 'orders.modifyItems')).toBe(false);
    expect(can('DELIVERY_STAFF', 'payments.record')).toBe(false);
  });

  it('another restaurant, or a manager of another location, cannot touch this order or its payments', async () => {
    const s = await setup();
    const o = await s.table(2);
    const { paymentIds } = await recordPayment(s.f.ctx, { sessionId: o.tableSessionId!, method: 'CASH', amountCents: 100 });
    const other = await createOrderingFixture('Other Test Restaurant');
    expect(await rejection(changeOrderItem(other.ctx, { itemId: o.items[0].id, quantity: 1, reason: 'Hack' }))).toBe('Item not found.');
    expect(await rejection(voidPayment(other.ctx, paymentIds[0], 'Hack'))).toBe('Payment not found.');
    expect(await rejection(recordPayment(other.ctx, { orderId: o.id, method: 'CASH', amountCents: 100 }))).toBe('Order not found.');
    const u = await createTestUser('Elsewhere manager');
    await db.restaurantMembership.create({ data: { userId: u.id, organizationId: s.f.org.id, role: 'RESTAURANT_MANAGER', locationIds: ['another-location'] } });
    const elsewhere: TenantContext = await resolveTenantAccess(u.id, s.f.org.slug);
    await expect(changeOrderItem(elsewhere, { itemId: o.items[0].id, quantity: 1, reason: 'Hack' })).rejects.toThrow();
    await expect(voidPayment(elsewhere, paymentIds[0], 'Hack')).rejects.toThrow();
    expect(await s.state(o.id)).toMatchObject({ paidCents: 100 });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: o.items[0].id } })).quantity).toBe(2);
  });
});
