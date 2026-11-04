import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { navCounts } from '@/server/services/nav-counts';
import { changeOrderStatus, StatusConflictError, submitTableOrder } from '@/server/services/orders';
import { resolveTenantAccess } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Audit OPS-02: one tap on "Seen" on any device took an order out of the sidebar badge, the
 * page title and the repeating chime on every device, while it stayed NEW and nobody had accepted
 * it. A NEW order is now waiting for everyone until a staff member accepts or rejects it, and that
 * person and the time are recorded (status event + audit log).
 */
describe('NEW-order responsibility (audit OPS-02)', () => {
  beforeEach(resetDatabase);

  type F = Awaited<ReturnType<typeof createOrderingFixture>>;
  const order = async (f: F) => {
    await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${randomUUID()}`);
    return db.order.findFirstOrThrow({ where: { organizationId: f.org.id }, orderBy: { createdAt: 'desc' } });
  };
  const staff = async (f: F, role: 'WAITER' | 'CAFE_STAFF' | 'RESTAURANT_MANAGER', locationIds: string[] = []) => {
    const u = await createTestUser(`${role} test`);
    await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role, locationIds } });
    return resolveTenantAccess(u.id, f.org.slug);
  };

  it('a NEW order stays in everyone’s count until it is accepted or rejected (an old "seen" mark changes nothing)', async () => {
    const f = await createOrderingFixture();
    const waiter = await staff(f, 'WAITER');
    const cafe = await staff(f, 'CAFE_STAFF');
    const first = await order(f);
    const second = await order(f);
    // Rows marked "seen" before this change (acknowledgedAt set) must still count as waiting.
    await db.order.update({ where: { id: first.id }, data: { acknowledgedAt: new Date() } });
    for (const ctx of [f.ctx, waiter, cafe]) expect((await navCounts(ctx)).liveOrders).toBe(2);

    await changeOrderStatus(waiter, { orderId: first.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    for (const ctx of [f.ctx, waiter, cafe]) expect((await navCounts(ctx)).liveOrders).toBe(1);
    await changeOrderStatus(f.ctx, { orderId: second.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Kitchen closed (test)' });
    for (const ctx of [f.ctx, waiter, cafe]) expect((await navCounts(ctx)).liveOrders).toBe(0);
  });

  it('two staff accepting the same order at once: one wins, the other is told it changed; accepted once, with who and when', async () => {
    const f = await createOrderingFixture();
    const waiter = await staff(f, 'WAITER');
    for (let i = 0; i < 8; i++) {
      const o = await order(f);
      const res = await Promise.allSettled([changeOrderStatus(f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' }), changeOrderStatus(waiter, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' })]);
      const won = res.findIndex((r) => r.status === 'fulfilled');
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res[1 - won] as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(StatusConflictError);
      expect((lost.reason as StatusConflictError).current).toBe('ACCEPTED');
      const winner = won === 0 ? f.ctx.userId : waiter.userId;

      const fresh = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { tickets: true, events: { where: { fromStatus: 'NEW' } } } });
      expect(fresh.status).toBe('ACCEPTED');
      expect(fresh.tickets).toHaveLength(1);
      expect(fresh.events).toHaveLength(1);
      expect(fresh.events[0]).toMatchObject({ toStatus: 'ACCEPTED', actorType: 'STAFF', actorUserId: winner });
      expect(Math.abs(fresh.events[0].createdAt.getTime() - fresh.acceptedAt!.getTime())).toBeLessThan(5000);
      const audits = await db.auditLog.findMany({ where: { entityId: o.id, action: 'order.status_changed' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUserId: winner, organizationId: f.org.id, metadata: { from: 'NEW', to: 'ACCEPTED' } });
    }
    expect((await navCounts(f.ctx)).liveOrders).toBe(0);
  });

  it('accept on one device and reject on another at the same moment: exactly one happens, recorded with its actor', async () => {
    const f = await createOrderingFixture();
    const waiter = await staff(f, 'WAITER');
    for (let i = 0; i < 8; i++) {
      const o = await order(f);
      const [accept, reject] = await Promise.allSettled([
        changeOrderStatus(f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' }),
        changeOrderStatus(waiter, { orderId: o.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Kitchen closed (test)' }),
      ]);
      expect([accept.status, reject.status].sort()).toEqual(['fulfilled', 'rejected']);
      const loser = (accept.status === 'rejected' ? accept : reject) as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(StatusConflictError);
      const fresh = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { tickets: true, events: { where: { fromStatus: 'NEW' } } } });
      expect(fresh.events).toHaveLength(1);
      if (accept.status === 'fulfilled') {
        expect(fresh.status).toBe('ACCEPTED');
        expect(fresh.tickets.map((t) => t.status)).toEqual(['PENDING']);
        expect(fresh.events[0]).toMatchObject({ toStatus: 'ACCEPTED', actorUserId: f.ctx.userId });
      } else {
        expect(fresh.status).toBe('CANCELLED');
        expect(fresh.tickets).toHaveLength(0);
        expect(fresh.events[0]).toMatchObject({ toStatus: 'CANCELLED', actorUserId: waiter.userId, note: 'Kitchen closed (test)' });
      }
      expect(await db.auditLog.count({ where: { entityId: o.id, action: 'order.status_changed' } })).toBe(1);
    }
    expect((await navCounts(waiter)).liveOrders).toBe(0);
  });

  it('a manager limited to another location neither counts nor changes the waiting order', async () => {
    const f = await createOrderingFixture();
    const second = await db.restaurantLocation.create({ data: { organizationId: f.org.id, slug: 'second', name: 'Second' } });
    const otherManager = await staff(f, 'RESTAURANT_MANAGER', [second.id]);
    const o = await order(f);
    expect((await navCounts(f.ctx)).liveOrders).toBe(1);
    // Limited to the second location: the first location's waiting order is neither counted nor changeable.
    expect((await navCounts(otherManager)).liveOrders).toBe(0);
    await expect(changeOrderStatus(otherManager, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' })).rejects.toMatchObject({ reason: 'location' });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('NEW');
    expect((await navCounts(f.ctx)).liveOrders).toBe(1);
  });
});
