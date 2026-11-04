import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { hashToken } from '@/server/crypto';
import { closeTableSession, getSessionBill, openTableSession, recordPayment, transferSession } from '@/server/services/bills';
import { changeOrderStatus, changeTicketStatus, submitTableOrder } from '@/server/services/orders';
import { orderingState } from '@/server/services/public-menu';
import { updateChannelSettings } from '@/server/services/settings';
import { createTableRequest } from '@/server/services/staff-tasks';
import { joinTableSession, PIN_MAX_FAILURES, regeneratePin, revealPin, revokeDevice, tableAccessFor } from '@/server/services/table-access';
import { resolveTenantAccess } from '@/server/tenant';
import { createRestaurant } from '@/server/services/organizations';
import { resetDatabase, createTestUser } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Secure QR table ordering (QR-ORDERING-DESIGN.md option D; tasks B–D). Fictitious restaurants in the
 * disposable test database only. Guests are simulated with the service functions the public routes
 * call; a phone is a guest id plus the authorisation tokens its cookie would hold.
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;
type Phone = { guest: string; tokens: string[] };
const phone = (): Phone => ({ guest: `g_${randomUUID().slice(0, 12)}`, tokens: [] });
const items = (f: F) => [{ productId: f.dish.id, quantity: 1, modifiers: [] }];

async function securedFixture(name = 'Test Secure', policy: 'SESSION' | 'SESSION_PIN' = 'SESSION_PIN') {
  const f = await createOrderingFixture(name);
  await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tableOrderingPolicy: policy } });
  return f;
}
async function join(f: F, p: Phone, pin: string, qrToken = f.qrToken) {
  const r = await joinTableSession({ qrToken, pin }, { guest: p.guest, ip: null }, p.tokens);
  if (r.joined && 'token' in r && r.token) p.tokens = [r.token, ...p.tokens];
  return r;
}
function order(f: F, p: Phone, extra: Record<string, unknown> = {}, qrToken = f.qrToken) {
  return submitTableOrder({ qrToken, idempotencyKey: randomUUID(), language: 'pt', items: items(f), ...extra }, { guest: p.guest, ip: null }, { grantTokens: p.tokens });
}
async function finishAndClose(f: F, sessionId: string) {
  for (const o of await db.order.findMany({ where: { tableSessionId: sessionId, status: { notIn: ['CANCELLED', 'COMPLETED'] } } })) {
    if (o.status === 'NEW') await changeOrderStatus(f.ctx, { orderId: o.id, to: 'CANCELLED', expectedFrom: 'NEW', reason: 'test' });
  }
  await closeTableSession(f.ctx, { sessionId, note: 'test close' });
}

describe('secure table sessions: policy and staff-opened tables', () => {
  beforeEach(resetDatabase);

  it('new locations default to SESSION_PIN; fixtures for older suites opt into OPEN explicitly', async () => {
    const owner = await createTestUser('Policy Owner');
    const { location } = await createRestaurant({ name: 'Test Policy Default', country: 'PT' }, { ownerUserId: owner.id, actorUserId: owner.id });
    expect(location.tableOrderingPolicy).toBe('SESSION_PIN');
    expect(location.tablePendingOrderCap).toBe(15);
  });

  it('T1 copied QR on a closed table: refused, and no order or session is created', async () => {
    const f = await securedFixture();
    await expect(order(f, phone())).rejects.toMatchObject({ code: 'table_not_open' });
    expect(await db.order.count()).toBe(0);
    expect(await db.tableSession.count()).toBe(0);
  });

  it('SESSION policy: closed table refused; staff open it, then guests order without a PIN', async () => {
    const f = await securedFixture('Test Session', 'SESSION');
    await expect(order(f, phone())).rejects.toMatchObject({ code: 'table_not_open' });
    const s = await openTableSession(f.ctx, f.table.id);
    expect(s.pin).toBeNull();
    await expect(order(f, phone())).resolves.toMatchObject({ status: 'NEW' });
    expect((await db.order.findFirstOrThrow()).tableSessionId).toBe(s.id);
  });

  it('OPEN policy (legacy) keeps working: the first order opens the table by itself', async () => {
    const f = await createOrderingFixture('Test Open');
    await expect(order(f, phone())).resolves.toMatchObject({ status: 'NEW' });
    const s = await db.tableSession.findFirstOrThrow();
    expect(s.openedById).toBeNull();
  });
});

describe('secure table sessions: PIN and device authorisation', () => {
  beforeEach(resetDatabase);

  it('T2 valid guest: QR alone cannot order; the right PIN once, then every order goes through', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    expect(s.pin).toMatch(/^\d{6}$/);
    const p = phone();
    await expect(order(f, p)).rejects.toMatchObject({ code: 'pin_required' });
    expect(await db.order.count()).toBe(0);
    const j = await join(f, p, s.pin!);
    expect(j).toMatchObject({ joined: true, tableLabel: '05' });
    await expect(order(f, p)).resolves.toMatchObject({ status: 'NEW', duplicate: false });
    await expect(order(f, p)).resolves.toMatchObject({ status: 'NEW' }); // no PIN again
    const orders = await db.order.findMany();
    expect(orders).toHaveLength(2);
    expect(new Set(orders.map((o) => o.tableSessionDeviceId)).size).toBe(1);
    expect(orders.every((o) => o.tableSessionId === s.id && o.tableSessionDeviceId)).toBe(true);
    // Joining again with a valid grant is a no-op (no second device row).
    await join(f, p, s.pin!);
    expect(await db.tableSessionDevice.count()).toBe(1);
  });

  it('secrets at rest: no plaintext PIN or token in the database; staff reveal is audited without the PIN', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    const row = await db.tableSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.pinCipher).toBeTruthy();
    expect(row.pinCipher).not.toContain(s.pin!);
    expect(row.verificationCode).toBeNull();
    const device = await db.tableSessionDevice.findFirstOrThrow();
    expect(device.tokenHash).toBe(hashToken(p.tokens[0]));
    expect(device.tokenHash).not.toContain(p.tokens[0]);
    expect(device.tableId).toBe(f.table.id);
    expect(device.organizationId).toBe(f.org.id);
    expect(device.locationId).toBe(f.location.id);
    await expect(revealPin(f.ctx, s.id)).resolves.toMatchObject({ pin: s.pin });
    const logs = await db.auditLog.findMany({ where: { action: { in: ['table.pin_viewed', 'table.device_enrolled', 'table.session_opened'] } } });
    expect(logs.map((l) => l.action).sort()).toEqual(['table.device_enrolled', 'table.pin_viewed', 'table.session_opened']);
    expect(JSON.stringify(logs)).not.toContain(s.pin!);
  });

  it('T3 invalid PIN: refused without authorising; the counter counts it', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const wrong = s.pin === '000000' ? '111111' : '000000';
    const p = phone();
    await expect(join(f, p, wrong)).rejects.toMatchObject({ code: 'pin_invalid' });
    await expect(join(f, p, '12')).rejects.toMatchObject({ code: 'pin_invalid' }); // bad format: not counted
    expect((await db.tableSession.findUniqueOrThrow({ where: { id: s.id } })).pinFailedAttempts).toBe(1);
    await expect(order(f, p)).rejects.toMatchObject({ code: 'pin_required' });
  });

  it('T4/T13 brute force: 20 parallel wrong PINs from 20 "phones" → exactly the limit counted, one lock, one alert; the right PIN is then refused', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const early = phone();
    await join(f, early, s.pin!); // already at the table before the attack
    const wrongs = Array.from({ length: 20 }, (_, i) => String((Number(s.pin) + 1 + i) % 1_000_000).padStart(6, '0'));
    const results = await Promise.allSettled(wrongs.map((w) => join(f, phone(), w)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const codes = results.map((r) => (r as PromiseRejectedResult).reason.code);
    expect(codes.filter((c) => c === 'pin_invalid').length).toBe(PIN_MAX_FAILURES - 1);
    expect(codes.filter((c) => c === 'pin_locked').length).toBe(20 - (PIN_MAX_FAILURES - 1));
    const row = await db.tableSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.pinFailedAttempts).toBe(PIN_MAX_FAILURES);
    expect(row.pinLockedAt).not.toBeNull();
    expect(await db.notification.count({ where: { title: { contains: 'PIN locked' } } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'table.pin_locked' } })).toBe(1);
    // Even the right PIN cannot enrol now…
    await expect(join(f, phone(), s.pin!)).rejects.toMatchObject({ code: 'pin_locked' });
    // …but the phone that joined before keeps ordering (T5).
    await expect(order(f, early)).resolves.toMatchObject({ status: 'NEW' });
    // Staff issue a new PIN: the lock clears, the old PIN is dead, the new one works.
    const { pin: fresh } = await regeneratePin(f.ctx, s.id);
    expect(fresh).not.toBe(s.pin);
    await expect(join(f, phone(), s.pin!)).rejects.toMatchObject({ code: 'pin_invalid' });
    const late = phone();
    await join(f, late, fresh);
    await expect(order(f, late)).resolves.toMatchObject({ status: 'NEW' });
    await expect(order(f, early)).resolves.toMatchObject({ status: 'NEW' });
  });

  it('T9 several guests share a table: 5 phones join with the PIN and order at the same moment', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const phones = Array.from({ length: 5 }, phone);
    for (const p of phones) await join(f, p, s.pin!);
    const placed = await Promise.all(phones.map((p) => order(f, p)));
    expect(new Set(placed.map((r) => r.orderNumber)).size).toBe(5);
    const orders = await db.order.findMany();
    expect(orders).toHaveLength(5);
    expect(new Set(orders.map((o) => o.tableSessionId))).toEqual(new Set([s.id]));
    expect(new Set(orders.map((o) => o.tableSessionDeviceId)).size).toBe(5);
    expect(orders.every((o) => o.totalCents === 1690 && o.status === 'NEW')).toBe(true);
  });

  it('T5/T2 former guests: after closing, their phone and the old PIN are dead; the next party starts a new seating', async () => {
    const f = await securedFixture();
    const first = await openTableSession(f.ctx, f.table.id);
    const a = phone();
    await join(f, a, first.pin!);
    const placed = await order(f, a);
    const o = await db.order.findFirstOrThrow({ where: { number: placed.orderNumber } });
    await changeOrderStatus(f.ctx, { orderId: o.id, to: 'ACCEPTED', expectedFrom: 'NEW' });
    const ticket = await db.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id } });
    await changeTicketStatus(f.ctx, { ticketId: ticket.id, to: 'READY', expectedFrom: 'PENDING' }); // the kitchen finishes
    await recordPayment(f.ctx, { sessionId: first.id, method: 'CASH', amountCents: o.totalCents });
    await closeTableSession(f.ctx, { sessionId: first.id });
    expect((await db.tableSessionDevice.findFirstOrThrow()).revokedAt).not.toBeNull();
    expect((await db.tableSession.findUniqueOrThrow({ where: { id: first.id } })).pinCipher).toBeNull();
    // Party A, from home, with the same QR and its old authorisation: refused.
    await expect(order(f, a)).rejects.toMatchObject({ code: 'session_ended' });
    // Party B is seated: new session, new identity, new PIN.
    const second = await openTableSession(f.ctx, f.table.id);
    expect(second.id).not.toBe(first.id);
    expect(second.pin).toMatch(/^\d{6}$/);
    await expect(order(f, a)).rejects.toMatchObject({ code: 'session_ended' });
    if (second.pin !== first.pin) await expect(join(f, phone(), first.pin!)).rejects.toMatchObject({ code: 'pin_invalid' });
    const b = phone();
    await join(f, b, second.pin!);
    await order(f, b);
    const billB = await getSessionBill(f.ctx, second.id);
    expect(billB.orders).toHaveLength(1);
    expect(billB.orders[0].tableSessionDeviceId).not.toBe(o.tableSessionDeviceId);
    expect((await getSessionBill(f.ctx, first.id)).orders.map((x) => x.id)).toEqual([o.id]);
    expect((await tableAccessFor({ ...f.table, location: { tableOrderingPolicy: 'SESSION_PIN' } }, a.tokens)).authorized).toBe(false);
  });

  it('T11 closing the table while authorised phones submit: never an order on a closed bill (10 trials)', async () => {
    const f = await securedFixture();
    let landedOnClosed = 0;
    let closesWon = 0;
    for (let i = 0; i < 10; i++) {
      const s = await openTableSession(f.ctx, f.table.id);
      const p = phone();
      await join(f, p, s.pin!);
      const [closeR, orderR] = await Promise.allSettled([closeTableSession(f.ctx, { sessionId: s.id, note: 'race' }), order(f, p)]);
      const row = await db.tableSession.findUniqueOrThrow({ where: { id: s.id } });
      const onSession = await db.order.findMany({ where: { tableSessionId: s.id } });
      if (closeR.status === 'fulfilled') {
        closesWon++;
        expect(orderR.status).toBe('rejected');
        expect(onSession.filter((o) => o.createdAt > row.closedAt!)).toHaveLength(0);
        landedOnClosed += onSession.length;
      } else {
        // The order committed first, so closing was refused (an order is still waiting).
        expect(orderR.status).toBe('fulfilled');
        expect(row.status).toBe('OPEN');
        await finishAndClose(f, s.id);
      }
    }
    expect(landedOnClosed).toBe(0);
    expect(closesWon).toBeGreaterThanOrEqual(0);
  });

  it('T15 double tap and retry after the table closed: one order, returned again without an authorisation error', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    const body = { qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: items(f) };
    const six = await Promise.all(Array.from({ length: 6 }, () => submitTableOrder(body, { guest: p.guest, ip: null }, { grantTokens: p.tokens })));
    expect(new Set(six.map((r) => r.orderNumber)).size).toBe(1);
    expect(six.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await db.order.count()).toBe(1);
    await finishAndClose(f, s.id);
    // The phone lost the answer and retries the same body after the table closed.
    await expect(submitTableOrder(body, { guest: p.guest, ip: null }, { grantTokens: p.tokens })).resolves.toMatchObject({ duplicate: true, orderNumber: six[0].orderNumber });
    expect(await db.order.count()).toBe(1);
  });

  it('T10 pending cap: refused at the cap, accepted again once staff approve', async () => {
    const f = await securedFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tablePendingOrderCap: 3 } });
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    for (let i = 0; i < 3; i++) await order(f, p);
    await expect(order(f, p)).rejects.toMatchObject({ code: 'too_many_pending' });
    const first = await db.order.findFirstOrThrow({ orderBy: { number: 'asc' } });
    await changeOrderStatus(f.ctx, { orderId: first.id, to: 'ACCEPTED', expectedFrom: 'NEW' });
    await expect(order(f, p)).resolves.toMatchObject({ status: 'NEW' });
  });

  it('T10b pending cap holds under concurrency: 30 phones at once, cap 5 → exactly 5 orders and 5 alerts', async () => {
    const f = await securedFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tablePendingOrderCap: 5 } });
    const s = await openTableSession(f.ctx, f.table.id);
    const phones = Array.from({ length: 30 }, phone);
    for (const p of phones) await join(f, p, s.pin!);
    const burst = async (ps: Phone[]) => {
      const res = await Promise.allSettled(ps.map((p) => order(f, p)));
      const refused = res.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.code);
      return { ok: res.filter((r) => r.status === 'fulfilled').length, refused };
    };
    const first = await burst(phones);
    expect(first.ok).toBe(5);
    expect(first.refused).toEqual(Array(25).fill('too_many_pending'));
    expect(await db.order.count({ where: { tableSessionId: s.id, status: 'NEW' } })).toBe(5);
    expect(await db.notification.count({ where: { organizationId: f.org.id, type: 'NEW_ORDER' } })).toBe(5);
    // A slot frees only when staff decide: accept 2 → exactly 2 more from the next burst.
    for (const o of (await db.order.findMany({ where: { tableSessionId: s.id }, orderBy: { number: 'asc' }, take: 2 }))) await changeOrderStatus(f.ctx, { orderId: o.id, to: 'ACCEPTED', expectedFrom: 'NEW' });
    const second = await burst(phones.slice(0, 10));
    expect(second.ok).toBe(2);
    expect(await db.order.count({ where: { tableSessionId: s.id, status: 'NEW' } })).toBe(5);
    // Refused attempts leave nothing behind that could hold a slot.
    expect(await db.tablePendingClaim.count()).toBe(0);
  });

  it('T10c pending cap under concurrency on an OPEN-policy table that is not open yet', async () => {
    const f = await createOrderingFixture('Test Open Cap');
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tablePendingOrderCap: 4 } });
    const res = await Promise.allSettled(Array.from({ length: 20 }, () => order(f, phone())));
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(4);
    expect(res.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.code)).toEqual(Array(16).fill('too_many_pending'));
    expect(await db.tableSession.count()).toBe(1);
    expect(await db.order.count({ where: { status: 'NEW' } })).toBe(4);
  });

  it('T10d a retried submission at the cap still returns its original order (idempotency before the cap)', async () => {
    const f = await securedFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tablePendingOrderCap: 1 } });
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    const body = { qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: items(f) };
    const placed = await submitTableOrder(body, { guest: p.guest, ip: null }, { grantTokens: p.tokens });
    const again = await Promise.all(Array.from({ length: 5 }, () => submitTableOrder(body, { guest: p.guest, ip: null }, { grantTokens: p.tokens })));
    expect(again.every((r) => r.duplicate && r.orderNumber === placed.orderNumber)).toBe(true);
    await expect(order(f, p)).rejects.toMatchObject({ code: 'too_many_pending' });
    expect(await db.order.count()).toBe(1);
  });

  it('T8/T17 an authorisation never works at another table or another restaurant', async () => {
    const f = await securedFixture('Test Secure A');
    const g = await securedFixture('Test Secure B');
    const other = await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label: '06', qrTokens: { create: { token: `qr_${f.org.id}_06`.slice(0, 40) } } }, include: { qrTokens: true } });
    const s = await openTableSession(f.ctx, f.table.id);
    await openTableSession(f.ctx, other.id);
    await openTableSession(g.ctx, g.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    await expect(order(f, p, {}, other.qrTokens[0].token)).rejects.toMatchObject({ code: 'pin_required' });
    await expect(submitTableOrder({ qrToken: g.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: items(g) }, { guest: p.guest, ip: null }, { grantTokens: p.tokens })).rejects.toMatchObject({ code: 'pin_required' });
    expect(await db.order.count()).toBe(0);
  });

  it('revoked or expired phones are refused; staff removal is audited', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const [p, q] = [phone(), phone()];
    await join(f, p, s.pin!);
    await join(f, q, s.pin!);
    const [dp, dq] = await db.tableSessionDevice.findMany({ orderBy: { enrolledAt: 'asc' } });
    await revokeDevice(f.ctx, dp.id);
    await expect(order(f, p)).rejects.toMatchObject({ code: 'session_ended' });
    await db.tableSessionDevice.update({ where: { id: dq.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(order(f, q)).rejects.toMatchObject({ code: 'session_ended' });
    expect(await db.auditLog.count({ where: { action: 'table.device_revoked' } })).toBe(1);
  });

  it('moving the party to another table: their phones follow, the old table is free', async () => {
    const f = await securedFixture();
    const target = await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label: '09', qrTokens: { create: { token: `qr_${f.org.id}_09`.slice(0, 40) } } }, include: { qrTokens: true } });
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    await transferSession(f.ctx, s.id, target.id);
    await expect(order(f, p, {}, target.qrTokens[0].token)).resolves.toMatchObject({ status: 'NEW' });
    await expect(order(f, p)).rejects.toMatchObject({ code: 'table_not_open' });
  });
});

describe('secure table sessions: staff approval and kitchen', () => {
  beforeEach(resetDatabase);

  it('T11/T18 only approved orders reach the kitchen; double approval, other tenants and other locations are refused', async () => {
    const f = await securedFixture('Test Approve A');
    const g = await securedFixture('Test Approve B');
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    await order(f, p);
    const o = await db.order.findFirstOrThrow();
    expect(await db.kitchenTicket.count()).toBe(0);
    // Another restaurant's owner cannot see or approve it.
    await expect(changeOrderStatus(g.ctx, { orderId: o.id, to: 'ACCEPTED', expectedFrom: 'NEW' })).rejects.toMatchObject({ status: 404 });
    // A waiter limited to another location of the same restaurant cannot approve it.
    const loc2 = await db.restaurantLocation.create({ data: { organizationId: f.org.id, slug: 'second', name: 'Second (test)' } });
    const w = await createTestUser('Waiter Other Location');
    await db.restaurantMembership.create({ data: { userId: w.id, organizationId: f.org.id, role: 'WAITER', locationIds: [loc2.id] } });
    const wctx = await resolveTenantAccess(w.id, f.org.slug);
    await expect(changeOrderStatus(wctx, { orderId: o.id, to: 'ACCEPTED', expectedFrom: 'NEW' })).rejects.toThrow();
    // Two approvals at once: exactly one wins.
    const both = await Promise.allSettled([changeOrderStatus(f.ctx, { orderId: o.id, to: 'ACCEPTED', expectedFrom: 'NEW' }), changeOrderStatus(f.ctx, { orderId: o.id, to: 'ACCEPTED', expectedFrom: 'NEW' })]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.orderStatusEvent.count({ where: { orderId: o.id, toStatus: 'ACCEPTED' } })).toBe(1);
    expect(await db.kitchenTicket.count({ where: { orderId: o.id } })).toBe(1);
  });

  it('a stale screen cannot approve an order of a table that was closed', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    await order(f, p);
    const o = await db.order.findFirstOrThrow();
    // Simulate a closed seating that still has a NEW order (closing normally refuses this).
    await db.tableSession.update({ where: { id: s.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await expect(changeOrderStatus(f.ctx, { orderId: o.id, to: 'ACCEPTED', expectedFrom: 'NEW' })).rejects.toThrow(/closed/);
    await expect(changeOrderStatus(f.ctx, { orderId: o.id, to: 'CANCELLED', expectedFrom: 'NEW', reason: 'guests left' })).resolves.toBeUndefined();
    expect(await db.kitchenTicket.count()).toBe(0);
  });

  it('T14 "please open my table": 5 phones at once create one request; opening the table answers it', async () => {
    const f = await securedFixture();
    const r = await Promise.all(Array.from({ length: 5 }, (_, i) => createTableRequest({ qrToken: f.qrToken, type: 'OPEN_TABLE' }, { guest: `g_open${i}`, ip: null })));
    expect(r.filter((x) => !x.duplicate)).toHaveLength(1);
    expect(await db.staffTask.count({ where: { type: 'OPEN_TABLE' } })).toBe(1);
    // Waiter calls are merged the same way (V9).
    await Promise.all(Array.from({ length: 5 }, (_, i) => createTableRequest({ qrToken: f.qrToken, type: 'CALL_WAITER' }, { guest: `g_call${i}`, ip: null })));
    expect(await db.staffTask.count({ where: { type: 'CALL_WAITER' } })).toBe(1);
    await openTableSession(f.ctx, f.table.id);
    expect((await db.staffTask.findFirstOrThrow({ where: { type: 'OPEN_TABLE' } })).status).toBe('DONE');
    await expect(createTableRequest({ qrToken: f.qrToken, type: 'OPEN_TABLE' }, { guest: 'g_late', ip: null })).resolves.toMatchObject({ alreadyOpen: true });
  });
});

describe('secure table sessions: final QA edge cases', () => {
  beforeEach(resetDatabase);

  const member = async (f: F, role: 'WAITER' | 'KITCHEN_STAFF' | 'CAFE_STAFF' | 'DELIVERY_STAFF') => {
    const u = await createTestUser(`${role} pin test`);
    await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role } });
    return resolveTenantAccess(u.id, f.org.slug);
  };

  it('PIN rotation: the new PIN works, the old one is refused, phones already in keep ordering, a lock is cleared', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const inside = phone();
    await join(f, inside, s.pin!);
    // Lock it with wrong guesses first: staff issuing a new PIN is the way out.
    for (let i = 0; i < PIN_MAX_FAILURES; i++) await join(f, phone(), s.pin === '000000' ? '111111' : '000000').catch(() => undefined);
    await expect(join(f, phone(), s.pin!)).rejects.toMatchObject({ message: 'pin_locked' });
    const { pin: fresh } = await regeneratePin(f.ctx, s.id);
    expect(fresh).not.toBe(s.pin);
    await expect(join(f, phone(), s.pin!)).rejects.toMatchObject({ message: 'pin_invalid' });
    const late = phone();
    await expect(join(f, late, fresh)).resolves.toMatchObject({ joined: true });
    await expect(order(f, late)).resolves.toMatchObject({ status: 'NEW' });
    await expect(order(f, inside)).resolves.toMatchObject({ status: 'NEW' });
    expect(await db.auditLog.count({ where: { action: 'table.pin_issued', entityId: s.id } })).toBe(1);
  });

  it('only staff who seat guests may open tables, see or issue PINs and remove phones (kitchen, Café, drivers refused)', async () => {
    const f = await securedFixture();
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    const device = await db.tableSessionDevice.findFirstOrThrow();
    for (const role of ['KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'] as const) {
      const ctx = await member(f, role);
      await expect(revealPin(ctx, s.id)).rejects.toMatchObject({ reason: 'forbidden' });
      await expect(regeneratePin(ctx, s.id)).rejects.toMatchObject({ reason: 'forbidden' });
      await expect(revokeDevice(ctx, device.id)).rejects.toMatchObject({ reason: 'forbidden' });
      await expect(openTableSession(ctx, f.table.id)).rejects.toMatchObject({ reason: 'forbidden' });
    }
    expect(await db.auditLog.count({ where: { action: 'table.pin_viewed' } })).toBe(0);
    const waiter = await member(f, 'WAITER');
    await expect(revealPin(waiter, s.id)).resolves.toMatchObject({ pin: s.pin });
    expect((await db.tableSessionDevice.findFirstOrThrow()).revokedAt).toBeNull();
  });

  it('a 4-digit code of a seating opened before SESSION_PIN still works once per phone, and dies with the table', async () => {
    const f = await securedFixture();
    // As the migration leaves a session that was open with the old table code.
    const legacy = await db.tableSession.create({ data: { organizationId: f.org.id, locationId: f.location.id, tableId: f.table.id, openedById: f.owner.id, verificationCode: '4821' } });
    await expect(order(f, phone())).rejects.toMatchObject({ code: 'pin_required' });
    // The old per-order field no longer authorises anything by itself.
    await expect(order(f, phone(), { tableCode: '4821' })).rejects.toMatchObject({ code: 'pin_required' });
    const p = phone();
    await expect(join(f, p, '4821')).resolves.toMatchObject({ joined: true });
    await expect(order(f, p)).resolves.toMatchObject({ status: 'NEW' });
    await expect(revealPin(f.ctx, legacy.id)).resolves.toMatchObject({ pin: '4821' });
    await finishAndClose(f, legacy.id);
    const closed = await db.tableSession.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(closed.verificationCode).toBeNull();
    await expect(order(f, p)).rejects.toMatchObject({ code: 'session_ended' });
  });

  it('policy changed while a table is open: OPEN → SESSION_PIN protects it at once; back to OPEN lets guests order on the same seating', async () => {
    const f = await createOrderingFixture('Test Policy Switch');
    const before = phone();
    await expect(order(f, before)).resolves.toMatchObject({ status: 'NEW' }); // guest-opened seating, no PIN
    const s = await db.tableSession.findFirstOrThrow();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tableOrderingPolicy: 'SESSION_PIN' } });
    // The QR alone (and the guest who ordered before the change) can no longer order.
    await expect(order(f, before)).rejects.toMatchObject({ code: 'pin_required' });
    await expect(order(f, phone())).rejects.toMatchObject({ code: 'pin_required' });
    // No PIN was ever issued for this seating: nobody can enrol until staff issue one.
    await expect(join(f, phone(), '123456')).rejects.toMatchObject({ message: 'pin_locked' });
    const { pin } = await regeneratePin(f.ctx, s.id);
    const p = phone();
    await join(f, p, pin);
    await expect(order(f, p)).resolves.toMatchObject({ status: 'NEW' });
    expect(await db.tableSession.count()).toBe(1);
    // Back to OPEN: the same seating and bill, no PIN needed.
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tableOrderingPolicy: 'OPEN' } });
    await expect(order(f, phone())).resolves.toMatchObject({ status: 'NEW' });
    expect(await db.order.count({ where: { tableSessionId: s.id } })).toBe(3);
    expect(await db.tableSession.count()).toBe(1);
  });

  it('closed hours (OPS-26): table ordering does not follow opening hours, so access control decides; pausing ordering refuses', async () => {
    const f = await securedFixture();
    // No opening hours on any day: closed now (takeaway would be refused).
    const loc = await db.restaurantLocation.update({ where: { id: f.location.id }, data: { openingHours: {} } });
    expect(orderingState(loc, 'ACTIVE', 'TAKEAWAY')).toEqual({ canOrder: false, reason: 'closed' });
    expect(orderingState(loc, 'ACTIVE', 'TABLE')).toEqual({ canOrder: true, reason: 'ok' });
    // Nobody opened the table after hours: a copied or remembered QR cannot order.
    await expect(order(f, phone())).rejects.toMatchObject({ code: 'table_not_open' });
    // Staff still working (e.g. a late table) can open it and those guests can order.
    const s = await openTableSession(f.ctx, f.table.id);
    const p = phone();
    await join(f, p, s.pin!);
    await expect(order(f, p)).resolves.toMatchObject({ status: 'NEW' });
    // The restaurant's own switch stops every table order at once.
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { orderingPaused: true } });
    await expect(order(f, p)).rejects.toMatchObject({ code: 'ordering_paused' });
    expect(await db.kitchenTicket.count()).toBe(0); // nothing reaches the kitchen without approval
  });

  it('a manager sets the policy and the pending cap in the channel settings; the change is audited, out-of-range caps refused', async () => {
    const f = await createOrderingFixture('Test Policy Settings');
    const u = await createTestUser('Manager settings test');
    await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role: 'RESTAURANT_MANAGER' } });
    const manager = await resolveTenantAccess(u.id, f.org.slug);
    expect(manager.can('settings.manage')).toBe(true);
    await updateChannelSettings(manager, { locationId: f.location.id, tableOrderingPolicy: 'SESSION_PIN', tablePendingOrderCap: 8 });
    const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } });
    expect(loc).toMatchObject({ tableOrderingPolicy: 'SESSION_PIN', tablePendingOrderCap: 8, tableCodeRequired: true });
    const changed = await db.auditLog.findMany({ where: { action: 'settings.table_policy_changed', entityId: f.location.id } });
    expect(changed.map((a) => a.metadata)).toEqual([{ from: 'OPEN', to: 'SESSION_PIN' }]);
    for (const cap of [0, 51]) await expect(updateChannelSettings(manager, { locationId: f.location.id, tablePendingOrderCap: cap })).rejects.toThrow();
    expect((await db.restaurantLocation.findUniqueOrThrow({ where: { id: f.location.id } })).tablePendingOrderCap).toBe(8);
    // Waiters and kitchen staff cannot change it (the channel settings action requires settings.manage).
    for (const role of ['WAITER', 'KITCHEN_STAFF'] as const) expect((await member(f, role)).can('settings.manage')).toBe(false);
  });

  it('waiter-call spam: 10 phones at once make one task and one alert; one phone repeating is throttled', async () => {
    const f = await securedFixture();
    await openTableSession(f.ctx, f.table.id);
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => createTableRequest({ qrToken: f.qrToken, type: 'CALL_WAITER' }, { guest: `g_spam${i}`, ip: null })));
    expect(r.filter((x) => !x.duplicate)).toHaveLength(1);
    expect(await db.staffTask.count({ where: { type: 'CALL_WAITER' } })).toBe(1);
    expect(await db.notification.count({ where: { type: 'STAFF_TASK' } })).toBe(1);
    const one = { guest: 'g_repeat', ip: null };
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => createTableRequest({ qrToken: f.qrToken, type: 'CALL_WAITER' }, one)));
    expect(results.filter((x) => x.status === 'rejected').map((x) => (x as PromiseRejectedResult).reason?.message)).toEqual(Array(4).fill('rate_limited')); // 6 per 10 minutes per phone
    expect(await db.notification.count({ where: { type: 'STAFF_TASK' } })).toBe(1);
  });
});
