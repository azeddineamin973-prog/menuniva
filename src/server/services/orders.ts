import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LanguageCode, OrderChannel, OrderStatus, PrepStatus } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { LANGUAGES } from '@/i18n/config';
import { canTransition, ACTIVE_STATUSES } from '@/lib/order-state';
import { resolveThresholds } from '@/lib/attention';
import { audit, logError } from '../audit';
import { hashToken } from '../crypto';
import { db, type Tx } from '../db';
import { assertModule, orgModules } from '../modules';
import { env } from '../env';
import { UserFacingError } from '../errors';
import { asIdentity, type ClientIdentity } from '../client-identity';
import { assertBelowLimit, countSuccess, limitPublic } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { cartSchema, quoteCart, type QuoteIssue } from './pricing';
import { orderingState } from './public-menu';
import { computeDiscounts, consumeUsage, loadRules } from './promotions';
import { syncLoyaltyForOrder } from './loyalty';
import { findGrant } from './table-access';

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
  // Accepted and ignored: older pages sent the table code with every order. It is now entered once
  // per phone (POST /api/public/table-session/join) and never authorises an order by itself.
  tableCode: z.string().trim().max(8).optional(),
  couponCode: z.string().trim().max(30).optional(),
});

export type SubmittedOrder = { orderNumber: number; trackingToken: string; status: OrderStatus; duplicate: boolean };

/** Resolves an active table QR token → table + location + organization (public). */
export async function resolveTableToken(token: string) {
  // Read from the table side: the token is a filter of the first query (unique index) instead of a
  // query of its own, one round trip fewer on every guest request (final QA).
  return db.restaurantTable.findFirst({
    where: { isActive: true, qrTokens: { some: { token, isActive: true } } },
    include: { location: { include: { organization: true } }, area: true },
  });
}

/**
 * Submits a table order. Guarantees:
 * - prices/availability recomputed server-side from the database at submission (client prices ignored),
 * - idempotent per (location, idempotencyKey): retries return the original order,
 * - order + items + status event are written in one transaction before success is reported,
 * - throttled per guest (cookie), per trusted client IP, per table and per location — see
 *   `limitPublic`; guests sharing a Wi-Fi are never limited as one client (audit BUG-05).
 *
 * Concurrency (P2028, audit A1): the transaction holds only the writes. It takes a SHARED lock on
 * the table's open session, so the guests of one table no longer queue behind each other; closing
 * or moving the table takes the exclusive lock on the same row and waits for orders in flight.
 * Reads (quote, promotions), session creation and the order number happen before it.
 */
export const TABLE_ORDER_LIMITS = { guest: [10, 600], ip: [150, 600], table: [40, 3600], location: [400, 600] } as const;

/**
 * Interactive-transaction limits of the table-order path, stated instead of defaulted. `maxWait`
 * equals the pool's connection wait (db-config.ts): starting a transaction waits for a connection as
 * long as any other query does. `timeout` stays at Prisma's 5 s default: the transaction is now a
 * handful of writes, so it is not raised.
 */
export const ORDER_TX = { maxWait: 10_000, timeout: 5_000 } as const;

/** A transaction that could not start or ran out of time (Prisma P2028): nothing was written. */
export const isTransactionBusy = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028';

/**
 * The table's open session. When `allowCreate` (guests may open a table themselves), a missing session
 * is created in a short transaction of its own under the table row lock — one OPEN session per table
 * (audit BUG-03) — so no order ever holds that exclusive lock while it is written.
 */
export async function openSessionFor(table: { id: string; organizationId: string; locationId: string }, allowCreate: boolean): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const open = await db.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' }, select: { id: true } });
    if (open || !allowCreate) return open?.id ?? null;
    // SKIP LOCKED: a transaction here never waits for a lock. When many first orders of a table arrive
    // together, one creates the session and the others re-read it shortly after, outside any transaction.
    // Before (A2, +80 ms): they queued inside their transactions and ran past the 5 s limit.
    const created = await db.$transaction(async (tx) => {
      const got = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "RestaurantTable" WHERE id = ${table.id} FOR NO KEY UPDATE SKIP LOCKED`;
      if (!got.length) return undefined; // staff or another guest are opening this table right now
      const again = await tx.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' }, select: { id: true } });
      if (again) return again.id;
      const s = await tx.tableSession.create({ data: { organizationId: table.organizationId, locationId: table.locationId, tableId: table.id }, select: { id: true } });
      return s.id;
    }, ORDER_TX);
    if (created) return created;
    if (attempt >= 40) throw new BusyError();
    await new Promise((r) => setTimeout(r, Math.min(25 + attempt * 15, 200)));
  }
}

/** The database could not complete the work in time; nothing was written. Safe to send again (503). */
export class BusyError extends UserFacingError {
  constructor() {
    super('busy_retry', 503);
  }
}

/**
 * One statement: shared row lock on a session that must still be OPEN at this table and, when the
 * phone's authorisation is given, that authorisation must still be valid for it (not revoked, not
 * expired). Held until the order commits. Many orders share it; `closeTableSession` and
 * `transferSession` take NO KEY UPDATE on the same row, so a close either waits for the order (and
 * then sees it) or wins, and the order finds no open session.
 */
export async function shareOpenSession(tx: Tx, sessionId: string, tableId: string, deviceId: string | null = null, claimId: string | null = null): Promise<boolean> {
  // The same statement gives back the order's place in the pending cap (claimPendingSlot): the delete
  // becomes visible at commit together with the order, so other phones never see both or neither.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH released AS (DELETE FROM "TablePendingClaim" WHERE id = ${claimId}::text)
    SELECT s.id FROM "TableSession" s
     WHERE s.id = ${sessionId} AND s."tableId" = ${tableId} AND s.status = 'OPEN'
       AND (${deviceId}::text IS NULL OR EXISTS (
             SELECT 1 FROM "TableSessionDevice" d
              WHERE d.id = ${deviceId} AND d."tableSessionId" = s.id AND d."revokedAt" IS NULL AND d."expiresAt" > now()))
       FOR SHARE OF s`;
  return rows.length === 1;
}

/**
 * Claims one place in the seating's pending-order cap (orders waiting for staff approval; fake-order
 * floods, V8). Exact under concurrency: the database function counts NEW orders plus places held by
 * orders still being written, under a per-seating lock held for this one statement only (migration
 * 20261103210000). false = the cap is reached. The order transaction releases the place
 * (shareOpenSession); a request that fails before it calls releasePendingSlot, and a claim left by
 * a crashed process stops counting after 60 s.
 */
export async function claimPendingSlot(sessionId: string, cap: number, claimId: string): Promise<boolean> {
  const [row] = await db.$queryRaw<{ ok: boolean }[]>`SELECT claim_table_pending_slot(${sessionId}, ${cap}::int, ${claimId}) AS ok`;
  return row?.ok === true;
}
export async function releasePendingSlot(claimId: string) {
  await db.$executeRaw`DELETE FROM "TablePendingClaim" WHERE id = ${claimId}`;
}

/**
 * Exclusive lock on a session row (staff close / move a table). Pairs with `shareOpenSession`: FOR SHARE
 * and NO KEY UPDATE exclude each other, while foreign-key checks (KEY SHARE) of inserts pass.
 */
export async function lockSession(tx: Tx, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM "TableSession" WHERE id = ${sessionId} FOR NO KEY UPDATE`;
}

/**
 * Next order number of a location, as one statement: the location row is locked only while this
 * UPDATE runs, not until the order commits (it serialised every table of a location, audit A1). A
 * failure after this point (table closed or a promotion limit reached at that very moment, or a
 * database error) leaves a gap in the numbers; numbers are for reading out, not fiscal documents.
 */
export async function nextOrderNumber(locationId: string): Promise<number> {
  const { orderSequence } = await db.restaurantLocation.update({ where: { id: locationId }, data: { orderSequence: { increment: 1 } }, select: { orderSequence: true } });
  return orderSequence;
}

export async function submitTableOrder(
  input: unknown,
  client: string | ClientIdentity,
  access: {
    grantTokens?: string[];
    /**
     * Runs bookkeeping that the guest's answer does not depend on (the shared rate-limit success counts,
     * the phone's "last used" time) after the response, e.g. Next.js `after()`: one database round
     * trip less before the guest sees the confirmation. Without it, the work is awaited here.
     */
    afterResponse?: (work: () => Promise<unknown>) => void;
  } = {},
): Promise<SubmittedOrder> {
  const who = asIdentity(client);
  const data = submitTableOrderSchema.parse(input);
  const table = await resolveTableToken(data.qrToken);
  if (!table) throw new OrderRejectedError('qr_invalid');
  const location = table.location;
  const state = orderingState(location, location.organization.status, 'TABLE');
  if (!state.canOrder) throw new OrderRejectedError(`ordering_${state.reason}`);

  // Every database round trip on this path adds its full latency to each guest's wait, and the reads
  // of all simultaneous guests share one connection pool (audit A1/A2; final QA: 31 sequential round
  // trips per order at +80 ms). So reads that only need the table run side by side, in one round trip:
  // modules, the idempotency check and the table's open session.
  const trackingToken = trackingTokenFor(location.id, data.idempotencyKey);
  const L = TABLE_ORDER_LIMITS;
  const policy = location.tableOrderingPolicy;
  const guestsMayOpen = policy === 'OPEN';
  const quiet = <T>(p: Promise<T>) => (p.catch(() => undefined), p); // awaited below; no unhandled rejection meanwhile
  const sessionRead = quiet(openSessionFor(table, false));
  // The organisation's modules are read once: table ordering here, promotions for the discounts.
  const [modules, existing] = await Promise.all([
    orgModules(location.organizationId, undefined, db),
    db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: data.idempotencyKey } } }),
  ]);
  if (!modules.has('table_ordering')) throw new OrderRejectedError('module_not_available');
  // A retry of an order that already exists returns it before any other check: the phone that lost
  // its connection must get its order back even if staff closed the table meanwhile (design T15).
  if (existing) return { orderNumber: existing.number, trackingToken, status: existing.status, duplicate: true };
  // Only now the rate limits, so a retry never uses up the phone's allowance, and before the pricing
  // reads, so a refused flood stays cheap. Location and table caps count only orders that were placed
  // (see assertBelowLimit).
  const [countForLocation] = await Promise.all([
    limitPublic(`order:${location.id}`, who, { guest: [...L.guest], ip: [...L.ip], cookieless: [20, 600], scope: { key: 'location', limit: [...L.location] } }),
    assertBelowLimit(`order:table:${table.id}`, ...L.table),
  ]);
  const countPlaced = () => Promise.all([countForLocation(), countSuccess(`order:table:${table.id}`, ...L.table)]);

  // Who may order here (QR-ORDERING-DESIGN.md §3.1). OPEN: anyone with the QR, MenuNiva opens the
  // table itself. SESSION: staff must have opened it. SESSION_PIN: and this phone must have entered the
  // seating's PIN (a server-checked grant bound to this organisation, location, table and session).
  // Checked alongside the price quote; a refusal here wins over any quote issue.
  const authorise = async () => {
    let session: string | null;
    let device: { id: string } | null = null;
    if (policy === 'SESSION_PIN') {
      const g = await findGrant(table, sessionRead, access.grantTokens ?? []);
      session = g.sessionId;
      if (!session) throw new OrderRejectedError(g.ended ? 'session_ended' : 'table_not_open');
      if (!g.device) throw new OrderRejectedError(g.ended ? 'session_ended' : 'pin_required');
      device = g.device;
    } else session = await sessionRead;
    if (!session && !guestsMayOpen) throw new OrderRejectedError('table_not_open');
    return { session, deviceId: device?.id ?? null };
  };
  // Prices, availability and promotions, read before the transaction (no lock is held while they
  // load), with the location already in hand and the promotions alongside the quote. Promotion usage
  // limits are still enforced atomically inside the transaction (consumeUsage).
  const pricing = async () => {
    const promotionsEnabled = modules.has('promotions');
    const preloaded = promotionsEnabled ? quiet(loadRules(db, { organizationId: location.organizationId, locationId: location.id, channel: 'TABLE', couponCode: data.couponCode })) : undefined;
    const quote = await quoteCart({ locationId: location.id, channel: 'TABLE', lang: data.language, items: data.items, location });
    if (quote.issues.length) throw new OrderRejectedError('items_unavailable', quote.issues);
    const promo = await computeDiscounts(db, { organizationId: location.organizationId, locationId: location.id, channel: 'TABLE', couponCode: data.couponCode, lines: quote.lines, subtotalCents: quote.subtotalCents, promotionsEnabled, preloaded });
    if (data.couponCode && promo.couponStatus === 'invalid') throw new OrderRejectedError('coupon_invalid');
    return { quote, promo };
  };
  const [auth, priced] = await Promise.allSettled([authorise(), pricing()]);
  if (auth.status === 'rejected') throw auth.reason;
  const knownSession = auth.value.session;
  const deviceId = auth.value.deviceId;

  // This order's place in the seating's pending cap (claimPendingSlot): taken once per seating, given
  // back by the order transaction, or below if no order is placed.
  let held: { id: string; sessionId: string } | null = null;
  const claimFor = async (sessionId: string) => {
    if (held?.sessionId === sessionId) return true;
    if (held) await releasePendingSlot(held.id); // that seating closed meanwhile; this order moves to the next one
    const id = randomUUID();
    held = (await claimPendingSlot(sessionId, location.tablePendingOrderCap, id)) ? { id, sessionId } : null;
    return !!held;
  };
  let committed = false;
  try {
    if (priced.status === 'rejected') throw priced.reason;
    const { quote, promo } = priced.value;

    const place = async (fresh = false): Promise<SubmittedOrder | null> => {
      // Secure policies order only on the session that was checked above, never on a newer one. Open
      // ordering reuses it too, and looks again (or opens the table) only when there was none or it
      // has just been closed. The pending-cap place and the number are taken alongside (a gap in the
      // numbers only if this order then fails or the cap is reached).
      const session = guestsMayOpen && (fresh || !knownSession) ? openSessionFor(table, true) : Promise.resolve(knownSession);
      const [sessionId, number, claimed] = await Promise.all([session, nextOrderNumber(location.id), session.then((s) => (s ? claimFor(s) : false))]);
      if (!sessionId) throw new OrderRejectedError('table_not_open');
      if (!claimed) throw new OrderRejectedError('too_many_pending');
      const claimId = held!.id;
      const started = Date.now();
      return db.$transaction(async (tx) => {
        // Closed or moved since it was read, or the phone's authorisation was revoked or expired
        // meanwhile: this order must not land on that bill. The same statement gives back the
        // order's pending-cap place, which the order itself takes over at commit.
        if (!(await shareOpenSession(tx, sessionId, table.id, deviceId, claimId))) return null;
        const order = await createOrderRecord(tx, {
          tableSessionDeviceId: deviceId,
          discountCents: promo.totalCents,
          organizationId: location.organizationId,
          locationId: location.id,
          number,
          channel: 'TABLE',
          tableId: table.id,
          tableSessionId: sessionId,
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
      }, ORDER_TX).catch((e) => {
        // The time limit ran out while Prisma was still writing (seen with the host stalled for
        // seconds): it rolls back, and the write fails on a foreign key or returns no row. Nothing was
        // committed, so this is "busy, send again" (503), not a crash. The idempotency key still allows
        // at most one order.
        if (!(e instanceof OrderRejectedError) && Date.now() - started >= ORDER_TX.timeout - 100) throw new BusyError();
        throw e;
      });
    };
    // One retry, and only where it is safe: the table was closed between the read and the lock (guests
    // who may open a table start the next session, as before), or the transaction could not start in
    // time (P2028: nothing was written). The idempotency key still allows at most one order.
    let placed: SubmittedOrder | null;
    try {
      placed = await place();
    } catch (e) {
      if (!isTransactionBusy(e) && !(e instanceof BusyError)) throw e;
      await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 150)));
      placed = await place();
    }
    if (!placed && guestsMayOpen) placed = await place(true);
    if (!placed) throw new OrderRejectedError(policy === 'SESSION_PIN' ? 'session_ended' : 'table_not_open');
    committed = true;
    // The order exists: a failure to count it must not turn the guest's success into an error.
    const bookkeeping = () =>
      Promise.all([
        countPlaced().catch((e) => logError('rate-limit-count', e)),
        deviceId ? db.tableSessionDevice.update({ where: { id: deviceId }, data: { lastUsedAt: new Date() } }).catch((e) => logError('table-device-touch', e)) : null,
      ]);
    if (access.afterResponse) access.afterResponse(bookkeeping);
    else await bookkeeping();
    return placed;
  } catch (e) {
    // Two identical submissions raced: the unique (locationId, idempotencyKey) index wins.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await db.order.findUnique({ where: { locationId_idempotencyKey: { locationId: location.id, idempotencyKey: data.idempotencyKey } } });
      if (again) return { orderNumber: again.number, trackingToken, status: again.status, duplicate: true };
    }
    throw e;
  } finally {
    // No order was written (refused, rolled back, duplicate): give the place back now rather than after
    // the 60 s expiry. Deleting a place the transaction already gave back is a no-op.
    const h = held as { id: string } | null;
    if (h && !committed) await releasePendingSlot(h.id).catch((e) => logError('table-pending-release', e));
  }
}

/**
 * Row lock on a table for the rest of the transaction (one OPEN session per table): opening, guest
 * session creation, closing and moving a table queue behind each other. NO KEY UPDATE, not UPDATE:
 * it must not block the foreign-key check (FOR KEY SHARE) that every order, device or task insert
 * makes on this row. With FOR UPDATE, each order insert waited for every guest's session-creation
 * lock queued ahead of it, which pushed write transactions past Prisma's 5 s limit (A2, +80 ms).
 */
export async function lockTable(tx: Tx, tableId: string) {
  await tx.$queryRaw`SELECT id FROM "RestaurantTable" WHERE id = ${tableId} FOR NO KEY UPDATE`;
}

/**
 * Row lock on an order for the rest of the transaction, taken before its kitchen tickets are
 * read or changed, so order readiness is always derived from the other stations' committed
 * tickets (audit OPS-07). NO KEY UPDATE is the lock a status UPDATE takes anyway: it queues
 * behind other status/ticket changes of the same order, not behind rows that only reference it.
 */
async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR NO KEY UPDATE`;
}

type OrderRecordInput = {
  organizationId: string;
  locationId: string;
  number: number;
  channel: OrderChannel;
  tableId?: string | null;
  tableSessionId?: string | null;
  tableSessionDeviceId?: string | null;
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
      tableSessionDeviceId: o.tableSessionDeviceId ?? null,
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
          // Nothing to prepare (packaged drink): ready from the start, handed over at the counter.
          prepStatus: l.prep === 'none' ? 'READY' : 'PENDING',
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
 * `within` runs in the same transaction after the change (e.g. the driver's cash for DELIVERED),
 * so both are saved together or not at all.
 */
export async function changeOrderStatus(ctx: TenantContext, input: unknown, within?: (tx: Tx) => Promise<void>) {
  const d = statusChangeSchema.parse(input);
  const order = await db.order.findFirst({ where: { id: d.orderId, organizationId: ctx.org.id } });
  if (!order) throw new UserFacingError('Order not found.', 404);
  await assertLocationAccess(ctx, order.locationId);
  if (order.status !== d.expectedFrom) throw new StatusConflictError(order.status);
  if (!canTransition(order.channel, order.status, d.to)) throw new UserFacingError(`Cannot change an order from ${order.status} to ${d.to}.`);
  if (d.to === 'CANCELLED' && !d.reason) throw new UserFacingError('Please give a reason for cancelling.');
  // A table order is approved only for a seating that is still open: an approval from a stale screen
  // must not send food to the kitchen for guests who already left (rejecting it stays possible).
  if (d.to === 'ACCEPTED' && order.channel === 'TABLE' && order.tableSessionId) {
    const s = await db.tableSession.findUnique({ where: { id: order.tableSessionId }, select: { status: true } });
    if (s?.status !== 'OPEN') throw new UserFacingError('This table has been closed. Reject this order instead.');
  }

  await db.$transaction(async (tx) => {
    if (d.to === 'READY' || d.to === 'CANCELLED') await lockOrder(tx, order.id);
    if (d.to === 'READY') {
      // Checked under the order lock: a station undoing its "ready" at the same moment either
      // happens first (refused here) or after (the order goes back to PREPARING) (OPS-07).
      const open = await tx.kitchenTicket.count({ where: { orderId: order.id, status: { notIn: ['READY', 'CANCELLED'] } } });
      if (open > 0) throw new UserFacingError('Some stations are still preparing items for this order.');
    }
    if (d.to === 'CANCELLED') {
      // A cancelled order leaves the bill, and its recorded payment with it: the money must be
      // given back (payment voided) first, so the till and MenuNiva keep the same figures.
      // Checked under the order lock that recordPayment also takes: a payment recorded at the same
      // moment is either seen here (cancel refused) or refused itself (order already cancelled).
      if (await tx.paymentRecord.count({ where: { orderId: order.id, status: 'RECORDED' } })) throw new UserFacingError('This order has a recorded payment. Void the payment first, then cancel the order.');
    }
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

    if (d.to === 'ACCEPTED') await createKitchenTickets(tx, order.id, order.organizationId, order.locationId);
    // Counter items (no station) are the front of house's own: marking the order ready by hand
    // confirms them. Station tickets were checked above and must all be ready already.
    if (d.to === 'READY') await tx.orderItem.updateMany({ where: { orderId: order.id, voidedAt: null, stationId: null, prepStatus: { in: ['PENDING', 'PREPARING'] } }, data: { prepStatus: 'READY' } });
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
    if (within) await within(tx);
  });
}

/**
 * One ticket per station that has items in the order. Items without a station (counter items)
 * need no ticket. Every station must still be switched on and belong to the order's location:
 * a ticket on a switched-off screen, or on another location's kitchen, is never seen by the
 * cooks who make the food (audit OPS-09). The shared row lock keeps a station from being
 * switched off between this check and the ticket (`saveStation` locks it to switch it off).
 */
async function createKitchenTickets(tx: Tx, orderId: string, organizationId: string, locationId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId, voidedAt: null, stationId: { not: null } }, select: { stationId: true, quantity: true, nameSnapshot: true } });
  const stationIds = [...new Set(items.map((i) => i.stationId!))];
  if (stationIds.length === 0) return;
  const stations = await tx.$queryRaw<{ id: string; name: string; locationId: string; isActive: boolean }[]>`
    SELECT id, name, "locationId", "isActive" FROM "KitchenStation" WHERE id = ANY(${stationIds}) FOR SHARE`;
  const what = (stationId: string) => items.filter((i) => i.stationId === stationId).map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(', ');
  const elsewhere = stations.find((s) => s.locationId !== locationId);
  if (elsewhere) throw new UserFacingError(`${elsewhere.name} belongs to another location, so this location's kitchen would not see ${what(elsewhere.id)}. Cancel this order and ask the guest to order again.`);
  const off = stations.find((s) => !s.isActive);
  if (off) throw new UserFacingError(`${off.name} is switched off, so nobody would see ${what(off.id)}. Switch it back on (Kitchen stations) before accepting, or cancel this order.`);
  for (const stationId of stationIds) {
    await tx.kitchenTicket.upsert({ where: { orderId_stationId: { orderId, stationId } }, update: {}, create: { orderId, stationId, organizationId } });
  }
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
  const found = await db.kitchenTicket.findFirst({ where: { id: d.ticketId, organizationId: ctx.org.id }, include: { station: true } });
  if (!found) throw new UserFacingError('Ticket not found.', 404);
  await assertLocationAccess(ctx, found.station.locationId);
  const allowed: Record<string, PrepStatus[]> = { PENDING: ['PREPARING', 'READY'], PREPARING: ['READY', 'PENDING'], READY: ['PREPARING'] };

  await db.$transaction(async (tx) => {
    // Kitchen and Café pressing "Ready" at the same moment (audit OPS-07): each transaction read
    // the other station's ticket before it committed, so the order stayed PREPARING with every
    // ticket READY. Under the order lock, the checks below and the derived readiness see every
    // other station's committed ticket, and a cancel cannot slip in between. Same lock order as
    // changeOrderStatus and changeOrderItem (order, then tickets): no deadlock with a cancel.
    await lockOrder(tx, found.orderId);
    const ticket = await tx.kitchenTicket.findUnique({ where: { id: found.id }, include: { order: { select: { status: true } } } });
    if (!ticket) throw new UserFacingError('Ticket not found.', 404);
    if (ticket.status !== d.expectedFrom) throw new UserFacingError('status_conflict', 409, { current: ticket.status });
    if (!allowed[ticket.status]?.includes(d.to)) throw new UserFacingError('Invalid ticket change.');
    if (!['ACCEPTED', 'PREPARING', 'READY'].includes(ticket.order.status)) throw new UserFacingError('This order is no longer being prepared.');
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

/**
 * Derives order status from station tickets (SYSTEM events). Caller holds the order lock (lockOrder).
 * A counter item still waiting (no station, not prepared) keeps the order from turning READY on
 * its own when the kitchen finishes (audit OPS-08): front of house confirms it by marking the
 * order ready. Items that need no preparation are ready from the start and never hold it back.
 */
export async function syncOrderReadiness(tx: Tx, orderId: string, actorUserId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { tickets: true, items: { where: { voidedAt: null, stationId: null, prepStatus: { in: ['PENDING', 'PREPARING'] } }, select: { id: true } } },
  });
  const live = order.tickets.filter((t) => t.status !== 'CANCELLED');
  if (live.length === 0) return;
  const allReady = live.every((t) => t.status === 'READY') && order.items.length === 0;
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
  // Provenance for the approving waiter: which seating, and whether a PIN-authorised phone sent it.
  tableSession: { select: { openedAt: true, status: true } },
  tableSessionDevice: { select: { enrolledAt: true } },
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
/**
 * Tickets for one station's display. Items staff removed or reduced after the station got the
 * ticket stay on it, marked, so a cook never loses track of a change; a ticket whose last item
 * was removed stays for 15 minutes as cancelled.
 */
export async function stationTickets(ctx: TenantContext, stationId: string) {
  await assertModule(ctx.org.id, 'kds');
  const station = await db.kitchenStation.findFirst({ where: { id: stationId, organizationId: ctx.org.id } });
  if (!station) throw new UserFacingError('Station not found.', 404);
  await assertLocationAccess(ctx, station.locationId);
  const removedSince = new Date(Date.now() - 15 * 60_000);
  const found = await db.kitchenTicket.findMany({
    where: {
      stationId,
      OR: [
        { status: { in: ['PENDING', 'PREPARING'] } },
        { status: 'READY', readyAt: { gte: new Date(Date.now() - 20 * 60_000) } },
        { status: 'CANCELLED', order: { items: { some: { stationId, voidedAt: { gte: removedSince } } } } },
      ],
      order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY'] } },
    },
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
          items: { where: { stationId }, include: { modifiers: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  // Removed lines are shown only if the station could have seen them (removed after acceptance).
  const tickets = found.map((t) => ({ ...t, order: { ...t.order, items: t.order.items.filter((i) => !i.voidedAt || (t.order.acceptedAt !== null && i.voidedAt >= t.order.acceptedAt)) } }));
  // Priority orders first, otherwise oldest first.
  tickets.sort((a, b) => Number(b.order.isPriority) - Number(a.order.isPriority));
  // The location's attention times, so the screen marks a ticket late exactly when the attention
  // summary on every other page does (src/lib/attention.ts).
  const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id: station.locationId }, select: { attentionThresholds: true, takeawaySettings: { select: { leadTimeMinutes: true } } } });
  const t = resolveThresholds(loc.attentionThresholds);
  return { station, tickets, timing: { notStarted: t.ticket_not_started, overdue: t.ticket_overdue, leadMinutes: loc.takeawaySettings?.leadTimeMinutes ?? 20 } };
}

/** Public tracking view: minimal data, looked up by token hash. No phone/address returned. */
export async function trackOrder(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const order = await db.order.findUnique({
    where: { trackingTokenHash: hashToken(token) },
    select: {
      organizationId: true, // server-side only (module checks), not shown to the guest
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
      paymentMethodIntent: true,
      table: { select: { label: true, qrTokens: { where: { isActive: true }, select: { token: true, createdAt: true }, take: 1 } } },
      // The table's current QR address is only shown while this order's table is still open:
      // an old tracking link must not hand out a QR code that staff have replaced.
      tableSession: { select: { status: true } },
      // The restaurant's own public contact details (the guest's phone and address are never returned).
      location: { select: { name: true, slug: true, timeZone: true, phone: true, addressLine1: true, postalCode: true, city: true, takeawaySettings: { select: { pickupPoint: true } }, organization: { select: { name: true, slug: true } } } },
      items: { where: { voidedAt: null }, select: { customerNameSnapshot: true, nameSnapshot: true, variantNameSnapshot: true, quantity: true, lineTotalCents: true, modifiers: { select: { nameSnapshot: true, quantity: true } } } },
      events: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  return order;
}
