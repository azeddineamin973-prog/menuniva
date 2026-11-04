import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetPasswordAction } from '@/app/(auth)/actions';
import { attemptLogin, LOGIN_LIMITS } from '@/server/auth/login';
import { createPasswordResetLink } from '@/server/auth/reset';
import { hashPassword } from '@/server/auth/password';
import { db } from '@/server/db';
import { RateLimitError } from '@/server/rate-limit';
import { recordPayment } from '@/server/services/bills';
import { createStaffResetLink, inviteStaff, updateMember } from '@/server/services/invitations';
import { enrolFromOrder, updateLoyaltyProgram } from '@/server/services/loyalty';
import { changeOrderStatus, submitTableOrder, TABLE_ORDER_LIMITS } from '@/server/services/orders';
import { requestReservation, RESERVATION_LIMITS, updateReservationSettings } from '@/server/services/reservations';
import { resolveTenantAccess } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Release-readiness review (2026-11-01): regression tests for the problems found and fixed.
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const tableOrder = (f: F, who: { guest: string; ip: string | null }, productId = f.dish.id) =>
  submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId, quantity: 1, modifiers: [] }] }, who);
const bucket = async (key: string) => (await db.rateLimitBucket.findUnique({ where: { key } }))?.count ?? 0;

beforeEach(resetDatabase);

describe('staff password reset links', () => {
  async function member(f: F, role: string, opts: { platformRole?: 'USER' | 'PLATFORM_SUPER_ADMIN'; locationIds?: string[] } = {}) {
    const u = await createTestUser(`${role} user`);
    if (opts.platformRole) await db.user.update({ where: { id: u.id }, data: { platformRole: opts.platformRole } });
    return db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role: role as never, locationIds: opts.locationIds ?? [] } });
  }
  it('an owner cannot mint a reset link for a MenuNiva administrator or another owner', async () => {
    const f = await createOrderingFixture();
    const admin = await member(f, 'WAITER', { platformRole: 'PLATFORM_SUPER_ADMIN' });
    const coOwner = await member(f, 'RESTAURANT_OWNER');
    await expect(createStaffResetLink(f.ctx, admin.id)).rejects.toThrow(/support/);
    await expect(createStaffResetLink(f.ctx, coOwner.id)).rejects.toThrow(/support/);
    expect(await db.passwordResetToken.count()).toBe(0);
    const waiter = await member(f, 'WAITER');
    await expect(createStaffResetLink(f.ctx, waiter.id)).resolves.toMatch(/\/reset-password\//);
  });
  it('only the newest link works, and a link can be used once even when submitted twice at once', async () => {
    const f = await createOrderingFixture();
    const waiter = await member(f, 'WAITER');
    await createPasswordResetLink(waiter.userId);
    const link = await createPasswordResetLink(waiter.userId);
    expect(await db.passwordResetToken.count({ where: { userId: waiter.userId, usedAt: null } })).toBe(1);
    const form = (password: string) => {
      const fd = new FormData();
      fd.set('token', link.split('/reset-password/')[1]);
      fd.set('password', password);
      return fd;
    };
    const results = await Promise.all([resetPasswordAction({ ok: true }, form('first-new-password-1')), resetPasswordAction({ ok: true }, form('second-new-password-2'))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'link_invalid')).toHaveLength(1);
  });
  it('a manager limited to one location manages only staff of that location, and cannot grant wider access', async () => {
    const f = await createOrderingFixture();
    const second = await db.restaurantLocation.create({ data: { organizationId: f.org.id, slug: 'second', name: 'Second' } });
    const mgr = await member(f, 'RESTAURANT_MANAGER', { locationIds: [f.location.id] });
    const ctx = await resolveTenantAccess(mgr.userId, f.org.slug);
    const elsewhere = await member(f, 'WAITER', { locationIds: [second.id] });
    const here = await member(f, 'WAITER', { locationIds: [f.location.id] });
    await expect(createStaffResetLink(ctx, elsewhere.id)).rejects.toThrow(/cannot reset/);
    await expect(createStaffResetLink(ctx, here.id)).resolves.toMatch(/reset-password/);
    // "All locations" (empty list) or another location would be wider than the manager's own access.
    for (const locationIds of [[], [second.id], [f.location.id, second.id]]) {
      await expect(inviteStaff(ctx, { email: `w${locationIds.length}@test.menuniva.local`, role: 'WAITER', locationIds })).rejects.toThrow(/your own locations/);
      await expect(updateMember(ctx, { membershipId: here.id, role: 'WAITER', status: 'ACTIVE', locationIds })).rejects.toThrow(/your own locations/);
    }
    await expect(updateMember(ctx, { membershipId: elsewhere.id, role: 'WAITER', status: 'DISABLED', locationIds: [f.location.id] })).rejects.toThrow(/cannot change/);
    await expect(inviteStaff(ctx, { email: 'ok@test.menuniva.local', role: 'WAITER', locationIds: [f.location.id] })).resolves.toMatchObject({ link: expect.any(String) });
  });
});

describe('sign-in limits hold against guesses sent at the same moment', () => {
  it('30 parallel wrong passwords for one email: at most 8 are checked, the rest are refused', async () => {
    await db.user.create({ data: { name: 'Owner', email: 'owner@test.menuniva.local', passwordHash: await hashPassword('correct-horse-123') } });
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => attemptLogin('owner@test.menuniva.local', `wrong-${i}`, `10.9.0.${i}`)));
    expect(res.filter((r) => !r.ok && r.error === 'invalid_credentials').length).toBeLessThanOrEqual(LOGIN_LIMITS.perEmail);
    expect(res.filter((r) => !r.ok && r.error === 'too_many_attempts').length).toBeGreaterThanOrEqual(30 - LOGIN_LIMITS.perEmail);
  });
  it('successful sign-ins still never count', async () => {
    await db.user.create({ data: { name: 'Owner', email: 'owner@test.menuniva.local', passwordHash: await hashPassword('correct-horse-123') } });
    for (let i = 0; i < LOGIN_LIMITS.perEmail + 4; i++) expect((await attemptLogin('owner@test.menuniva.local', 'correct-horse-123', '10.8.0.1')).ok).toBe(true);
    expect(await bucket('login:email:owner@test.menuniva.local')).toBe(0);
  });
});

describe('one client cannot use up a restaurant’s shared order allowance', () => {
  it('refused orders count against the sender only, never against the location or the table', async () => {
    const f = await createOrderingFixture();
    await db.menuProduct.update({ where: { id: f.dish.id }, data: { status: 'DRAFT' } });
    for (let i = 0; i < 12; i++) await expect(tableOrder(f, { guest: `g_junk${i}`, ip: `ip_junk${i}` })).rejects.toMatchObject({ code: 'items_unavailable' });
    expect(await bucket(`order:${f.location.id}:all:location`)).toBe(0);
    expect(await bucket(`order:table:${(await db.tableQRToken.findUniqueOrThrow({ where: { token: f.qrToken } })).tableId}`)).toBe(0);
    await db.menuProduct.update({ where: { id: f.dish.id }, data: { status: 'ACTIVE' } });
    await expect(tableOrder(f, { guest: 'g_real', ip: 'ip_real' })).resolves.toMatchObject({ duplicate: false });
    expect(await bucket(`order:${f.location.id}:all:location`)).toBe(1);
  });
  it('the table cap still stops a flood of real orders', async () => {
    const f = await createOrderingFixture();
    // The hourly table cap under test; the pending-approval cap (15 by default) is covered elsewhere.
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tablePendingOrderCap: 50 } });
    for (let i = 0; i < TABLE_ORDER_LIMITS.table[0]; i++) await tableOrder(f, { guest: `g_t${i}`, ip: null });
    await expect(tableOrder(f, { guest: 'g_t-next', ip: null })).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('loyalty points are earned once per order', () => {
  it('five enrolments sent at the same moment with different phones: one joins, nothing is earned twice', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, { enabled: true, type: 'STAMPS', stampsForReward: 5, pointsPerEuro: 1, rewardText: 'Free mint tea', expiryDays: '' });
    const placed = await tableOrder(f, { guest: 'g_loyal', ip: null });
    const order = await db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: placed.orderNumber } });
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    await db.kitchenTicket.updateMany({ where: { orderId: order.id }, data: { status: 'READY' } });
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'ACCEPTED', to: 'READY' });
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'READY', to: 'COMPLETED' });
    await recordPayment(f.ctx, { orderId: order.id, method: 'CASH', amountCents: order.totalCents });
    const res = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => enrolFromOrder({ orderToken: placed.trackingToken, phone: `+351 91${n} 000 00${n}`, consent: true }, `g_enrol${n}`)));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(res.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['already_joined', 'already_joined', 'already_joined', 'already_joined']);
    expect(await db.loyaltyTransaction.count({ where: { orderId: order.id, type: 'EARN' } })).toBe(1);
  });
});

describe('reservation requests cannot be used to fill a restaurant', () => {
  const NOW = new Date('2026-11-04T10:00:00Z');
  const DINNER = { fri: [{ open: '19:00', close: '23:00' }], sat: [{ open: '19:00', close: '23:00' }] };
  const ask = (f: F, phone: string, time = '20:00', partySize = 2) =>
    requestReservation({ orgSlug: f.org.slug, date: '2026-11-06', time, partySize, name: 'Test Guest', phone, idempotencyKey: randomUUID(), language: 'pt' }, `g_res${Math.random()}`, NOW);
  it('one phone number makes at most 3 requests a day per restaurant; refused attempts do not count', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { reservationsEnabled: true } });
    await updateReservationSettings(f.ctx, { locationId: f.location.id, slotMinutes: 30, durationMinutes: 90, bufferMinutes: 15, maxPartySize: 8, maxCoversPerSlot: 10, minNoticeMinutes: 60, maxDaysAhead: 30, bookableHours: JSON.stringify(DINNER) });
    await expect(ask(f, '+351 900 000 001', '20:00', 12)).rejects.toMatchObject({ code: 'party_too_large' });
    for (const time of ['19:00', '20:00', '21:00']) await expect(ask(f, '+351 900 000 001', time)).resolves.toMatchObject({ status: 'REQUESTED' });
    await expect(ask(f, '+351900000001', '21:30')).rejects.toBeInstanceOf(RateLimitError);
    expect(RESERVATION_LIMITS.phonePerDay).toBe(3);
    await expect(ask(f, '+351 900 000 002', '21:30')).resolves.toMatchObject({ status: 'REQUESTED' });
  });
});

describe('payments and cancellations stay consistent', () => {
  it('an order with a recorded payment cannot be cancelled until the payment is voided', async () => {
    const f = await createOrderingFixture();
    const placed = await tableOrder(f, { guest: 'g_pay', ip: null });
    const order = await db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: placed.orderNumber } });
    await recordPayment(f.ctx, { orderId: order.id, method: 'CASH', amountCents: 500 });
    await expect(changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Guest left' })).rejects.toThrow(/Void the payment first/);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('NEW');
  });
});
