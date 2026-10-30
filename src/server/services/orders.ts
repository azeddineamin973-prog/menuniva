import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { LanguageCode, OrderChannel, OrderStatus, PrepStatus } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { LANGUAGES } from '@/i18n/config';
import { canTransition, ACTIVE_STATUSES } from '@/lib/order-state';
import { audit } from '../audit';
import { hashToken, safeEqual } from '../crypto';
import { db, type Tx } from '../db';
import { assertModule, hasModule } from '../modules';
import { env } from '../env';
import { UserFacingError } from '../errors';
import { rateLimit } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { cartSchema, quoteCart, type QuoteIssue } from './pricing';
import { orderingState } from './public-menu';
import { computeDiscounts, consumeUsage } from './promotions';
import { syncLoyaltyForOrder } from './loyalty';

/**
 * Customer tracking token. Derived with HMAC from the location and the client's
 * idempotency key, so a retried submission gets the same token back. Only its SHA-256 hash
 * is stored. Unguessable without APP_SECRET.
 */
export function trackingTokenFor(locationId: string, idempotencyKey: string): string {
  return createHmac('sha256', env.APP_SECRET).update(`order:${locationId}:${idempotencyKey}`).digest('base64url').slice(0, 32);
}

export class OrderRejectedError extends UserFacingError {
  constructor(
    code: string,
    public issues: QuoteIssue[] = [],
    public extra: Record<string, unknown> = {},
  ) {
    super(code, 422, issues);
  }
}

export const submitTableOrderSchema = z.object({
  qrToken: z.string().min(10).max(64),
  idempotencyKey: z.string().uuid(),
  language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]),
  items: cartSchema,
  notes: z.string().trim().max(300).optional(),
  tableCode: z.string().trim().max(8).optional(),
  couponCode: z.string().trim().max(30).optional(),
});

export type SubmittedOrder = { orderNumber: number; trackingToken: string; status: OrderStatus; duplicate: boolean };

/** Resolves an active table QR token → table + location + organization (public). */
export async function resolveTableToken(token: string) {
  const qr = await db.tableQRToken.findUnique({
    where: { token },
    include: { table: { include: { location: { include: { organization: true } }, area: true } } },
  });
  if (!qr || !qr.isActive || !qr.table.isActive) return null;
  return qr.table;
}

/**
 * Submits a table order. Guarantees:
 * - prices/availability recomputed server-side inside the transaction,
 * - idempotent per (location, idempotencyKey): retries return the original order,
 * - order + items + status event are written in one transaction before success is reported,
 * - throttled per device/IP and per table.
 */
export async function submitTableOrder(input: unknown, clientKey: string): Promise<SubmittedOrder> {
  const data = submitTableOrderSchema.parse(input);
  const table = await resolveTableToken(data.qrToken);
  if (!table) throw new OrderRejectedError('qr_invalid');
  const location = table.location;
  const state = orderingState(location, location.organization.status, 'TABLE');
  if (!state.canOrder) throw new OrderRejectedError(`ordering_${state.reason}`);
  if (!(await hasModule(location.organizationId, 'table_ordering'))) throw new OrderRejectedError('module_not_available');

  const trackingToken = trackingTokenFor(location.id, data.idempotencyKey);
  const existing = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: data.idempotencyKey } } });
  if (existing) return { orderNumber: existing.number, trackingToken, status: existing.status, duplicate: true };

  await rateLimit(`order:client:${location.id}:${clientKey}`, 8, 600);
  await rateLimit(`order:table:${table.id}`, 30, 3600);

  // Optional table code (M8-12): staff open the table and tell guests a 4-digit code.
  if (location.tableCodeRequired) {
    const open = await db.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' } });
    if (!open?.verificationCode) throw new OrderRejectedError('table_not_open');
    await rateLimit(`order:tablecode:${table.id}:${clientKey}`, 6, 600);
    if (!data.tableCode || !safeEqual(data.tableCode, open.verificationCode)) throw new OrderRejectedError('table_code_invalid');
  }

  try {
    return await db.$transaction(async (tx) => {
      const quote = await quoteCart({ locationId: location.id, channel: 'TABLE', lang: data.language, items: data.items }, tx);
      if (quote.issues.length) throw new OrderRejectedError('items_unavailable', quote.issues);

      let session = await tx.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' } });
      if (!session && location.tableCodeRequired) throw new OrderRejectedError('table_not_open');
      session ??= await tx.tableSession.create({ data: { organizationId: location.organizationId, locationId: location.id, tableId: table.id } });

      const promo = await computeDiscounts(tx, { organizationId: location.organizationId, locationId: location.id, channel: 'TABLE', couponCode: data.couponCode, lines: quote.lines, subtotalCents: quote.subtotalCents });
      if (data.couponCode && promo.couponStatus === 'invalid') throw new OrderRejectedError('coupon_invalid');
      const { orderSequence } = await tx.restaurantLocation.update({ where: { id: location.id }, data: { orderSequence: { increment: 1 } }, select: { orderSequence: true } });
      const order = await createOrderRecord(tx, {
        discountCents: promo.totalCents,
        organizationId: location.organizationId,
        locationId: location.id,
        number: orderSequence,
        channel: 'TABLE',
        tableId: table.id,
        tableSessionId: session.id,
        language: data.language,
        customerNotes: data.notes?.trim() || null,
        idempotencyKey: data.idempotencyKey,
        trackingToken,
        quote,
      });
      await consumeUsage(tx, location.organizationId, order.id, promo.discounts);
      await tx.notification.create({
        data: { organizationId: location.organizationId, locationId: location.id, type: 'NEW_ORDER', title: `New order #${order.number} — table ${table.label}`, entityId: order.id },
      });
      return { orderNumber: order.number, trackingToken, status: order.status, duplicate: false };
    });
  } catch (e) {
    // Two identical submissions raced: the unique (locationId, idempotencyKey) index wins.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: data.idempotencyKey } } });
      if (again) return { orderNumber: again.number, trackingToken, status: again.status, duplicate: true };
    }
    throw e;
  }
}

type OrderRecordInput = {
  organizationId: string;
  locationId: string;
  number: number;
  channel: OrderChannel;
  tableId?: string | null;
  tableSessionId?: string | null;
  language: LanguageCode;
  customerName?: string | null;
  customerPhone?: string | null;
  customerNotes?: string | null;
  pickupAt?: Date | null;
  idempotencyKey: string;
  trackingToken: string;
  quote: Awaited<ReturnType<typeof quoteCart>>;
  discountCents?: number;
  deliveryFeeCents?: number;
};

/** Shared by table, takeaway and delivery submission. Writes immutable snapshots. */
export async function createOrderRecord(tx: Tx, o: OrderRecordInput) {
  const discount = o.discountCents ?? 0;
  const fee = o.deliveryFeeCents ?? 0;
  const total = o.quote.subtotalCents - discount + fee;
  if (discount < 0 || fee < 0 || total < 0) throw new Error('Invalid totals');
  return tx.order.create({
    data: {
      organizationId: o.organizationId,
      locationId: o.locationId,
      number: o.number,
      channel: o.channel,
      status: 'NEW',
      paymentStatus: 'UNPAID',
      tableId: o.tableId ?? null,
      tableSessionId: o.tableSessionId ?? null,
      language: o.language,
      customerName: o.customerName ?? null,
      customerPhone: o.customerPhone ?? null,
      customerNotes: o.customerNotes ?? null,
      pickupAt: o.pickupAt ?? null,
      subtotalCents: o.quote.subtotalCents,
      discountCents: discount,
      deliveryFeeCents: fee,
      totalCents: total,
      idempotencyKey: o.idempotencyKey,
      trackingTokenHash: hashToken(o.trackingToken),
      items: {
        create: o.quote.lines.map((l) => ({
          organizationId: o.organizationId,
          productId: l.productId,
          variantId: l.variantId,
          stationId: l.stationId,
          nameSnapshot: l.nameSnapshot,
          customerNameSnapshot: l.customerNameSnapshot,
          variantNameSnapshot: l.variantNameSnapshot,
          unitPriceCents: l.unitPriceCents,
          modifiersUnitCents: l.modifiersUnitCents,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
          notes: l.notes,
          modifiers: { create: l.modifiers.map((m) => ({ optionId: m.optionId, groupNameSnapshot: m.groupNameSnapshot, nameSnapshot: m.nameSnapshot, priceDeltaCents: m.priceDeltaCents, quantity: m.quantity })) },
        })),
      },
      events: { create: { toStatus: 'NEW', actorType: 'CUSTOMER' } },
    },
  });
}

// ------------------------------------------------------------------ staff: status changes

export const statusChangeSchema = z.object({
  orderId: z.string().min(1),
  to: z.enum(['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED']),
  expectedFrom: z.enum(['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED']),
  reason: z.string().trim().max(300).optional(),
});

export class StatusConflictError extends UserFacingError {
  constructor(public current: OrderStatus) {
    super('status_conflict', 409, { current });
  }
}

/**
 * Changes an order status with an explicit state machine and optimistic concurrency:
 * the update only succeeds if the order is still in `expectedFrom`. Duplicate taps or
 * a reconnecting tablet replaying the same request cannot apply a change twice.
 */
export async function changeOrderStatus(ctx: TenantContext, input: unknown) {
  const d = statusChangeSchema.parse(input);
  const order = await db.order.findFirst({ where: { id: d.orderId, organizationId: ctx.org.id }, include: { tickets: true } });
  if (!order) throw new UserFacingError('Order not found.', 404);
  await assertLocationAccess(ctx, order.locationId);
  if (order.status !== d.expectedFrom) throw new StatusConflictError(order.status);
  if (!canTransition(order.channel, order.status, d.to)) throw new UserFacingError(`Cannot change an order from ${order.status} to ${d.to}.`);
  if (d.to === 'CANCELLED' && !d.reason) throw new UserFacingError('Please give a reason for cancelling.');
  if (d.to === 'READY' && order.tickets.some((t) => t.status !== 'READY' && t.status !== 'CANCELLED')) {
    throw new UserFacingError('Some stations are still preparing items for this order.');
  }

  await db.$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.order.updateMany({
      where: { id: order.id, status: d.expectedFrom },
      data: {
        status: d.to,
        acknowledgedAt: order.acknowledgedAt ?? now,
        ...(d.to === 'ACCEPTED' ? { acceptedAt: now } : {}),
        ...(d.to === 'READY' ? { readyAt: now } : {}),
        ...(d.to === 'COMPLETED' ? { completedAt: now } : {}),
        ...(d.to === 'CANCELLED' ? { cancelledAt: now, cancelReason: d.reason } : {}),
      },
    });
    if (res.count !== 1) {
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
      throw new StatusConflictError(current.status);
    }
    await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: d.to, actorType: 'STAFF', actorUserId: ctx.userId, note: d.reason ?? null } });

    if (d.to === 'ACCEPTED') await createKitchenTickets(tx, order.id, order.organizationId);
    if (d.to === 'CANCELLED') {
      await tx.kitchenTicket.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
      await tx.orderItem.updateMany({ where: { orderId: order.id, voidedAt: null }, data: { prepStatus: 'CANCELLED' } });
    }
    if (d.to === 'OUT_FOR_DELIVERY') await tx.deliveryOrderDetails.updateMany({ where: { orderId: order.id }, data: { outForDeliveryAt: now } });
    if (d.to === 'DELIVERED') await tx.deliveryOrderDetails.updateMany({ where: { orderId: order.id }, data: { deliveredAt: now } });
    if (d.to === 'COMPLETED' || d.to === 'DELIVERED') {
      await tx.orderItem.updateMany({ where: { orderId: order.id, prepStatus: 'READY' }, data: { prepStatus: 'SERVED' } });
      await syncLoyaltyForOrder(tx, order.id);
    }
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'order.status_changed', entityType: 'Order', entityId: order.id, metadata: { from: order.status, to: d.to, reason: d.reason ?? null } }, tx);
  });
}

/** One ticket per station that has items in the order. Items without a station need no ticket. */
async function createKitchenTickets(tx: Tx, orderId: string, organizationId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId, voidedAt: null, stationId: { not: null } }, select: { stationId: true } });
  const stationIds = [...new Set(items.map((i) => i.stationId!))];
  for (const stationId of stationIds) {
    await tx.kitchenTicket.upsert({ where: { orderId_stationId: { orderId, stationId } }, update: {}, create: { orderId, stationId, organizationId } });
  }
}

export async function acknowledgeOrder(ctx: TenantContext, orderId: string) {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: ctx.org.id } });
  if (!order) throw new UserFacingError('Order not found.', 404);
  await assertLocationAccess(ctx, order.locationId);
  await db.order.updateMany({ where: { id: order.id, acknowledgedAt: null }, data: { acknowledgedAt: new Date() } });
}

// ------------------------------------------------------------------ kitchen display

export const ticketChangeSchema = z.object({
  ticketId: z.string().min(1),
  to: z.enum(['PREPARING', 'READY', 'PENDING']),
  expectedFrom: z.enum(['PENDING', 'PREPARING', 'READY']),
});

/**
 * A station moves its own ticket PENDING → PREPARING → READY (or back one step). The order
 * becomes PREPARING when any station starts, and READY only when every station is ready.
 */
export async function changeTicketStatus(ctx: TenantContext, input: unknown) {
  const d = ticketChangeSchema.parse(input);
  const ticket = await db.kitchenTicket.findFirst({ where: { id: d.ticketId, organizationId: ctx.org.id }, include: { order: true, station: true } });
  if (!ticket) throw new UserFacingError('Ticket not found.', 404);
  await assertLocationAccess(ctx, ticket.station.locationId);
  const allowed: Record<string, PrepStatus[]> = { PENDING: ['PREPARING', 'READY'], PREPARING: ['READY', 'PENDING'], READY: ['PREPARING'] };
  if (ticket.status !== d.expectedFrom) throw new UserFacingError('status_conflict', 409, { current: ticket.status });
  if (!allowed[ticket.status]?.includes(d.to)) throw new UserFacingError('Invalid ticket change.');
  if (!['ACCEPTED', 'PREPARING', 'READY'].includes(ticket.order.status)) throw new UserFacingError('This order is no longer being prepared.');

  await db.$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.kitchenTicket.updateMany({
      where: { id: ticket.id, status: d.expectedFrom },
      data: { status: d.to, ...(d.to === 'PREPARING' ? { startedAt: ticket.startedAt ?? now } : {}), ...(d.to === 'READY' ? { readyAt: now } : { readyAt: null }) },
    });
    if (res.count !== 1) throw new UserFacingError('status_conflict', 409);
    await tx.orderItem.updateMany({ where: { orderId: ticket.orderId, stationId: ticket.stationId, voidedAt: null, prepStatus: { notIn: ['CANCELLED', 'SERVED'] } }, data: { prepStatus: d.to } });
    await syncOrderReadiness(tx, ticket.orderId, ctx.userId);
  });
}

/** Derives order status from station tickets (SYSTEM events, optimistic updates). */
async function syncOrderReadiness(tx: Tx, orderId: string, actorUserId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: true } });
  const live = order.tickets.filter((t) => t.status !== 'CANCELLED');
  if (live.length === 0) return;
  const allReady = live.every((t) => t.status === 'READY');
  const anyStarted = live.some((t) => t.status === 'PREPARING' || t.status === 'READY');
  let to: OrderStatus | null = null;
  if (allReady && (order.status === 'ACCEPTED' || order.status === 'PREPARING')) to = 'READY';
  else if (!allReady && order.status === 'READY') to = 'PREPARING'; // a station re-opened its ticket
  else if (anyStarted && order.status === 'ACCEPTED') to = 'PREPARING';
  if (!to) return;
  const res = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: to, ...(to === 'READY' ? { readyAt: new Date() } : {}) } });
  if (res.count === 1) await tx.orderStatusEvent.create({ data: { orderId, fromStatus: order.status, toStatus: to, actorType: 'SYSTEM', actorUserId, note: 'Derived from kitchen stations' } });
}

// ------------------------------------------------------------------ queries

const orderInclude = {
  items: { include: { modifiers: true, station: { select: { id: true, name: true, type: true } } }, orderBy: { createdAt: 'asc' } },
  table: { select: { label: true, area: { select: { name: true } } } },
  tickets: { include: { station: { select: { name: true } } } },
  delivery: true,
} satisfies Prisma.OrderInclude;

export type LiveOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Active orders + today's completed/cancelled for the live dashboard (tenant- and location-scoped). */
export async function liveOrders(ctx: TenantContext, locationId: string, since: Date) {
  await assertLocationAccess(ctx, locationId);
  const [active, closed] = await Promise.all([
    db.order.findMany({ where: { organizationId: ctx.org.id, locationId, status: { in: ACTIVE_STATUSES } }, include: orderInclude, orderBy: { createdAt: 'asc' } }),
    db.order.findMany({ where: { organizationId: ctx.org.id, locationId, status: { in: ['COMPLETED', 'CANCELLED'] }, updatedAt: { gte: since } }, include: orderInclude, orderBy: { updatedAt: 'desc' }, take: 30 }),
  ]);
  return [...active, ...closed];
}

/** Staff flag an order as priority (e.g. a guest in a hurry); kitchen displays show it first. */
export async function setOrderPriority(ctx: TenantContext, orderId: string, isPriority: boolean) {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: ctx.org.id } });
  if (!order) throw new UserFacingError('Order not found.', 404);
  await assertLocationAccess(ctx, order.locationId);
  await db.order.update({ where: { id: order.id }, data: { isPriority } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'order.priority_changed', entityType: 'Order', entityId: order.id, metadata: { isPriority } });
}
/** Tickets for one station's display. */
export async function stationTickets(ctx: TenantContext, stationId: string) {
  await assertModule(ctx.org.id, 'kds');
  const station = await db.kitchenStation.findFirst({ where: { id: stationId, organizationId: ctx.org.id } });
  if (!station) throw new UserFacingError('Station not found.', 404);
  await assertLocationAccess(ctx, station.locationId);
  const tickets = await db.kitchenTicket.findMany({
    where: { stationId, OR: [{ status: { in: ['PENDING', 'PREPARING'] } }, { status: 'READY', readyAt: { gte: new Date(Date.now() - 20 * 60_000) } }], order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY'] } } },
    orderBy: { createdAt: 'asc' },
    include: {
      order: {
        select: {
          id: true,
          number: true,
          channel: true,
          customerNotes: true,
          customerName: true,
          createdAt: true,
          acceptedAt: true,
          pickupAt: true,
          isPriority: true,
          table: { select: { label: true } },
          items: { where: { stationId, voidedAt: null }, include: { modifiers: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  // Priority orders first, otherwise oldest first.
  tickets.sort((a, b) => Number(b.order.isPriority) - Number(a.order.isPriority));
  return { station, tickets };
}

/** Public tracking view: minimal data, looked up by token hash. No phone/address returned. */
export async function trackOrder(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const order = await db.order.findUnique({
    where: { trackingTokenHash: hashToken(token) },
    select: {
      number: true,
      channel: true,
      status: true,
      language: true,
      createdAt: true,
      subtotalCents: true,
      discountCents: true,
      deliveryFeeCents: true,
      totalCents: true,
      currency: true,
      pickupAt: true,
      cancelReason: true,
      table: { select: { label: true, qrTokens: { where: { isActive: true }, select: { token: true }, take: 1 } } },
      location: { select: { name: true, slug: true, timeZone: true, takeawaySettings: { select: { pickupPoint: true } }, organization: { select: { name: true, slug: true } } } },
      items: { where: { voidedAt: null }, select: { customerNameSnapshot: true, nameSnapshot: true, variantNameSnapshot: true, quantity: true, lineTotalCents: true, modifiers: { select: { nameSnapshot: true, quantity: true } } } },
      events: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  return order;
}
