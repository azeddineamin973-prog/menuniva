import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { setSoldOut } from '@/server/services/menu';
import { changeOrderStatus, changeTicketStatus, liveOrders, stationTickets, submitTableOrder, trackOrder } from '@/server/services/orders';
import { quoteCart } from '@/server/services/pricing';
import { resolveTenantAccess } from '@/server/tenant';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

describe('table ordering core', () => {
  beforeEach(resetDatabase);

  it('quotes with server prices and ignores any client-supplied price', async () => {
    const f = await createOrderingFixture();
    const tampered = [{ productId: f.dish.id, quantity: 2, modifiers: [], priceCents: 1 }] as never;
    const q = await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items: tampered });
    expect(q.issues).toEqual([]);
    expect(q.subtotalCents).toBe(3380);
    const qt = await quoteCart({ locationId: f.location.id, channel: 'TAKEAWAY', lang: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] });
    expect(qt.subtotalCents).toBe(1590);
  });

  it('enforces required modifier groups and option prices', async () => {
    const f = await createOrderingFixture();
    const missing = await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items: [{ productId: f.tea.id, quantity: 1, modifiers: [] }] });
    expect(missing.issues[0]?.code).toBe('selection_rules');
    const ok = await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items: [{ productId: f.tea.id, quantity: 2, modifiers: [{ optionId: f.honey.id, quantity: 1 }] }] });
    expect(ok.subtotalCents).toBe(600); // (2,50 + 0,50) × 2
    const foreign = await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [{ optionId: f.honey.id, quantity: 1 }] }] });
    expect(foreign.issues[0]?.code).toBe('invalid_option');
  });

  it('TEST 4/6: submits a table order, staff sees it, status moves NEW→COMPLETED and the customer sees the real status', async () => {
    const f = await createOrderingFixture();
    const key = randomUUID();
    const res = await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: key, language: 'en', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'ip-1');
    expect(res.status).toBe('NEW');
    expect(res.orderNumber).toBe(1);

    const live = await liveOrders(f.ctx, f.location.id, new Date(0));
    expect(live).toHaveLength(1);
    expect(live[0].table?.label).toBe('05');
    expect(live[0].items[0].customerNameSnapshot).toBe('Test dish EN');
    expect(live[0].totalCents).toBe(1690);

    let tracked = await trackOrder(res.trackingToken);
    expect(tracked?.status).toBe('NEW');

    const id = live[0].id;
    await changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    await changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'ACCEPTED', to: 'PREPARING' });
    await expect(changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'PREPARING', to: 'READY' })).rejects.toThrow(/stations are still preparing/);
    const ticket = await db.kitchenTicket.findFirstOrThrow({ where: { orderId: id } });
    await changeTicketStatus(f.ctx, { ticketId: ticket.id, expectedFrom: 'PENDING', to: 'READY' });
    tracked = await trackOrder(res.trackingToken);
    expect(tracked?.status).toBe('READY');
    await changeOrderStatus(f.ctx, { orderId: id, expectedFrom: 'READY', to: 'COMPLETED' });
    tracked = await trackOrder(res.trackingToken);
    expect(tracked?.status).toBe('COMPLETED');
    expect(tracked?.events.map((e) => e.toStatus)).toEqual(['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']);
  });

  it('rejects impossible status changes and stale (duplicate) updates', async () => {
    const f = await createOrderingFixture();
    await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'ip');
    const order = await db.order.findFirstOrThrow();
    await expect(changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'COMPLETED' })).rejects.toThrow(/Cannot change/);
    await expect(changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'OUT_FOR_DELIVERY' })).rejects.toThrow(/Cannot change/);
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    // A reconnecting tablet replays the same "accept": rejected as a conflict, no second event.
    await expect(changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'ACCEPTED' })).rejects.toMatchObject({ code: 'status_conflict' });
    expect(await db.orderStatusEvent.count({ where: { orderId: order.id, toStatus: 'ACCEPTED' } })).toBe(1);
    await expect(changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'ACCEPTED', to: 'CANCELLED' })).rejects.toThrow(/reason/);
  });

  it('TEST 5: routes food to Kitchen and tea to Café; order is READY only when both stations are ready', async () => {
    const f = await createOrderingFixture();
    await submitTableOrder(
      {
        qrToken: f.qrToken,
        idempotencyKey: randomUUID(),
        language: 'pt',
        items: [
          { productId: f.dish.id, quantity: 1, modifiers: [] },
          { productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] },
        ],
      },
      'ip',
    );
    const order = await db.order.findFirstOrThrow();
    const kBefore = await stationTickets(f.ctx, f.kitchen.id);
    expect(kBefore.tickets).toHaveLength(0); // kitchen sees nothing until staff accept
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'ACCEPTED' });

    const k = await stationTickets(f.ctx, f.kitchen.id);
    const c = await stationTickets(f.ctx, f.cafe.id);
    expect(k.tickets).toHaveLength(1);
    expect(c.tickets).toHaveLength(1);
    expect(k.tickets[0].order.items.map((i) => i.nameSnapshot)).toEqual(['Test dish']);
    expect(c.tickets[0].order.items.map((i) => i.nameSnapshot)).toEqual(['Test tea']);

    await changeTicketStatus(f.ctx, { ticketId: c.tickets[0].id, expectedFrom: 'PENDING', to: 'PREPARING' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PREPARING');
    await changeTicketStatus(f.ctx, { ticketId: c.tickets[0].id, expectedFrom: 'PREPARING', to: 'READY' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PREPARING'); // kitchen still working
    await changeTicketStatus(f.ctx, { ticketId: k.tickets[0].id, expectedFrom: 'PENDING', to: 'READY' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('READY');
  });

  it('TEST 7: duplicate submission with the same idempotency key creates exactly one order', async () => {
    const f = await createOrderingFixture();
    const payload = { qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] };
    const results = await Promise.all([submitTableOrder(payload, 'ip'), submitTableOrder(payload, 'ip'), submitTableOrder(payload, 'ip')]);
    expect(await db.order.count()).toBe(1);
    expect(new Set(results.map((r) => r.orderNumber)).size).toBe(1);
    expect(new Set(results.map((r) => r.trackingToken)).size).toBe(1);
    expect(results.filter((r) => r.duplicate).length).toBeGreaterThanOrEqual(2);
  });

  it('TEST 17: a sold-out product cannot be ordered', async () => {
    const f = await createOrderingFixture();
    await setSoldOut(f.ctx, f.dish.id, true);
    await expect(
      submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'ip'),
    ).rejects.toMatchObject({ code: 'items_unavailable' });
    expect(await db.order.count()).toBe(0);
  });

  it('price changes after ordering do not alter historical orders', async () => {
    const f = await createOrderingFixture();
    await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'ip');
    await db.channelPrice.update({ where: { productId_channel: { productId: f.dish.id, channel: 'DINE_IN' } }, data: { amountCents: 9999 } });
    const item = await db.orderItem.findFirstOrThrow();
    expect(item.unitPriceCents).toBe(1690);
    expect((await db.order.findFirstOrThrow()).totalCents).toBe(1690);
  });

  it('refuses orders when the location is unpublished, paused or the QR token was rotated', async () => {
    const f = await createOrderingFixture();
    const items = [{ productId: f.dish.id, quantity: 1, modifiers: [] }];
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { orderingPaused: true } });
    await expect(submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items }, 'ip')).rejects.toMatchObject({ code: 'ordering_paused' });
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { orderingPaused: false } });
    await db.tableQRToken.updateMany({ where: { tableId: f.table.id }, data: { isActive: false } });
    await expect(submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items }, 'ip')).rejects.toMatchObject({ code: 'qr_invalid' });
  });

  it('TEST 15 (orders): restaurant A cannot read or change restaurant B orders', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await submitTableOrder({ qrToken: b.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: b.dish.id, quantity: 1, modifiers: [] }] }, 'ip');
    const orderB = await db.order.findFirstOrThrow({ where: { organizationId: b.org.id } });
    await expect(liveOrders(a.ctx, b.location.id, new Date(0))).rejects.toMatchObject({ reason: 'location' });
    await expect(changeOrderStatus(a.ctx, { orderId: orderB.id, expectedFrom: 'NEW', to: 'ACCEPTED' })).rejects.toThrow(/not found/i);
    await expect(stationTickets(a.ctx, b.kitchen.id)).rejects.toThrow(/not found/i);
    // A's product cannot be ordered through B's QR code either.
    await expect(
      submitTableOrder({ qrToken: b.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: a.dish.id, quantity: 1, modifiers: [] }] }, 'ip'),
    ).rejects.toMatchObject({ code: 'items_unavailable' });
    const stillB = await resolveTenantAccess(b.owner.id, b.org.slug);
    expect((await liveOrders(stillB, b.location.id, new Date(0))).length).toBe(1);
  });
});
