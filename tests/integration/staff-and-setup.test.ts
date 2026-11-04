import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { acceptInvitation, inviteStaff, updateMember } from '@/server/services/invitations';
import { getSetupProgress } from '@/server/services/setup-progress';
import { createTableRequest, listOpenTasks, updateTask } from '@/server/services/staff-tasks';
import { resolveTenantAccess } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

describe('staff invitations and roles', () => {
  beforeEach(resetDatabase);

  it('invites a waiter, only the invited email can accept, and the role is enforced', async () => {
    const f = await createOrderingFixture();
    const { link } = await inviteStaff(f.ctx, { email: 'waiter@test.menuniva.local', role: 'WAITER' });
    const token = link.split('/invite/')[1];
    const stranger = await createTestUser('Stranger');
    await expect(acceptInvitation(token, stranger)).rejects.toThrow(/was sent to/);
    const waiter = await db.user.create({ data: { name: 'Waiter', email: 'waiter@test.menuniva.local', passwordHash: 'x' } });
    expect(await acceptInvitation(token, waiter)).toBe(f.org.slug);
    await expect(acceptInvitation(token, waiter)).rejects.toThrow(/invalid or has expired/);
    const ctx = await resolveTenantAccess(waiter.id, f.org.slug, 'orders.manage');
    expect(ctx.role).toBe('WAITER');
    await expect(resolveTenantAccess(waiter.id, f.org.slug, 'staff.manage')).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('managers cannot invite owners and the last owner cannot be demoted', async () => {
    const f = await createOrderingFixture();
    const mgrUser = await createTestUser('Manager');
    await db.restaurantMembership.create({ data: { userId: mgrUser.id, organizationId: f.org.id, role: 'RESTAURANT_MANAGER' } });
    const mgr = await resolveTenantAccess(mgrUser.id, f.org.slug);
    await expect(inviteStaff(mgr, { email: 'x@test.menuniva.local', role: 'RESTAURANT_OWNER' })).rejects.toThrow(/cannot assign/);
    const ownerMembership = await db.restaurantMembership.findFirstOrThrow({ where: { organizationId: f.org.id, role: 'RESTAURANT_OWNER' } });
    const second = await createTestUser('Co-owner');
    await db.restaurantMembership.create({ data: { userId: second.id, organizationId: f.org.id, role: 'RESTAURANT_OWNER', status: 'DISABLED' } });
    const coOwnerCtx = { ...f.ctx, membershipId: 'other' };
    await expect(updateMember(coOwnerCtx, { membershipId: ownerMembership.id, role: 'WAITER', status: 'ACTIVE' })).rejects.toThrow(/at least one active owner/);
  });
});

describe('table requests (call waiter / bill)', () => {
  beforeEach(resetDatabase);

  it('creates one visible task per type and table, and staff can close it', async () => {
    const f = await createOrderingFixture();
    const a = await createTableRequest({ qrToken: f.qrToken, type: 'CALL_WAITER' }, 'k1');
    const b = await createTableRequest({ qrToken: f.qrToken, type: 'CALL_WAITER' }, 'k1');
    expect(b.duplicate).toBe(true);
    await createTableRequest({ qrToken: f.qrToken, type: 'REQUEST_BILL' }, 'k1');
    const tasks = await listOpenTasks(f.ctx, f.location.id);
    expect(tasks.map((t) => t.type).sort()).toEqual(['CALL_WAITER', 'REQUEST_BILL']);
    expect(tasks[0].table?.label).toBe('05');
    await updateTask(f.ctx, a.taskId!, 'DONE');
    expect((await listOpenTasks(f.ctx, f.location.id)).length).toBe(1);
  });
});

describe('setup wizard progress', () => {
  beforeEach(resetDatabase);

  it('derives completion from real data only', async () => {
    const f = await createOrderingFixture();
    const { steps } = await getSetupProgress(f.org.id);
    const done = Object.fromEntries(steps.map((s) => [s.key, s.done]));
    expect(steps).toHaveLength(10);
    expect(done).toMatchObject({ details: false, import: true, prices: true, tables: true, kitchen: true, preview: false, publish: true });
  });
});
