import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { toEscPos, ticketPdf } from '@/server/printing';
import { changeOrderItem, closeTableSession, getSessionBill, openTableSession, recordPayment, transferSession, voidPayment } from '@/server/services/bills';
import { changeOrderStatus, submitTableOrder } from '@/server/services/orders';
import { ticketPrintData } from '@/server/services/tickets';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;

async function order(f: F, items: { productId: string; quantity: number; modifiers?: { optionId: string; quantity: number }[] }[], extra: Record<string, unknown> = {}) {
  return submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: items.map((i) => ({ modifiers: [], ...i })), ...extra }, `k${Math.random()}`);
}

async function sessionOf(f: F) {
  return db.tableSession.findFirstOrThrow({ where: { tableId: f.table.id, status: 'OPEN' } });
}

describe('M8 table sessions and bills', () => {
  beforeEach(resetDatabase);

  it('M8-01/02: several orders from one table are merged into one session bill', async () => {
    const f = await createOrderingFixture();
    await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    await order(f, [{ productId: f.tea.id, quantity: 2, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] }]);
    const s = await sessionOf(f);
    const bill = await getSessionBill(f.ctx, s.id);
    expect(bill.orders).toHaveLength(2);
    expect(bill.billedCents).toBe(1690 + 500);
    expect(bill.balanceCents).toBe(2190);
    expect(bill.items.map((i) => [i.nameSnapshot, i.quantity])).toEqual([['Test dish', 1], ['Test tea', 2]]);
  });

  it('M8-07/08 + TEST 18 (payments): partial payments never mark unpaid items as paid; overpayment refused', async () => {
    const f = await createOrderingFixture();
    await order(f, [{ productId: f.dish.id, quantity: 1 }, { productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] }]);
    const s = await sessionOf(f);
    let bill = await getSessionBill(f.ctx, s.id);
    const tea = bill.items.find((i) => i.nameSnapshot === 'Test tea')!;
    // Guest A pays only the tea
    await recordPayment(f.ctx, { sessionId: s.id, method: 'CASH', itemIds: [tea.id] });
    bill = await getSessionBill(f.ctx, s.id);
    expect(bill.paidCents).toBe(250);
    expect(bill.items.find((i) => i.nameSnapshot === 'Test tea')!.fullyPaid).toBe(true);
    expect(bill.items.find((i) => i.nameSnapshot === 'Test dish')!.fullyPaid).toBe(false);
    expect((await db.order.findFirstOrThrow()).paymentStatus).toBe('PARTIALLY_PAID');
    await expect(recordPayment(f.ctx, { sessionId: s.id, method: 'CASH', itemIds: [tea.id] })).rejects.toThrow(/already paid/);
    await expect(recordPayment(f.ctx, { sessionId: s.id, method: 'CARD_TERMINAL', amountCents: 5000 })).rejects.toThrow(/higher than the remaining balance/);
    // Guest B pays 10 € on account: items stay unpaid individually, order stays partially paid
    await recordPayment(f.ctx, { sessionId: s.id, method: 'CARD_TERMINAL', amountCents: 1000 });
    bill = await getSessionBill(f.ctx, s.id);
    expect(bill.balanceCents).toBe(690);
    expect(bill.items.find((i) => i.nameSnapshot === 'Test dish')!.fullyPaid).toBe(false);
    await recordPayment(f.ctx, { sessionId: s.id, method: 'CASH', amountCents: 690 });
    expect((await db.order.findFirstOrThrow()).paymentStatus).toBe('PAID');
    // Voiding a payment re-opens the balance
    const p = await db.paymentRecord.findFirstOrThrow({ where: { amountCents: 690 } });
    await voidPayment(f.ctx, p.id, 'Wrong amount typed');
    const o = await db.order.findFirstOrThrow();
    expect([o.paidCents, o.paymentStatus]).toEqual([1250, 'PARTIALLY_PAID']);
  });

  it('concurrent payments cannot overpay the bill', async () => {
    const f = await createOrderingFixture();
    await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    const s = await sessionOf(f);
    const results = await Promise.allSettled([1, 2, 3].map(() => recordPayment(f.ctx, { sessionId: s.id, method: 'CASH', amountCents: 1000 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const o = await db.order.findFirstOrThrow();
    expect(o.paidCents).toBe(1000);
  });

  it('M8-05: reducing/voiding items needs a reason, is audited, recalculates totals and cannot remove paid amounts', async () => {
    const f = await createOrderingFixture();
    await order(f, [{ productId: f.dish.id, quantity: 3 }, { productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] }]);
    await changeOrderStatus(f.ctx, { orderId: (await db.order.findFirstOrThrow()).id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    const s = await sessionOf(f);
    let bill = await getSessionBill(f.ctx, s.id);
    const dish = bill.items.find((i) => i.nameSnapshot === 'Test dish')!;
    const tea = bill.items.find((i) => i.nameSnapshot === 'Test tea')!;
    await expect(changeOrderItem(f.ctx, { itemId: dish.id, quantity: 2, reason: '' })).rejects.toThrow();
    await changeOrderItem(f.ctx, { itemId: dish.id, quantity: 2, reason: 'Guest changed mind' });
    expect((await db.order.findFirstOrThrow()).totalCents).toBe(1690 * 2 + 250);
    await expect(changeOrderItem(f.ctx, { itemId: dish.id, quantity: 5, reason: 'more' })).rejects.toThrow(/new order/);
    // Voiding the only café item cancels the café ticket
    await changeOrderItem(f.ctx, { itemId: tea.id, quantity: 0, reason: 'Out of mint' });
    const cafeTicket = await db.kitchenTicket.findFirstOrThrow({ where: { stationId: f.cafe.id } });
    expect(cafeTicket.status).toBe('CANCELLED');
    // Pay one dish by item, then try to remove it
    bill = await getSessionBill(f.ctx, s.id);
    await recordPayment(f.ctx, { sessionId: s.id, method: 'CASH', itemIds: [dish.id] });
    await expect(changeOrderItem(f.ctx, { itemId: dish.id, quantity: 0, reason: 'mistake' })).rejects.toThrow(/already paid/);
    const logs = await db.auditLog.findMany({ where: { action: { in: ['order.item_quantity_reduced', 'order.item_voided'] } } });
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.action === 'order.item_voided')?.metadata).toMatchObject({ item: 'Test tea', reason: 'Out of mint' });
  });

  it('M8-06: transfer an open table to a free table (audited); a busy target is refused', async () => {
    const f = await createOrderingFixture();
    await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    const t2 = await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label: '06' } });
    const s = await sessionOf(f);
    await transferSession(f.ctx, s.id, t2.id);
    expect((await db.order.findFirstOrThrow()).tableId).toBe(t2.id);
    expect((await db.tableSession.findUniqueOrThrow({ where: { id: s.id } })).tableId).toBe(t2.id);
    await order(f, [{ productId: f.dish.id, quantity: 1 }]); // new guests at table 05
    const s05 = await sessionOf(f);
    await expect(transferSession(f.ctx, s.id, f.table.id)).rejects.toThrow(/already has guests/);
    expect(s05.id).not.toBe(s.id);
    expect(await db.auditLog.count({ where: { action: 'table.session_transferred' } })).toBe(1);
  });

  it('M8-01: closing requires finished orders and an explanation for any unpaid balance', async () => {
    const f = await createOrderingFixture();
    await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    const s = await sessionOf(f);
    await expect(closeTableSession(f.ctx, { sessionId: s.id })).rejects.toThrow(/still being prepared/);
    const o = await db.order.findFirstOrThrow();
    await changeOrderStatus(f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    const ticket = await db.kitchenTicket.findFirstOrThrow();
    await db.kitchenTicket.update({ where: { id: ticket.id }, data: { status: 'READY' } });
    await changeOrderStatus(f.ctx, { orderId: o.id, expectedFrom: 'ACCEPTED', to: 'READY' });
    await expect(closeTableSession(f.ctx, { sessionId: s.id })).rejects.toThrow(/unpaid balance/);
    await recordPayment(f.ctx, { sessionId: s.id, method: 'PAY_AT_COUNTER', amountCents: 1690 });
    await closeTableSession(f.ctx, { sessionId: s.id });
    expect((await db.order.findFirstOrThrow()).status).toBe('COMPLETED');
    // The next guests start a new session
    await order(f, [{ productId: f.dish.id, quantity: 1 }]);
    expect((await sessionOf(f)).id).not.toBe(s.id);
  });

  it('M8-12 (now SESSION_PIN): staff must open the table; a code sent with the order never authorises it', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tableOrderingPolicy: 'SESSION_PIN' } });
    const items = [{ productId: f.dish.id, quantity: 1 }];
    await expect(order(f, items)).rejects.toMatchObject({ code: 'table_not_open' });
    const session = await openTableSession(f.ctx, f.table.id);
    expect(session.pin).toMatch(/^\d{6}$/);
    // The old per-order field is ignored: each phone enters the PIN once (secure-table-sessions.test.ts).
    await expect(order(f, items, { tableCode: session.pin! })).rejects.toMatchObject({ code: 'pin_required' });
    expect(await db.order.count()).toBe(0);
  });

  it('bills and payments are tenant-isolated', async () => {
    const a = await createOrderingFixture('Test A');
    const b = await createOrderingFixture('Test B');
    await order(b, [{ productId: b.dish.id, quantity: 1 }]);
    const sb = await sessionOf(b);
    await expect(getSessionBill(a.ctx, sb.id)).rejects.toThrow(/not found/);
    await expect(recordPayment(a.ctx, { sessionId: sb.id, method: 'CASH', amountCents: 100 })).rejects.toThrow(/not found/);
    const item = await db.orderItem.findFirstOrThrow({ where: { organizationId: b.org.id } });
    await expect(changeOrderItem(a.ctx, { itemId: item.id, quantity: 0, reason: 'hack attempt' })).rejects.toThrow(/not found/);
  });
});

describe('M8-10/11 kitchen ticket printing', () => {
  beforeEach(resetDatabase);

  it('kitchen and café get separate tickets with only their items (PDF + ESC/POS)', async () => {
    const f = await createOrderingFixture();
    await order(f, [{ productId: f.dish.id, quantity: 2 }, { productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.honey.id, quantity: 1 }] }], { notes: 'Sem pressa' });
    await changeOrderStatus(f.ctx, { orderId: (await db.order.findFirstOrThrow()).id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    const kt = await db.kitchenTicket.findFirstOrThrow({ where: { stationId: f.kitchen.id } });
    const ct = await db.kitchenTicket.findFirstOrThrow({ where: { stationId: f.cafe.id } });
    const k = await ticketPrintData(f.ctx, kt.id);
    const c = await ticketPrintData(f.ctx, ct.id);
    expect(k.items).toEqual([{ quantity: 2, name: 'Test dish', detail: null, notes: null }]);
    expect(c.items).toEqual([{ quantity: 1, name: 'Test tea', detail: 'Com mel', notes: null }]);
    expect(k.where).toBe('Mesa 05');
    expect((await db.kitchenTicket.findUniqueOrThrow({ where: { id: kt.id } })).printedAt).not.toBeNull();
    const pdf = await ticketPdf(k);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    const esc = Buffer.from(toEscPos(c)).toString('latin1');
    expect(esc.startsWith('\x1b@')).toBe(true);
    expect(esc).toContain('1 x Test tea');
    expect(esc).toContain('Com mel');
    expect(esc).toContain('NOTA: Sem pressa');
    expect(esc.endsWith('\x1dVB\x00')).toBe(true);
  });
});
