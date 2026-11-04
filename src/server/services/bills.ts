import 'server-only';
import { z } from 'zod';
import type { OrderStatus, PaymentStatus } from '@/generated/prisma/enums';
import { audit } from '../audit';
import { db, type Tx } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { syncLoyaltyForOrder } from './loyalty';
import { lockSession, lockTable, syncOrderReadiness } from './orders';
import { recomputeOrderDiscounts } from './promotions';
import { assertSeatsGuests, pinFields } from './table-access';

const ACTIVE: OrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export function paymentStatusFor(paidCents: number, totalCents: number): PaymentStatus {
  if (paidCents <= 0) return 'UNPAID';
  return paidCents >= totalCents ? 'PAID' : 'PARTIALLY_PAID';
}

/** Re-derives an order's paid amount and payment status from its recorded (non-voided) payments. */
export async function recomputeOrderPayment(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { totalCents: true } });
  const agg = await tx.paymentRecord.aggregate({ where: { orderId, status: 'RECORDED' }, _sum: { amountCents: true } });
  const paid = agg._sum.amountCents ?? 0;
  await tx.order.update({ where: { id: orderId }, data: { paidCents: paid, paymentStatus: paymentStatusFor(paid, order.totalCents) } });
  await syncLoyaltyForOrder(tx, orderId);
}

async function lockOrders(tx: Tx, ids: string[]) {
  if (ids.length) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ANY(${ids}) FOR UPDATE`;
}

async function ownedSession(ctx: TenantContext, sessionId: string, tx: Tx | typeof db = db) {
  const s = await tx.tableSession.findFirst({ where: { id: sessionId, organizationId: ctx.org.id }, include: { table: true } });
  if (!s) throw new UserFacingError('Table session not found.', 404);
  await assertLocationAccess(ctx, s.locationId);
  return s;
}

// ------------------------------------------------------------------ sessions (M8-01, M8-12)

/**
 * Staff open a table for a new party: a new session (new bill, new identity) and, under SESSION_PIN,
 * a new 6-digit PIN that only staff can see. Guests' "please open my table" requests for this table
 * are done. Idempotent: an already open table is returned as it is.
 */
export async function openTableSession(ctx: TenantContext, tableId: string): Promise<{ id: string; tableId: string; pin: string | null; existing: boolean }> {
  assertSeatsGuests(ctx); // opening returns the new PIN
  const table = await db.restaurantTable.findFirst({ where: { id: tableId, organizationId: ctx.org.id }, include: { location: true } });
  if (!table) throw new UserFacingError('Table not found.', 404);
  await assertLocationAccess(ctx, table.locationId);
  if (!table.isActive) throw new UserFacingError('This table is switched off.');
  // Same per-table lock as session creation for guests, so two sessions can never be open at once.
  return db.$transaction(async (tx) => {
    await lockTable(tx, tableId);
    const existing = await tx.tableSession.findFirst({ where: { tableId, status: 'OPEN' }, select: { id: true, tableId: true } });
    if (existing) return { ...existing, pin: null, existing: true };
    const session = await tx.tableSession.create({ data: { organizationId: ctx.org.id, locationId: table.locationId, tableId, openedById: ctx.userId }, select: { id: true, tableId: true } });
    let pin: string | null = null;
    if (table.location.tableOrderingPolicy === 'SESSION_PIN') {
      const issued = pinFields(session.id, ctx.userId);
      pin = issued.pin;
      await tx.tableSession.update({ where: { id: session.id }, data: issued.data });
    }
    await tx.staffTask.updateMany({ where: { tableId, type: 'OPEN_TABLE', status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'DONE', doneAt: new Date() } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'table.session_opened', entityType: 'TableSession', entityId: session.id, metadata: { table: table.label, pin: !!pin } }, tx);
    return { ...session, pin, existing: false };
  });
}

export const closeSessionSchema = z.object({ sessionId: z.string().min(1), note: z.string().trim().max(300).optional() });

/**
 * Closes a table. Refused while orders are still active. An unpaid balance requires an
 * explanation (recorded in the audit log) — nothing is silently marked as paid.
 */
export async function closeTableSession(ctx: TenantContext, input: unknown) {
  const d = closeSessionSchema.parse(input);
  const session = await ownedSession(ctx, d.sessionId);
  if (session.status !== 'OPEN') throw new UserFacingError('This table is already closed.');
  await db.$transaction(async (tx) => {
    // Same table lock as session creation, then the exclusive lock on the session row that every
    // order in flight shares (orders.ts shareOpenSession): an order placed while the table is being
    // closed either commits first and counts in the checks below, or finds the session closed. It
    // never lands on a closed bill.
    await lockTable(tx, session.tableId);
    await lockSession(tx, session.id);
    const orders = await tx.order.findMany({ where: { tableSessionId: session.id, organizationId: ctx.org.id, status: { not: 'CANCELLED' } }, select: { status: true, totalCents: true, paidCents: true } });
    if (orders.some((o) => ACTIVE.includes(o.status) && o.status !== 'READY' && o.status !== 'DELIVERED')) throw new UserFacingError('Some orders are still being prepared. Complete or cancel them first.');
    const balanceCents = orders.reduce((s, o) => s + o.totalCents - o.paidCents, 0);
    if (balanceCents > 0 && !d.note) throw new UserFacingError(`There is an unpaid balance of ${(balanceCents / 100).toFixed(2)} €. Record the payment, or give a reason to close anyway.`);
    const bill = { balanceCents };
    // The PIN and the legacy code die with the seating; every phone authorised for it is revoked in
    // this same transaction, so a guest who left cannot order onto the next party's bill.
    const now = new Date();
    const r = await tx.tableSession.updateMany({ where: { id: session.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: now, closedById: ctx.userId, closeNote: d.note ?? null, pinCipher: null, verificationCode: null } });
    if (r.count !== 1) throw new UserFacingError('This table is already closed.');
    const revoked = await tx.tableSessionDevice.updateMany({ where: { tableSessionId: session.id, revokedAt: null }, data: { revokedAt: now, revokedById: ctx.userId } });
    await tx.staffTask.updateMany({ where: { tableSessionId: session.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'DONE', doneAt: now } });
    // Orders that were ready (served) are completed when the table closes.
    const served = await tx.order.findMany({ where: { tableSessionId: session.id, status: 'READY' }, select: { id: true } });
    for (const o of served) {
      const u = await tx.order.updateMany({ where: { id: o.id, status: 'READY' }, data: { status: 'COMPLETED', completedAt: new Date() } });
      if (u.count) await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: 'READY', toStatus: 'COMPLETED', actorType: 'STAFF', actorUserId: ctx.userId, note: 'Table closed' } });
      if (u.count) await syncLoyaltyForOrder(tx, o.id);
    }
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'table.session_closed', entityType: 'TableSession', entityId: session.id, metadata: { balanceCents: bill.balanceCents, note: d.note ?? null, devicesRevoked: revoked.count } }, tx);
  });
}

// ------------------------------------------------------------------ bill (M8-02)

/** All orders of a table session merged into one bill. Item "paid" only counts explicit item allocations. */
export async function getSessionBill(ctx: TenantContext, sessionId: string) {
  const session = await ownedSession(ctx, sessionId);
  const orders = await db.order.findMany({
    where: { tableSessionId: session.id, organizationId: ctx.org.id },
    orderBy: { createdAt: 'asc' },
    include: {
      items: { orderBy: { createdAt: 'asc' }, include: { modifiers: true, allocations: { where: { payment: { status: 'RECORDED' } } } } },
      payments: { orderBy: { createdAt: 'asc' }, include: { allocations: true } },
    },
  });
  const billable = orders.filter((o) => o.status !== 'CANCELLED');
  const billedCents = billable.reduce((s, o) => s + o.totalCents, 0);
  const paidCents = billable.reduce((s, o) => s + o.paidCents, 0);
  const items = billable.flatMap((o) =>
    o.items
      .filter((i) => !i.voidedAt)
      .map((i) => {
        const allocated = i.allocations.reduce((s, a) => s + a.amountCents, 0);
        return { ...i, orderNumber: o.number, orderId: o.id, allocatedCents: allocated, remainingCents: i.lineTotalCents - allocated, fullyPaid: allocated >= i.lineTotalCents };
      }),
  );
  return { session, orders, items, billedCents, paidCents, balanceCents: billedCents - paidCents };
}

// ------------------------------------------------------------------ item changes (M8-05)

export const itemChangeSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(0).max(50),
  reason: z.string().trim().min(3).max(300),
  /** Staff confirm they told the station: required once the station started or finished the item. */
  kitchenNotified: z.boolean().default(false),
});

/** The order has left the restaurant (or is finished): what was handed over can no longer change. */
const FROZEN: OrderStatus[] = ['OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'];

/**
 * Reduces the quantity of an order line or voids it (quantity 0). Requires a reason; recorded
 * with before/after in the audit log. Amounts already paid can never be removed.
 *
 * Stage rules (everything re-read under the order lock that payments also take):
 * - NEW: the kitchen has not seen it, any reduction is allowed.
 * - ACCEPTED / PREPARING / READY: the station has the ticket. The change is shown on it (removed
 *   or "was N"); once the station has started or finished the item, staff must also confirm they
 *   told the station. Removing the last item is refused: that is a cancellation (Cancel order).
 * - OUT_FOR_DELIVERY / DELIVERED / COMPLETED / CANCELLED: refused.
 */
export async function changeOrderItem(ctx: TenantContext, input: unknown) {
  const d = itemChangeSchema.parse(input);
  await db.$transaction(async (tx) => {
    const found = await tx.orderItem.findFirst({ where: { id: d.itemId, organizationId: ctx.org.id }, select: { orderId: true, order: { select: { locationId: true } } } });
    if (!found) throw new UserFacingError('Item not found.', 404);
    await assertLocationAccess(ctx, found.order.locationId);
    await lockOrders(tx, [found.orderId]);
    // Read again under the lock: a payment for this item, or another change of it, committed a
    // moment ago is taken into account instead of being overwritten.
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: d.itemId }, include: { allocations: { where: { payment: { status: 'RECORDED' } } } } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: item.orderId } });
    if (item.voidedAt) throw new UserFacingError('This item was already removed.');
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED') throw new UserFacingError('Completed or cancelled orders cannot be changed.');
    if (FROZEN.includes(order.status)) throw new UserFacingError('This order is out for delivery or delivered. Its items and total can no longer change.');
    if (d.quantity >= item.quantity) throw new UserFacingError('To add more, place a new order. Here you can only reduce or remove.');
    const atStation = order.status !== 'NEW';
    // Counter items (no station) are handled by front of house itself: nobody else to tell.
    const started = !!item.stationId && (item.prepStatus === 'PREPARING' || item.prepStatus === 'READY');
    if (atStation && started && !d.kitchenNotified) {
      throw new UserFacingError(
        item.prepStatus === 'READY'
          ? 'This item is already prepared. Tell the station, then confirm that you did to change it.'
          : 'The kitchen has already started this item. Tell the station, then confirm that you did to change it.',
      );
    }
    const perUnit = item.unitPriceCents + item.modifiersUnitCents;
    const newLine = perUnit * d.quantity;
    const allocated = item.allocations.reduce((s, a) => s + a.amountCents, 0);
    if (allocated > newLine) throw new UserFacingError('Part of this item is already paid. Void that payment first.');
    if (atStation && d.quantity === 0) {
      const others = await tx.orderItem.count({ where: { orderId: order.id, voidedAt: null, id: { not: item.id } } });
      if (others === 0) throw new UserFacingError('This is the last item of the order. Cancel the order instead (with a reason), so every station is told.');
    }
    const now = new Date();
    await tx.orderItem.update({
      where: { id: item.id },
      data:
        d.quantity === 0
          ? { voidedAt: now, voidedById: ctx.userId, voidReason: d.reason, prepStatus: 'CANCELLED' }
          : // Once the station has the ticket, it shows the line as changed ("was N").
            { quantity: d.quantity, lineTotalCents: newLine, ...(atStation ? { amendedAt: now, originalQuantity: item.originalQuantity ?? item.quantity } : {}) },
    });
    const lines = await tx.orderItem.findMany({ where: { orderId: order.id, voidedAt: null } });
    const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
    // Re-evaluate the applied promotions on the remaining items; a discount never stays larger
    // than the new items justify (audit BUG-11: a 10 % discount kept its old amount).
    const discount = order.discountCents > 0 ? Math.min(order.discountCents, await recomputeOrderDiscounts(tx, order.id, order.subtotalCents, lines)) : 0;
    const total = subtotal - discount + order.deliveryFeeCents;
    if (order.paidCents > total) throw new UserFacingError('The new total would be lower than what was already paid. Void a payment first.');
    await tx.order.update({ where: { id: order.id }, data: { subtotalCents: subtotal, discountCents: discount, totalCents: total, paymentStatus: paymentStatusFor(order.paidCents, total) } });
    await syncLoyaltyForOrder(tx, order.id);
    let stationTicketCancelled = false;
    if (item.stationId) {
      const remaining = lines.filter((l) => l.stationId === item.stationId).length;
      // The cancelled ticket stays on that station's screen for a while, with the removed line.
      if (remaining === 0) stationTicketCancelled = (await tx.kitchenTicket.updateMany({ where: { orderId: order.id, stationId: item.stationId }, data: { status: 'CANCELLED' } })).count > 0;
    }
    if (lines.length === 0) {
      // Only reachable for NEW orders (see above): the kitchen never had a ticket.
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: d.reason } });
      await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: 'CANCELLED', actorType: 'STAFF', actorUserId: ctx.userId, note: `All items removed: ${d.reason}` } });
    } else if (atStation) {
      // Removing a station's last open item, or the counter's last waiting one, can complete the order.
      await syncOrderReadiness(tx, order.id, ctx.userId);
    }
    await audit(
      {
        organizationId: ctx.org.id,
        actorUserId: ctx.userId,
        action: d.quantity === 0 ? 'order.item_voided' : 'order.item_quantity_reduced',
        entityType: 'OrderItem',
        entityId: item.id,
        metadata: {
          orderNumber: order.number,
          item: item.nameSnapshot,
          from: item.quantity,
          to: d.quantity,
          reason: d.reason,
          totalBefore: order.totalCents,
          totalAfter: total,
          discountBefore: order.discountCents,
          discountAfter: discount,
          // Where the order was when it changed, and what the station was told.
          orderStatus: order.status,
          prepStatus: item.prepStatus,
          stationId: item.stationId,
          shownOnStation: atStation && !!item.stationId,
          stationTicketCancelled,
          kitchenNotified: d.kitchenNotified,
        },
      },
      tx,
    );
  });
}

// ------------------------------------------------------------------ transfer (M8-06)

export async function transferSession(ctx: TenantContext, sessionId: string, toTableId: string) {
  const session = await ownedSession(ctx, sessionId);
  if (session.status !== 'OPEN') throw new UserFacingError('Only open tables can be moved.');
  const target = await db.restaurantTable.findFirst({ where: { id: toTableId, organizationId: ctx.org.id, locationId: session.locationId, isActive: true } });
  if (!target) throw new UserFacingError('Choose an active table in the same location.');
  if (target.id === session.tableId) throw new UserFacingError('This is already the current table.');
  await db.$transaction(async (tx) => {
    await lockTable(tx, target.id);
    // Orders in flight on the old table finish first (they share this row's lock), then follow the move.
    await lockSession(tx, session.id);
    const busy = await tx.tableSession.findFirst({ where: { tableId: target.id, status: 'OPEN' } });
    if (busy) throw new UserFacingError(`Table ${target.label} already has guests. Close it first.`);
    await tx.tableSession.update({ where: { id: session.id }, data: { tableId: target.id } });
    await tx.order.updateMany({ where: { tableSessionId: session.id }, data: { tableId: target.id } });
    // The party's phones follow them: they order with the new table's QR, no new PIN needed.
    await tx.tableSessionDevice.updateMany({ where: { tableSessionId: session.id }, data: { tableId: target.id } });
    await tx.staffTask.updateMany({ where: { tableSessionId: session.id }, data: { tableId: target.id } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'table.session_transferred', entityType: 'TableSession', entityId: session.id, metadata: { from: session.table.label, to: target.label } }, tx);
  });
}

// ------------------------------------------------------------------ payments (M8-07, M8-08)

export const PAYMENT_METHODS = ['CASH', 'CARD_TERMINAL', 'PAY_AT_COUNTER', 'CASH_ON_DELIVERY', 'OTHER_MANUAL'] as const;

export const paymentSchema = z.object({
  sessionId: z.string().optional(),
  orderId: z.string().optional(),
  method: z.enum(PAYMENT_METHODS),
  /** Split by amount (whole bill). */
  amountCents: z.number().int().positive().optional(),
  /** Split by items: pay these items' remaining amounts. */
  itemIds: z.array(z.string()).optional(),
  note: z.string().trim().max(200).optional(),
});

/**
 * Records a payment taken at the restaurant (cash / card terminal / counter). No online
 * payment and no card data are handled by MenuNiva. Overpayment is refused; concurrent
 * payments, cancellations and item changes are serialised with the order row lock.
 *
 * This is an operational record for reconciling with the till. It is NOT a Portuguese fiscal
 * document (fatura / fatura-recibo): MenuNiva is not certified invoicing or POS software, and the
 * legal document is issued by the restaurant's certified system.
 */
export async function recordPayment(ctx: TenantContext, input: unknown) {
  const d = paymentSchema.parse(input);
  if (!d.sessionId && !d.orderId) throw new UserFacingError('Choose a table or an order.');
  if (!!d.amountCents === !!d.itemIds?.length) throw new UserFacingError('Enter an amount or select items — not both.');
  return db.$transaction(async (tx) => {
    let orders;
    if (d.sessionId) {
      const s = await ownedSession(ctx, d.sessionId, tx);
      orders = await tx.order.findMany({ where: { tableSessionId: s.id, organizationId: ctx.org.id, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } });
    } else {
      const o = await tx.order.findFirst({ where: { id: d.orderId, organizationId: ctx.org.id } });
      if (!o) throw new UserFacingError('Order not found.', 404);
      await assertLocationAccess(ctx, o.locationId);
      if (o.status === 'CANCELLED') throw new UserFacingError('This order was cancelled.');
      orders = [o];
    }
    await lockOrders(tx, orders.map((o) => o.id));
    const locked = await tx.order.findMany({ where: { id: { in: orders.map((o) => o.id) } }, orderBy: { createdAt: 'asc' } });
    // An order cancelled while this payment was being recorded takes no money.
    if (d.orderId && locked.some((o) => o.status === 'CANCELLED')) throw new UserFacingError('This order was cancelled.');
    orders = locked.filter((o) => o.status !== 'CANCELLED');
    // "Cash on delivery" is cash a driver collected at the door for an order the guest said they
    // would pay in cash. It is never a table bill, and never an order the guest pays by card.
    if (d.method === 'CASH_ON_DELIVERY' && !orders.every((o) => o.channel === 'DELIVERY' && o.paymentMethodIntent !== 'CARD_TERMINAL')) {
      throw new UserFacingError('“Cash on delivery” is only for delivery orders paid in cash at the door. Choose Cash or Card for this payment.');
    }
    const created: string[] = [];

    if (d.itemIds?.length) {
      const items = await tx.orderItem.findMany({
        where: { id: { in: d.itemIds }, orderId: { in: orders.map((o) => o.id) }, voidedAt: null },
        include: { allocations: { where: { payment: { status: 'RECORDED' } } } },
      });
      if (items.length !== new Set(d.itemIds).size) throw new UserFacingError('Some selected items are not on this bill.');
      const byOrder = new Map<string, { id: string; amount: number }[]>();
      for (const i of items) {
        const remaining = i.lineTotalCents - i.allocations.reduce((s, a) => s + a.amountCents, 0);
        if (remaining <= 0) throw new UserFacingError(`“${i.nameSnapshot}” is already paid.`);
        byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), { id: i.id, amount: remaining }]);
      }
      for (const [orderId, lines] of byOrder) {
        const o = orders.find((x) => x.id === orderId)!;
        const amount = lines.reduce((s, l) => s + l.amount, 0);
        // Order-level discounts/fees can make the order total lower than the sum of its lines.
        const pay = Math.min(amount, o.totalCents - o.paidCents);
        if (pay <= 0) throw new UserFacingError(`Order #${o.number} is already paid.`);
        let left = pay;
        const allocations = lines.map((l) => {
          const a = Math.min(l.amount, left);
          left -= a;
          return { orderItemId: l.id, amountCents: a };
        }).filter((a) => a.amountCents > 0);
        const p = await tx.paymentRecord.create({ data: { organizationId: ctx.org.id, orderId, amountCents: pay, method: d.method, recordedById: ctx.userId, note: d.note ?? null, allocations: { create: allocations } } });
        created.push(p.id);
        await recomputeOrderPayment(tx, orderId);
      }
    } else {
      let left = d.amountCents!;
      const balance = orders.reduce((s, o) => s + (o.totalCents - o.paidCents), 0);
      if (left > balance) throw new UserFacingError(`The amount is higher than the remaining balance (${(balance / 100).toFixed(2)} €).`);
      for (const o of orders) {
        const due = o.totalCents - o.paidCents;
        if (due <= 0 || left <= 0) continue;
        const pay = Math.min(due, left);
        left -= pay;
        const p = await tx.paymentRecord.create({ data: { organizationId: ctx.org.id, orderId: o.id, amountCents: pay, method: d.method, recordedById: ctx.userId, note: d.note ?? null } });
        created.push(p.id);
        await recomputeOrderPayment(tx, o.id);
      }
    }
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'payment.recorded', entityType: d.sessionId ? 'TableSession' : 'Order', entityId: d.sessionId ?? d.orderId ?? null, metadata: { method: d.method, amountCents: d.amountCents ?? null, itemIds: d.itemIds ?? null, payments: created } }, tx);
    return { paymentIds: created };
  });
}

/**
 * Marks a recorded payment as given back (reversal). The record stays, with who voided it, when
 * and why (audit OPS-49: the reason used to live only in the audit log). Serialised with payments,
 * item changes and cancellation by the same order lock.
 */
export async function voidPayment(ctx: TenantContext, paymentId: string, reason: string) {
  const why = reason?.trim().slice(0, 300);
  if (!why) throw new UserFacingError('Give a reason for voiding this payment.');
  await db.$transaction(async (tx) => {
    const p = await tx.paymentRecord.findFirst({ where: { id: paymentId, organizationId: ctx.org.id }, include: { order: true } });
    if (!p) throw new UserFacingError('Payment not found.', 404);
    await assertLocationAccess(ctx, p.order.locationId);
    await lockOrders(tx, [p.orderId]);
    const r = await tx.paymentRecord.updateMany({ where: { id: p.id, status: 'RECORDED' }, data: { status: 'VOIDED', voidedAt: new Date(), voidedById: ctx.userId, voidReason: why } });
    if (r.count !== 1) throw new UserFacingError('This payment was already voided.');
    await recomputeOrderPayment(tx, p.orderId);
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'payment.voided', entityType: 'PaymentRecord', entityId: p.id, metadata: { orderNumber: p.order.number, method: p.method, amountCents: p.amountCents, reason: why } }, tx);
  });
}

export async function listOpenSessions(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  const sessions = await db.tableSession.findMany({
    where: { organizationId: ctx.org.id, locationId, status: 'OPEN' },
    include: { table: { select: { label: true } }, orders: { where: { status: { not: 'CANCELLED' } }, select: { totalCents: true, paidCents: true, status: true } } },
    orderBy: { openedAt: 'asc' },
  });
  return sessions.map((s) => ({
    ...s,
    billedCents: s.orders.reduce((a, o) => a + o.totalCents, 0),
    paidCents: s.orders.reduce((a, o) => a + o.paidCents, 0),
    activeOrders: s.orders.filter((o) => ACTIVE.includes(o.status) && o.status !== 'READY').length,
  }));
}
