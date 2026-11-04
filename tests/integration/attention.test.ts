import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { MembershipRole } from '@/generated/prisma/enums';
import { db } from '@/server/db';
import { attentionFor, getAttentionThresholds, resetAttentionThresholds, updateAttentionThresholds } from '@/server/services/attention';
import { navStatus } from '@/server/services/nav-counts';
import { changeOrderStatus, changeTicketStatus, submitTableOrder } from '@/server/services/orders';
import { changeReservationStatus } from '@/server/services/reservations';
import { createTableRequest, updateTask } from '@/server/services/staff-tasks';
import { resolveTenantAccess, type TenantContext } from '@/server/tenant';
import { DEFAULT_THRESHOLDS } from '@/lib/attention';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Audit OPS-01 / OPS-13 / D4: one server-side attention computation for unresolved work, with
 * per-location times, owned by the right role and escalated to managers only when urgent. Every
 * check uses a fixed clock (`now`) instead of waiting.
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const MIN = 60_000;
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MIN);
const seen = async (ctx: TenantContext, now: Date) => (await attentionFor(ctx, now)).items.map((i) => `${i.kind}:${i.level}`);

async function setup(name = 'Attention Test') {
  const f = await createOrderingFixture(name);
  await db.restaurantOrganization.update({ where: { id: f.org.id }, data: { enabledModules: { push: ['kds', 'reservations', 'takeaway', 'delivery'] } } });
  const member = async (role: MembershipRole, locationIds: string[] = []) => {
    const u = await createTestUser(`${role} test`);
    await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role, locationIds } });
    return resolveTenantAccess(u.id, f.org.slug);
  };
  return { f, member };
}
const tableOrder = async (f: F, productId = f.dish.id) => {
  await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId, quantity: 1, modifiers: [] }] }, `guest-${randomUUID()}`);
  return db.order.findFirstOrThrow({ where: { organizationId: f.org.id }, orderBy: { createdAt: 'desc' } });
};
let number = 800;
const readyOrder = (f: F, channel: 'TAKEAWAY' | 'DELIVERY', readyAt: Date, extra: { pickupAt?: Date; locationId?: string } = {}) =>
  db.order.create({
    data: {
      organizationId: f.org.id,
      locationId: extra.locationId ?? f.location.id,
      number: ++number,
      channel,
      status: 'READY',
      subtotalCents: 1000,
      totalCents: 1000,
      idempotencyKey: randomUUID(),
      trackingTokenHash: randomUUID(),
      readyAt,
      pickupAt: extra.pickupAt ?? null,
      ...(channel === 'DELIVERY' ? { delivery: { create: { recipientName: 'Test', addressLine: 'Rua Teste 1', postalCode: '4700-001', city: 'Braga', phone: '+351 900 000 000' } } } : {}),
    },
  });

describe('shared attention and escalation (audit OPS-01, D4)', () => {
  beforeEach(resetDatabase);

  it('an unaccepted order: reception sees it at once, late at 2 min, urgent at 4; managers only when urgent; kitchen and drivers never', async () => {
    const { f, member } = await setup();
    const [waiter, cook, driver, manager] = [await member('WAITER'), await member('KITCHEN_STAFF'), await member('DELIVERY_STAFF'), await member('RESTAURANT_MANAGER')];
    const o = await tableOrder(f);
    const t0 = o.createdAt;
    expect(await seen(waiter, at(t0, 1))).toEqual(['order_unaccepted:waiting']);
    expect(await seen(waiter, at(t0, 2))).toEqual(['order_unaccepted:warning']);
    expect(await seen(waiter, at(t0, 4))).toEqual(['order_unaccepted:urgent']);
    for (const m of [f.ctx, manager]) {
      expect(await seen(m, at(t0, 3))).toEqual([]);
      expect(await seen(m, at(t0, 4))).toEqual(['order_unaccepted:urgent']);
    }
    for (const m of [cook, driver]) expect(await seen(m, at(t0, 30))).toEqual([]);
    const item = (await attentionFor(waiter, at(t0, 4))).items[0];
    expect(item).toMatchObject({ entityId: o.id, orderNumber: o.number, nav: 'liveOrders', href: `/dashboard/${f.org.slug}/orders?focus=order-${o.id}`, locationName: null });
    expect(item.ageSec).toBe(240);
  });

  it('without any waiter, the owner is responsible and sees new orders at once (small restaurant)', async () => {
    const { f } = await setup();
    const o = await tableOrder(f);
    expect(await seen(f.ctx, at(o.createdAt, 0.5))).toEqual(['order_unaccepted:waiting']);
  });

  it('accepting ends the order item everywhere; each station’s ticket goes to its own staff; late at 8 min, urgent at 15; preparing too long from Start', async () => {
    const { f, member } = await setup();
    const [waiter, cook, barista] = [await member('WAITER'), await member('KITCHEN_STAFF'), await member('CAFE_STAFF')];
    const o = await tableOrder(f);
    await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] }] }, 'guest-tea');
    const tea = await db.order.findFirstOrThrow({ where: { organizationId: f.org.id }, orderBy: { createdAt: 'desc' } });
    await changeOrderStatus(waiter, { orderId: o.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    await changeOrderStatus(waiter, { orderId: tea.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    const ticket = await db.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id } });
    // The clock of both tickets: from the later of the two acceptances.
    const t0 = (await db.kitchenTicket.findFirstOrThrow({ where: { orderId: tea.id } })).createdAt;
    expect((await seen(waiter, at(t0, 9))).filter((s) => s.startsWith('order'))).toEqual([]);
    // Within time a ticket is normal work, not attention.
    expect(await seen(cook, at(t0, 7))).toEqual([]);
    expect(await seen(cook, at(t0, 8))).toEqual(['ticket_not_started:warning']);
    expect(await seen(barista, at(t0, 8))).toContain('ticket_not_started:warning');
    expect((await attentionFor(cook, at(t0, 8))).items[0]).toMatchObject({ stationName: 'Test Kitchen', href: `/dashboard/${f.org.slug}/kitchen/${f.kitchen.id}?focus=ticket-${ticket.id}` });
    expect((await attentionFor(barista, at(t0, 8))).items.find((i) => i.kind === 'ticket_not_started')?.stationName).toBe('Test Café');
    expect(await seen(f.ctx, at(t0, 14))).toEqual([]);
    expect(await seen(f.ctx, at(t0, 15))).toEqual(['ticket_not_started:urgent', 'ticket_not_started:urgent']);
    await changeTicketStatus(cook, { ticketId: ticket.id, expectedFrom: 'PENDING', to: 'PREPARING' });
    const started = (await db.kitchenTicket.findUniqueOrThrow({ where: { id: ticket.id } })).startedAt!;
    expect(await seen(cook, at(started, 19))).toEqual([]);
    expect(await seen(cook, at(started, 20))).toEqual(['ticket_overdue:warning']);
    await changeTicketStatus(cook, { ticketId: ticket.id, expectedFrom: 'PREPARING', to: 'READY' });
    expect(await seen(cook, at(started, 60))).toEqual([]);
  });

  it('a pickup ready but not collected counts from the pickup time when that is later; delivery without a driver goes to drivers, else reception, and ends when a driver takes it', async () => {
    const { f, member } = await setup();
    const waiter = await member('WAITER');
    const now = new Date();
    await readyOrder(f, 'TAKEAWAY', at(now, -12));
    await readyOrder(f, 'TAKEAWAY', at(now, -30), { pickupAt: at(now, -5) });
    // Ready pickups within time are not shown (the guest has not come yet).
    expect(await seen(waiter, now)).toEqual(['pickup_uncollected:warning']);
    // 14 min later: the first is 26 min past ready (urgent); the scheduled one 19 min past its pickup time (late).
    expect(await seen(waiter, at(now, 14))).toEqual(['pickup_uncollected:urgent', 'pickup_uncollected:warning']);
    await db.order.updateMany({ where: { organizationId: f.org.id, channel: 'TAKEAWAY' }, data: { status: 'COMPLETED' } });

    const d = await readyOrder(f, 'DELIVERY', at(now, -1));
    // No driver accounts yet: reception sends it out and owns the item.
    expect(await seen(waiter, now)).toEqual(['delivery_no_driver:waiting']);
    const driver = await member('DELIVERY_STAFF');
    expect(await seen(waiter, now)).toEqual([]);
    expect(await seen(driver, now)).toEqual(['delivery_no_driver:waiting']);
    expect((await attentionFor(driver, at(now, 6))).items[0]).toMatchObject({ level: 'warning', nav: 'myDeliveries', href: `/dashboard/${f.org.slug}/driver#order-${d.id}` });
    expect((await navStatus(driver, at(now, 6))).myDeliveries).toBe(1);
    await db.deliveryOrderDetails.update({ where: { orderId: d.id }, data: { driverMembershipId: driver.membershipId } });
    expect(await seen(driver, at(now, 30))).toEqual([]);
    expect(await seen(f.ctx, at(now, 30))).toEqual([]);
  });

  it('table requests: “On my way” changes how it is shown but keeps it open with its own clock; Done resolves it; the badge counts both', async () => {
    const { f, member } = await setup();
    const [waiter, barista] = [await member('WAITER'), await member('CAFE_STAFF')];
    const taskId = (await createTableRequest({ qrToken: f.qrToken, type: 'CALL_WAITER' }, 'guest-call')).taskId!;
    const t0 = (await db.staffTask.findUniqueOrThrow({ where: { id: taskId } })).createdAt;
    expect(await seen(waiter, t0)).toEqual(['table_request:waiting']);
    expect(await seen(barista, at(t0, 1))).toEqual(['table_request:warning']);
    expect(await seen(f.ctx, at(t0, 3))).toEqual(['table_request:urgent']);
    await updateTask(waiter, taskId, 'ACKNOWLEDGED');
    const ack = (await db.staffTask.findUniqueOrThrow({ where: { id: taskId } })).acknowledgedAt!;
    // Still listed (as "on the way"), no longer escalated: its own clock starts at On my way.
    expect(await seen(waiter, at(ack, 4))).toEqual(['table_request_on_way:waiting']);
    expect(await seen(f.ctx, at(ack, 4))).toEqual([]);
    expect(await seen(waiter, at(ack, 5))).toEqual(['table_request_on_way:warning']);
    expect(await seen(f.ctx, at(ack, 10))).toEqual(['table_request_on_way:urgent']);
    expect((await navStatus(waiter)).tasks).toBe(1);
    await updateTask(waiter, taskId, 'DONE');
    expect(await seen(f.ctx, at(ack, 60))).toEqual([]);
    expect((await navStatus(waiter)).tasks).toBe(0);
  });

  it('booking requests: late after 30 min unanswered, urgent after 2 h or when the booking starts within 2 h; confirming ends it', async () => {
    const { f, member } = await setup();
    const waiter = await member('WAITER');
    const now = new Date();
    const mk = (startsAt: Date) =>
      db.reservation.create({ data: { organizationId: f.org.id, locationId: f.location.id, startsAt, endsAt: at(startsAt, 90), partySize: 2, name: 'Test Guest', phone: '+351 900 000 001', trackingTokenHash: randomUUID(), idempotencyKey: randomUUID() } });
    const later = await mk(at(now, 3 * 24 * 60));
    const asked = later.createdAt;
    expect(await seen(waiter, at(asked, 29))).toEqual(['reservation_unconfirmed:waiting']);
    expect(await seen(waiter, at(asked, 30))).toEqual(['reservation_unconfirmed:warning']);
    expect(await seen(f.ctx, at(asked, 119))).toEqual([]);
    expect(await seen(f.ctx, at(asked, 120))).toEqual(['reservation_unconfirmed:urgent']);
    await mk(at(now, 90));
    expect(await seen(f.ctx, at(now, 1))).toEqual(['reservation_unconfirmed:urgent']);
    await changeReservationStatus(waiter, { reservationId: later.id, to: 'CONFIRMED', expectedFrom: 'REQUESTED' });
    expect(await seen(waiter, at(now, 1))).toEqual(['reservation_unconfirmed:urgent']);
  });

  it('respects tenants and locations: each person sees only their locations (labelled when several), a location without reception escalates to its own manager', async () => {
    const { f, member } = await setup();
    const second = await db.restaurantLocation.create({ data: { organizationId: f.org.id, slug: 'second', name: 'Second', isPublished: true, tableOrderingEnabled: true, tableOrderingPolicy: 'OPEN' } });
    const secondTable = await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: second.id, label: '9', qrTokens: { create: { token: `qr_second_${f.org.id}`.slice(0, 40) } } }, include: { qrTokens: true } });
    const waiter = await member('WAITER', [f.location.id]);
    const manager2 = await member('RESTAURANT_MANAGER', [second.id]);
    const o1 = await tableOrder(f);
    await submitTableOrder({ qrToken: secondTable.qrTokens[0].token, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'guest-second');
    const o2 = await db.order.findFirstOrThrow({ where: { locationId: second.id } });
    const now = at(o2.createdAt, 1);
    expect((await attentionFor(waiter, now)).items.map((i) => i.entityId)).toEqual([o1.id]);
    // Nobody at reception in the second location: its manager owns it and sees it at once.
    const m2 = await attentionFor(manager2, now);
    expect(m2.items.map((i) => [i.entityId, i.level, i.locationName])).toEqual([[o2.id, 'waiting', null]]);
    // The owner works at both: first location only when urgent; second location at once (no reception there), labelled.
    const own = await attentionFor(f.ctx, at(o1.createdAt, 5));
    expect(own.items.map((i) => [i.entityId, i.locationName]).sort()).toEqual([[o1.id, f.location.name], [o2.id, 'Second']].sort());
    // Another restaurant never sees any of it.
    const other = await createOrderingFixture('Other Restaurant');
    expect((await attentionFor(other.ctx, at(o1.createdAt, 60))).total).toBe(0);
  });

  it('times are set per location without technical knowledge: they change levels there only, bad input is refused with a message, reset restores the recommended times', async () => {
    const { f, member } = await setup();
    const waiter = await member('WAITER');
    const second = await db.restaurantLocation.create({ data: { organizationId: f.org.id, slug: 'second', name: 'Second' } });
    const manager2 = await member('RESTAURANT_MANAGER', [second.id]);
    const o = await tableOrder(f);
    const input = { locationId: f.location.id, ...DEFAULT_THRESHOLDS, order_unaccepted: { warn: '10', urgent: '20' } };
    await updateAttentionThresholds(f.ctx, input);
    expect(await seen(waiter, at(o.createdAt, 5))).toEqual(['order_unaccepted:waiting']);
    expect(await seen(f.ctx, at(o.createdAt, 19))).toEqual([]);
    expect(await seen(f.ctx, at(o.createdAt, 20))).toEqual(['order_unaccepted:urgent']);
    expect((await getAttentionThresholds(f.ctx, second.id)).thresholds.order_unaccepted).toEqual(DEFAULT_THRESHOLDS.order_unaccepted);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'location.attention_thresholds_updated', entityId: f.location.id } });
    expect(audit).toMatchObject({ actorUserId: f.ctx.userId, metadata: { after: { order_unaccepted: { warn: 10, urgent: 20 } } } });

    const bad = await updateAttentionThresholds(f.ctx, { ...input, order_unaccepted: { warn: '9', urgent: '3' } }).catch((e) => e);
    expect(bad).toBeInstanceOf(ZodError);
    expect((bad as ZodError).issues[0]).toMatchObject({ path: ['order_unaccepted', 'urgent'], message: 'Urgent must be later than the warning.' });
    await expect(updateAttentionThresholds(f.ctx, { ...input, table_request: { warn: '0', urgent: '2' } })).rejects.toBeInstanceOf(ZodError);
    // A manager of another location cannot change this one.
    await expect(updateAttentionThresholds(manager2, input)).rejects.toMatchObject({ reason: 'location' });
    await resetAttentionThresholds(f.ctx, f.location.id);
    expect(await getAttentionThresholds(f.ctx, f.location.id)).toEqual({ thresholds: DEFAULT_THRESHOLDS, custom: false });
    expect(await seen(waiter, at(o.createdAt, 5))).toEqual(['order_unaccepted:urgent']);
  });
});
