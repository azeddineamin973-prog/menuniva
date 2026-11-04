import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MembershipRole } from '@/generated/prisma/enums';
import { db } from '@/server/db';
import { navStatus } from '@/server/services/nav-counts';
import { submitTableOrder } from '@/server/services/orders';
import { createTableRequest } from '@/server/services/staff-tasks';
import { AccessDeniedError, resolveTenantAccess } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * GET /api/dashboard/[org]/counts requires membership only (tests/unit/route-audit.test.ts,
 * MEMBER_ONLY_ROUTES): every role needs its badges, and no permission is held by all of them. What it
 * returns must therefore be gated inside navStatus: a role sees only the counts and attention items of
 * the sections it may open, only for its own locations, and never anything of another restaurant.
 */
describe('dashboard counts route: member-only, gated per permission and location', () => {
  beforeEach(resetDatabase);

  type F = Awaited<ReturnType<typeof createOrderingFixture>>;
  const member = async (f: F, role: MembershipRole, locationIds: string[] = []) => {
    const u = await createTestUser(`${role} counts test`);
    await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role, locationIds } });
    return resolveTenantAccess(u.id, f.org.slug);
  };
  const busy = async () => {
    const f = await createOrderingFixture();
    await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${randomUUID()}`);
    await createTableRequest({ qrToken: f.qrToken, type: 'CALL_WAITER' }, `guest-${randomUUID()}`);
    await createTableRequest({ qrToken: f.qrToken, type: 'REQUEST_BILL' }, `guest-${randomUUID()}`);
    await db.notification.create({ data: { organizationId: f.org.id, locationId: f.location.id, type: 'LOW_RATING', title: '1★ feedback (test)' } });
    return f;
  };
  const zero = { liveOrders: 0, tasks: 0, bills: 0, reservations: 0, reviews: 0, kitchen: 0, myDeliveries: 0 };

  it('owner and waiter see the waiting work; kitchen and delivery staff get zeros and no order or table items', async () => {
    const f = await busy();
    const owner = await navStatus(f.ctx);
    expect(owner).toMatchObject({ liveOrders: 1, tasks: 2, bills: 1, reviews: 1 });
    const waiter = await navStatus(await member(f, 'WAITER'));
    expect(waiter).toMatchObject({ liveOrders: 1, tasks: 2, bills: 1, reviews: 0 });
    for (const role of ['KITCHEN_STAFF', 'DELIVERY_STAFF'] as const) {
      const s = await navStatus(await member(f, role));
      expect(s).toMatchObject(zero);
      expect(s.attention.items.filter((i) => ['order_unaccepted', 'table_request', 'table_request_on_way', 'reservation_unconfirmed'].includes(i.kind))).toEqual([]);
    }
  });

  it('a manager limited to another location sees nothing of this one', async () => {
    const f = await busy();
    const second = await db.restaurantLocation.create({ data: { organizationId: f.org.id, name: 'Second (test)', slug: `second-${Date.now()}` } });
    const s = await navStatus(await member(f, 'RESTAURANT_MANAGER', [second.id]));
    expect(s).toMatchObject(zero);
    expect(s.attention.total).toBe(0);
  });

  it('a member of another restaurant cannot get a context for this one, and its own counts are zero', async () => {
    const f = await busy();
    const other = await createOrderingFixture('Other Restaurant');
    await expect(resolveTenantAccess(other.owner.id, f.org.slug)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await navStatus(other.ctx)).toMatchObject(zero);
  });
});
