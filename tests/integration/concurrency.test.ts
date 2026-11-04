import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { openTableSession } from '@/server/services/bills';
import { submitPickupOrder } from '@/server/services/fulfilment';
import { changeOrderStatus, changeTicketStatus, liveOrders, submitTableOrder, trackOrder } from '@/server/services/orders';
import { resolveTenantAccess, type TenantContext } from '@/server/tenant';
import { acquireExclusiveDb } from '../support/db-lock';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Regression tests for the 2026-10-30 audit:
 * BUG-01 — 10+ simultaneous orders starved the 10-connection pool and all failed;
 * BUG-03 — simultaneous first orders on one table opened several OPEN sessions (split bills);
 * BUG-02 — the test database must be locked for the whole run.
 */
describe('concurrent ordering (audit BUG-01, BUG-03)', () => {
  beforeEach(resetDatabase);

  it('BUG-01: 25 guests on 5 tables submit at the same moment — every order is stored, numbers unique', async () => {
    const f = await createOrderingFixture();
    const tables = [f.table];
    for (const label of ['11', '12', '13', '14']) {
      tables.push(await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label, qrTokens: { create: { token: `qr_conc_${label}_${f.org.id}`.slice(0, 40) } } }, include: { qrTokens: true } }));
    }
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) =>
        submitTableOrder({ qrToken: tables[i % 5].qrTokens[0].token, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${i}`),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.map((r) => String((r as PromiseRejectedResult).reason).slice(0, 120))).toEqual([]);
    const orders = await db.order.findMany({ where: { organizationId: f.org.id }, select: { number: true } });
    expect(orders).toHaveLength(25);
    expect(new Set(orders.map((o) => o.number)).size).toBe(25);
  });

  it('BUG-03: 12 simultaneous first orders on one table share exactly one open table session', async () => {
    const f = await createOrderingFixture();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${i}`)),
    );
    const sessions = await db.tableSession.findMany({ where: { tableId: f.table.id, status: 'OPEN' }, include: { _count: { select: { orders: true } } } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]._count.orders).toBe(12);
  });

  it('BUG-03: staff opening the table while guests order never creates a second session', async () => {
    const f = await createOrderingFixture();
    await Promise.all([
      openTableSession(f.ctx, f.table.id),
      openTableSession(f.ctx, f.table.id),
      ...Array.from({ length: 4 }, (_, i) => submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${i}`)),
    ]);
    expect(await db.tableSession.count({ where: { tableId: f.table.id, status: 'OPEN' } })).toBe(1);
  });

  it('the same idempotency key submitted 6 times at once creates one order', async () => {
    const f = await createOrderingFixture();
    const key = randomUUID();
    const res = await Promise.all(Array.from({ length: 6 }, () => submitTableOrder({ qrToken: f.qrToken, idempotencyKey: key, language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'same-phone')));
    expect(new Set(res.map((r) => r.orderNumber)).size).toBe(1);
    expect(res.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await db.order.count({ where: { organizationId: f.org.id } })).toBe(1);
  });
});

/**
 * Regression tests for the 2026-11-02 restaurant operations audit, OPS-07: Kitchen and Café
 * pressing "Ready" at the same moment left the order PREPARING with every ticket READY
 * (19 of 20 trials), so Live Orders and the guest's tracking page never showed it ready.
 */
describe('Kitchen and Café finishing at the same moment (audit OPS-07)', () => {
  beforeEach(resetDatabase);
  const TRIALS = 20;

  async function kitchenAndCafe() {
    const f = await createOrderingFixture();
    const staff = async (role: 'KITCHEN_STAFF' | 'CAFE_STAFF') => {
      const u = await createTestUser(role);
      await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role } });
      return resolveTenantAccess(u.id, f.org.slug);
    };
    const kitchen = await staff('KITCHEN_STAFF');
    const cafe = await staff('CAFE_STAFF');
    let n = 0;
    /** Pickup order with a dish (Kitchen) and a tea (Café), accepted: one ticket per station. */
    const accepted = async () => {
      n += 1;
      const placed = await submitPickupOrder(
        {
          orgSlug: f.org.slug,
          idempotencyKey: randomUUID(),
          language: 'pt',
          items: [
            { productId: f.dish.id, quantity: 1, modifiers: [] },
            { productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] },
          ],
          pickup: 'asap',
          customerName: 'Test Guest',
          phone: `+351 91${String(n).padStart(7, '0')}`,
        },
        `ops07-guest-${n}`,
      );
      const o = await db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: placed.orderNumber } });
      await changeOrderStatus(f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
      const ticket = (stationId: string) => db.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id, stationId } }).then((t) => t.id);
      return { id: o.id, token: placed.trackingToken, k: await ticket(f.kitchen.id), c: await ticket(f.cafe.id) };
    };
    const tick = (ctx: TenantContext, ticketId: string, expectedFrom: string, to: string) => changeTicketStatus(ctx, { ticketId, expectedFrom, to });
    const state = async (id: string) => {
      const o = await db.order.findUniqueOrThrow({ where: { id }, include: { tickets: true, events: { orderBy: { createdAt: 'asc' } } } });
      const live = o.tickets.filter((t) => t.status !== 'CANCELLED');
      return { status: o.status, tickets: o.tickets.map((t) => t.status), allReady: live.length > 0 && live.every((t) => t.status === 'READY'), readyEvents: o.events.filter((e) => e.toStatus === 'READY').length };
    };
    const reasons = (r: PromiseSettledResult<unknown>[]) => r.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason?.message ?? x).slice(0, 80));
    return { f, kitchen, cafe, accepted, tick, state, reasons };
  }

  it(`both stations press Ready together: the order becomes READY once, every time (${TRIALS} trials), and Live Orders and the tracker show it`, async () => {
    const t = await kitchenAndCafe();
    for (let i = 0; i < TRIALS; i++) {
      const o = await t.accepted();
      await t.tick(t.kitchen, o.k, 'PENDING', 'PREPARING');
      await t.tick(t.cafe, o.c, 'PENDING', 'PREPARING');
      const r = await Promise.allSettled([t.tick(t.kitchen, o.k, 'PREPARING', 'READY'), t.tick(t.cafe, o.c, 'PREPARING', 'READY')]);
      expect(t.reasons(r)).toEqual([]);
      expect(await t.state(o.id)).toMatchObject({ status: 'READY', tickets: ['READY', 'READY'], readyEvents: 1 });
      expect((await trackOrder(o.token))?.status).toBe('READY');
      expect((await liveOrders(t.f.ctx, t.f.location.id, new Date(Date.now() - 3600_000))).find((l) => l.id === o.id)?.status).toBe('READY');
    }
  });

  it(`both stations press Ready straight from waiting: READY every time (${TRIALS} trials)`, async () => {
    const t = await kitchenAndCafe();
    for (let i = 0; i < TRIALS; i++) {
      const o = await t.accepted();
      const r = await Promise.allSettled([t.tick(t.kitchen, o.k, 'PENDING', 'READY'), t.tick(t.cafe, o.c, 'PENDING', 'READY')]);
      expect(t.reasons(r)).toEqual([]);
      expect(await t.state(o.id)).toMatchObject({ status: 'READY', readyEvents: 1 });
    }
  });

  it(`a station undoing Ready while the other finishes never leaves the order READY with food still cooking (${TRIALS} trials)`, async () => {
    const t = await kitchenAndCafe();
    for (let i = 0; i < TRIALS; i++) {
      const o = await t.accepted();
      await t.tick(t.kitchen, o.k, 'PENDING', 'READY');
      await t.tick(t.cafe, o.c, 'PENDING', 'PREPARING');
      const r = await Promise.allSettled([t.tick(t.cafe, o.c, 'PREPARING', 'READY'), t.tick(t.kitchen, o.k, 'READY', 'PREPARING')]);
      expect(t.reasons(r)).toEqual([]);
      const s = await t.state(o.id);
      expect(s.status === 'READY').toBe(s.allReady);
      expect(s.status).toBe('PREPARING');
    }
  });

  it(`cancelling while both stations press Ready: no deadlock, one consistent outcome (${TRIALS} trials)`, async () => {
    const t = await kitchenAndCafe();
    for (let i = 0; i < TRIALS; i++) {
      const o = await t.accepted();
      await t.tick(t.kitchen, o.k, 'PENDING', 'PREPARING');
      const r = await Promise.allSettled([
        t.tick(t.kitchen, o.k, 'PREPARING', 'READY'),
        t.tick(t.cafe, o.c, 'PENDING', 'READY'),
        changeOrderStatus(t.f.ctx, { orderId: o.id, expectedFrom: 'PREPARING', to: 'CANCELLED', reason: 'Guest left' }),
      ]);
      // Only the clean "someone else changed it first" answer is allowed, never a database error.
      expect(t.reasons(r).filter((m) => m !== 'status_conflict')).toEqual([]);
      const s = await t.state(o.id);
      if (s.status === 'CANCELLED') expect(s.tickets).toEqual(['CANCELLED', 'CANCELLED']);
      else expect(s).toMatchObject({ status: 'READY', allReady: true, readyEvents: 1 });
    }
  });

  it(`"Mark ready" at the counter racing a station's undo is checked under the order lock (${TRIALS} trials)`, async () => {
    const t = await kitchenAndCafe();
    for (let i = 0; i < TRIALS; i++) {
      const o = await t.accepted();
      await t.tick(t.kitchen, o.k, 'PENDING', 'READY');
      await t.tick(t.cafe, o.c, 'PENDING', 'READY');
      // An order left behind by the old race: every ticket READY, order still PREPARING.
      await db.order.update({ where: { id: o.id }, data: { status: 'PREPARING' } });
      await db.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: 'READY', toStatus: 'PREPARING', actorType: 'SYSTEM', note: 'test: stuck order' } });
      const r = await Promise.allSettled([changeOrderStatus(t.f.ctx, { orderId: o.id, expectedFrom: 'PREPARING', to: 'READY' }), t.tick(t.kitchen, o.k, 'READY', 'PREPARING')]);
      expect(t.reasons(r).filter((m) => !/stations are still preparing/.test(m))).toEqual([]);
      const s = await t.state(o.id);
      expect(s.status === 'READY').toBe(s.allReady);
      expect(s.status).toBe('PREPARING');
    }
  });

  it('safeguards still hold: stale taps conflict, cancelled orders refuse ticket changes, invalid moves are refused', async () => {
    const t = await kitchenAndCafe();
    const o = await t.accepted();
    await t.tick(t.kitchen, o.k, 'PENDING', 'PREPARING');
    await expect(t.tick(t.kitchen, o.k, 'PENDING', 'PREPARING')).rejects.toThrow('status_conflict');
    await expect(t.tick(t.cafe, o.c, 'READY', 'PREPARING')).rejects.toThrow('status_conflict');
    await expect(t.tick(t.cafe, o.c, 'PENDING', 'PENDING')).rejects.toThrow('Invalid ticket change.');
    await expect(changeOrderStatus(t.f.ctx, { orderId: o.id, expectedFrom: 'PREPARING', to: 'READY' })).rejects.toThrow(/stations are still preparing/);
    await changeOrderStatus(t.f.ctx, { orderId: o.id, expectedFrom: 'PREPARING', to: 'CANCELLED', reason: 'Guest left' });
    await expect(t.tick(t.kitchen, o.k, 'PREPARING', 'READY')).rejects.toThrow('status_conflict');
    expect(await t.state(o.id)).toMatchObject({ status: 'CANCELLED', tickets: ['CANCELLED', 'CANCELLED'], readyEvents: 0 });
    // A collected order cannot be reopened from the kitchen display.
    const done = await t.accepted();
    await t.tick(t.kitchen, done.k, 'PENDING', 'READY');
    await t.tick(t.cafe, done.c, 'PENDING', 'READY');
    await changeOrderStatus(t.f.ctx, { orderId: done.id, expectedFrom: 'READY', to: 'COMPLETED' });
    await expect(t.tick(t.kitchen, done.k, 'READY', 'PREPARING')).rejects.toThrow('This order is no longer being prepared.');
    expect((await t.state(done.id)).status).toBe('COMPLETED');
    // Another restaurant's staff cannot touch this restaurant's tickets.
    const other = await createOrderingFixture('Other Test Restaurant');
    const fresh = await t.accepted();
    await expect(t.tick(other.ctx, fresh.k, 'PENDING', 'READY')).rejects.toThrow('Ticket not found.');
    expect((await t.state(fresh.id)).status).toBe('ACCEPTED');
  });
});

describe('test database lock (audit BUG-02)', () => {
  it('a second test run cannot use menuniva_test while this run holds it', async () => {
    await expect(acquireExclusiveDb(process.env.DATABASE_URL!, 'second-run')).rejects.toThrow(/already in use by another test run/);
  });
});
