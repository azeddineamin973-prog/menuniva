import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { createRestaurant } from '@/server/services/organizations';
import { AccessDeniedError, assertLocationAccess, resolveTenantAccess } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';

describe('TEST 1 / TEST 15 (base): tenant isolation', () => {
  beforeEach(resetDatabase);

  async function setup() {
    const ownerA = await createTestUser('Owner A');
    const ownerB = await createTestUser('Owner B');
    const a = await createRestaurant({ name: 'Restaurant A', country: 'PT' }, { ownerUserId: ownerA.id, actorUserId: ownerA.id });
    const b = await createRestaurant({ name: 'Restaurant B', country: 'ES' }, { ownerUserId: ownerB.id, actorUserId: ownerB.id });
    return { ownerA, ownerB, a, b };
  }

  it('creates complete tenants with owner membership and trial', async () => {
    const { a, b } = await setup();
    expect(a.org.slug).toBe('restaurant-a');
    expect(b.org.slug).toBe('restaurant-b');
    const sub = await db.subscription.findUnique({ where: { organizationId: a.org.id } });
    expect(sub?.status).toBe('TRIALING');
    expect(a.location.timeZone).toBe('Europe/Lisbon');
    expect(b.location.timeZone).toBe('Europe/Madrid');
    expect(b.org.defaultLanguage).toBe('es');
  });

  it('owner of A can access A', async () => {
    const { ownerA, a } = await setup();
    const ctx = await resolveTenantAccess(ownerA.id, a.org.slug, 'orders.view');
    expect(ctx.org.id).toBe(a.org.id);
    expect(ctx.role).toBe('RESTAURANT_OWNER');
  });

  it('owner of A cannot access B (not a member)', async () => {
    const { ownerA, b } = await setup();
    await expect(resolveTenantAccess(ownerA.id, b.org.slug)).rejects.toMatchObject({ reason: 'not_member' });
  });

  it('a location id from tenant B is rejected in tenant A context', async () => {
    const { ownerA, a, b } = await setup();
    const ctx = await resolveTenantAccess(ownerA.id, a.org.slug);
    await expect(assertLocationAccess(ctx, b.location.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(assertLocationAccess(ctx, a.location.id)).resolves.toBeUndefined();
  });

  it('role permissions are enforced server-side', async () => {
    const { a } = await setup();
    const cook = await createTestUser('Cook');
    await db.restaurantMembership.create({ data: { userId: cook.id, organizationId: a.org.id, role: 'KITCHEN_STAFF' } });
    await expect(resolveTenantAccess(cook.id, a.org.slug, 'kds.view')).resolves.toBeTruthy();
    await expect(resolveTenantAccess(cook.id, a.org.slug, 'billing.view')).rejects.toMatchObject({ reason: 'forbidden' });
    await expect(resolveTenantAccess(cook.id, a.org.slug, 'analytics.view')).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('disabled memberships and suspended tenants lose access', async () => {
    const { ownerA, a } = await setup();
    const waiter = await createTestUser('Waiter');
    await db.restaurantMembership.create({ data: { userId: waiter.id, organizationId: a.org.id, role: 'WAITER', status: 'DISABLED' } });
    await expect(resolveTenantAccess(waiter.id, a.org.slug)).rejects.toMatchObject({ reason: 'not_member' });
    await db.restaurantOrganization.update({ where: { id: a.org.id }, data: { status: 'SUSPENDED' } });
    await expect(resolveTenantAccess(ownerA.id, a.org.slug)).rejects.toMatchObject({ reason: 'suspended' });
  });

  it('location-restricted staff cannot access other locations of the same tenant', async () => {
    const { a } = await setup();
    const second = await db.restaurantLocation.create({ data: { organizationId: a.org.id, slug: 'second', name: 'Second' } });
    const waiter = await createTestUser('Waiter');
    await db.restaurantMembership.create({
      data: { userId: waiter.id, organizationId: a.org.id, role: 'WAITER', locationIds: [a.location.id] },
    });
    const ctx = await resolveTenantAccess(waiter.id, a.org.slug);
    await expect(assertLocationAccess(ctx, a.location.id)).resolves.toBeUndefined();
    await expect(assertLocationAccess(ctx, second.id)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('platform super admins do not get implicit access to tenant data', async () => {
    const { a } = await setup();
    const admin = await db.user.create({
      data: { name: 'Admin', email: 'admin@test.menuniva.local', passwordHash: 'x', platformRole: 'PLATFORM_SUPER_ADMIN' },
    });
    await expect(resolveTenantAccess(admin.id, a.org.slug)).rejects.toMatchObject({ reason: 'not_member' });
  });
});
