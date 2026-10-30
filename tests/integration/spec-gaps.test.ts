import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { attemptLogin } from '@/server/auth/login';
import { hashPassword } from '@/server/auth/password';
import { db } from '@/server/db';
import { changePassword, deleteMyAccount, exportMyData, updateProfile } from '@/server/services/account';
import { submitPickupOrder, updateTakeawaySettings } from '@/server/services/fulfilment';
import { enrolFromOrder, loyaltyMembers, updateLoyaltyProgram } from '@/server/services/loyalty';
import { changeOrderStatus, setOrderPriority, stationTickets, submitTableOrder, trackOrder } from '@/server/services/orders';
import { cancelPlanChangeRequest, createSupportRequest, decidePlanChange, mySupportRequests, requestPlanChange } from '@/server/services/support';
import { resolveTenantAccess } from '@/server/tenant';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const tableOrder = (f: F, productId: string) => submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId, quantity: 1, modifiers: [] }] }, `k${Math.random()}`);

describe('Part 21 / 19: restaurant support requests and plan change preparation', () => {
  beforeEach(resetDatabase);

  it('restaurants send support requests and only see their own', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await expect(createSupportRequest(a.ctx, { subject: 'x', body: 'too short' })).rejects.toThrow();
    await createSupportRequest(a.ctx, { subject: 'QR codes', body: 'How do I print the QR sheet for the terrace?' });
    expect(await mySupportRequests(a.ctx)).toHaveLength(1);
    expect(await mySupportRequests(b.ctx)).toHaveLength(0);
    expect(await db.supportTicket.findFirstOrThrow()).toMatchObject({ organizationId: a.org.id, createdById: a.owner.id, status: 'OPEN' });
  });

  it('owner requests an upgrade; nothing changes until Super Admin applies or declines it', async () => {
    const f = await createOrderingFixture();
    const [starter, growth] = await Promise.all([db.subscriptionPlan.findUniqueOrThrow({ where: { code: 'starter' } }), db.subscriptionPlan.findUniqueOrThrow({ where: { code: 'growth' } })]);
    await expect(requestPlanChange(f.ctx, starter.id)).rejects.toThrow(/already your plan/);
    expect(await requestPlanChange(f.ctx, growth.id, 'We start delivery next month')).toEqual({ direction: 'upgrade' });
    let sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: f.org.id } });
    expect(sub).toMatchObject({ planId: starter.id, pendingPlanId: growth.id });
    expect((await db.supportTicket.findFirstOrThrow()).subject).toBe('Plan upgrade request: Starter → Growth');
    await cancelPlanChangeRequest(f.ctx);
    expect((await db.subscription.findUniqueOrThrow({ where: { organizationId: f.org.id } })).pendingPlanId).toBeNull();
    await requestPlanChange(f.ctx, growth.id);
    await decidePlanChange(f.owner.id, f.org.id, false);
    expect(await db.subscription.findUniqueOrThrow({ where: { organizationId: f.org.id } })).toMatchObject({ planId: starter.id, pendingPlanId: null });
    await requestPlanChange(f.ctx, growth.id);
    await decidePlanChange(f.owner.id, f.org.id, true);
    sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: f.org.id } });
    expect(sub).toMatchObject({ planId: growth.id, pendingPlanId: null });
    await expect(decidePlanChange(f.owner.id, f.org.id, true)).rejects.toThrow(/no pending/);
  });
});

describe('Part 25: staff account self-service (GDPR)', () => {
  beforeEach(resetDatabase);

  it('profile, password change signs out other devices, export of own data', async () => {
    const f = await createOrderingFixture();
    await db.user.update({ where: { id: f.owner.id }, data: { passwordHash: await hashPassword('old-password-123') } });
    await updateProfile(f.owner.id, { name: 'New Name', preferredLanguage: 'fr' });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })).toMatchObject({ name: 'New Name', preferredLanguage: 'fr' });
    await db.session.createMany({ data: [{ userId: f.owner.id, tokenHash: 'this-device', expiresAt: new Date(Date.now() + 86400_000) }, { userId: f.owner.id, tokenHash: 'other-device', expiresAt: new Date(Date.now() + 86400_000) }] });
    await expect(changePassword(f.owner.id, 'wrong', 'new-password-123')).rejects.toThrow(/not correct/);
    await expect(changePassword(f.owner.id, 'old-password-123', 'short')).rejects.toThrow(/10 characters/);
    await changePassword(f.owner.id, 'old-password-123', 'new-password-123', 'this-device');
    expect((await db.session.findMany({ where: { userId: f.owner.id } })).map((s) => s.tokenHash)).toEqual(['this-device']);
    const email = (await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })).email;
    expect((await attemptLogin(email, 'new-password-123', '10.9.0.1')).ok).toBe(true);
    const data = await exportMyData(f.owner.id);
    expect(data.user).toMatchObject({ name: 'New Name', email });
    expect(data.user).not.toHaveProperty('passwordHash');
    expect(data.memberships[0]).toMatchObject({ role: 'RESTAURANT_OWNER', organization: { name: 'Test Restaurant' } });
  });

  it('the only owner cannot delete their account; with a second owner the account is erased and access ends', async () => {
    const f = await createOrderingFixture();
    await db.user.update({ where: { id: f.owner.id }, data: { passwordHash: await hashPassword('owner-password-1') } });
    await expect(deleteMyAccount(f.owner.id, 'owner-password-1', 'nope')).rejects.toThrow(/DELETE/);
    await expect(deleteMyAccount(f.owner.id, 'wrong', 'DELETE')).rejects.toThrow(/not correct/);
    await expect(deleteMyAccount(f.owner.id, 'owner-password-1', 'DELETE')).rejects.toThrow(/only owner/);
    const second = await db.user.create({ data: { name: 'Second Owner', email: 'second@test.menuniva.local', passwordHash: 'x' } });
    await db.restaurantMembership.create({ data: { userId: second.id, organizationId: f.org.id, role: 'RESTAURANT_OWNER' } });
    const oldEmail = (await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })).email;
    await db.session.create({ data: { userId: f.owner.id, tokenHash: 'dev', expiresAt: new Date(Date.now() + 86400_000) } });
    await deleteMyAccount(f.owner.id, 'owner-password-1', 'DELETE');
    const gone = await db.user.findUniqueOrThrow({ where: { id: f.owner.id } });
    expect(gone.name).toBe('Deleted user');
    expect(gone.email).not.toBe(oldEmail);
    expect(gone.disabledAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: f.owner.id } })).toBe(0);
    await expect(resolveTenantAccess(f.owner.id, f.org.slug)).rejects.toThrow();
    expect((await attemptLogin(oldEmail, 'owner-password-1', '10.9.0.2')).ok).toBe(false);
  });
});

describe('Parts 9, 10, 16: order priority, pickup point, birthdays', () => {
  beforeEach(resetDatabase);

  it('a priority order is shown first on the kitchen display; another restaurant cannot flag it', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Test Restaurant Other');
    await tableOrder(f, f.dish.id);
    await tableOrder(f, f.dish.id);
    const [first, second] = await db.order.findMany({ where: { organizationId: f.org.id }, orderBy: { number: 'asc' } });
    for (const o of [first, second]) await changeOrderStatus(f.ctx, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    expect((await stationTickets(f.ctx, f.kitchen.id)).tickets.map((t) => t.order.number)).toEqual([1, 2]);
    await setOrderPriority(f.ctx, second.id, true);
    expect((await stationTickets(f.ctx, f.kitchen.id)).tickets.map((t) => [t.order.number, t.order.isPriority])).toEqual([[2, true], [1, false]]);
    await expect(setOrderPriority(other.ctx, first.id, true)).rejects.toThrow(/not found/);
  });

  it('the pickup point (e.g. reception counter) is shown on takeaway orders only', async () => {
    const f = await createOrderingFixture();
    await updateTakeawaySettings(f.ctx, { locationId: f.location.id, leadTimeMinutes: 15, slotMinutes: 15, minOrder: '', paused: false, pickupHours: '', pickupPoint: '  Balcão de receção ' });
    const o = await submitPickupOrder({ orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], pickup: 'asap', customerName: 'Test', phone: '+351 900 000 002' }, 'k');
    expect((await trackOrder(o.trackingToken))?.location.takeawaySettings?.pickupPoint).toBe('Balcão de receção');
    await updateTakeawaySettings(f.ctx, { locationId: f.location.id, leadTimeMinutes: 15, slotMinutes: 15, minOrder: '', paused: false, pickupHours: '', pickupPoint: '' });
    expect((await db.takeawaySettings.findUniqueOrThrow({ where: { locationId: f.location.id } })).pickupPoint).toBeNull();
  });

  it('birthdays this month lists only members who gave a birthday with consent', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, { enabled: true, type: 'STAMPS', stampsForReward: 5, pointsPerEuro: 1, rewardText: 'Test reward', expiryDays: '' });
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const other = String(((new Date().getMonth() + 1) % 12) + 1).padStart(2, '0');
    const join = async (phone: string, birthday?: string) => {
      const o = await tableOrder(f, f.dish.id);
      await enrolFromOrder({ orderToken: o.trackingToken, phone, consent: true, ...(birthday ? { birthday, birthdayConsent: true } : {}) }, `k${Math.random()}`);
    };
    await join('+351 911 000 001', `${month}-15`);
    await join('+351 911 000 002', `${other}-15`);
    await join('+351 911 000 003');
    expect((await loyaltyMembers(f.ctx, undefined, new Date().getMonth() + 1)).map((a) => a.phone)).toEqual(['+351911000001']);
    expect(await loyaltyMembers(f.ctx)).toHaveLength(3);
  });
});
