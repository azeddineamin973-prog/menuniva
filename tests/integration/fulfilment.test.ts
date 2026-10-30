import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  driverUpdate,
  parseZonePatterns,
  pickupOptions,
  publicLocation,
  quoteDelivery,
  resolvePickup,
  saveDeliveryZone,
  submitDeliveryOrder,
  submitPickupOrder,
  updateDeliverySettings,
  updateTakeawaySettings,
  assignDriver,
} from '@/server/services/fulfilment';
import { changeOrderStatus, changeTicketStatus, trackOrder } from '@/server/services/orders';
import { resolveTenantAccess } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const LUNCH_HOURS = { wed: [{ open: '12:00', close: '15:00' }] };

const pickup = (f: F, extra: Record<string, unknown> = {}) =>
  submitPickupOrder({ orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], pickup: 'asap', customerName: 'Test Guest', phone: '+351 900 000 002', ...extra }, `k${Math.random()}`);

const delivery = (f: F, extra: Record<string, unknown> = {}) =>
  submitDeliveryOrder(
    { orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], customerName: 'Test Guest', phone: '+351 900 000 003', address: 'Rua de Teste, 10', postalCode: '4700-123', city: 'Braga', paymentMethod: 'CASH_ON_DELIVERY', ...extra },
    `k${Math.random()}`,
  );

async function zone(f: F) {
  await saveDeliveryZone(f.ctx, { locationId: f.location.id, name: 'Test centro', patterns: '4700-*, 4710-001', fee: '2,50', minOrder: '10,00', freeFrom: '30,00', estimatedMinutes: '40' });
}

describe('M9-01/02 takeaway settings and pickup slots', () => {
  beforeEach(resetDatabase);

  it('generates slots inside pickup hours after the lead time (Europe/Lisbon)', () => {
    const now = new Date('2026-11-04T12:50:00Z'); // Wednesday 12:50 in Lisbon
    const o = pickupOptions({ timeZone: 'Europe/Lisbon', openingHours: LUNCH_HOURS }, { leadTimeMinutes: 20, slotMinutes: 15, pickupHours: null }, now);
    expect(o.slots.map((s) => s.minuteOfDay)).toEqual([795, 810, 825, 840, 855, 870, 885].map((m) => m));
    expect(o.slots[0].value).toBe('2026-11-04T13:15:00.000Z');
    expect(o.asap.allowed).toBe(true);
    const late = pickupOptions({ timeZone: 'Europe/Lisbon', openingHours: LUNCH_HOURS }, { leadTimeMinutes: 20, slotMinutes: 15, pickupHours: null }, new Date('2026-11-04T16:00:00Z'));
    expect(late.slots).toEqual([]);
    expect(late.asap.allowed).toBe(false);
    expect(resolvePickup('asap', late)).toBeNull();
    expect(resolvePickup('2026-11-04T13:20:00.000Z', o, now)).toBeNull(); // not a real slot
    expect(resolvePickup('2026-11-04T13:15:00.000Z', o, now)?.toISOString()).toBe('2026-11-04T13:15:00.000Z');
  });

  it('pickup hours override opening hours; summer time (UTC+1) is handled', () => {
    const now = new Date('2026-07-01T11:00:00Z'); // Wednesday 12:00 in Lisbon (WEST)
    const o = pickupOptions({ timeZone: 'Europe/Lisbon', openingHours: LUNCH_HOURS }, { leadTimeMinutes: 0, slotMinutes: 30, pickupHours: { wed: [{ open: '18:00', close: '19:00' }] } }, now);
    expect(o.slots.map((s) => s.value)).toEqual(['2026-07-01T17:00:00.000Z', '2026-07-01T17:30:00.000Z']);
  });

  it('owner settings: min order and pause are enforced server-side', async () => {
    const f = await createOrderingFixture();
    await updateTakeawaySettings(f.ctx, { locationId: f.location.id, leadTimeMinutes: 15, slotMinutes: 15, minOrder: '20,00', paused: false, pickupHours: '' });
    await expect(pickup(f)).rejects.toMatchObject({ code: 'below_minimum' });
    await updateTakeawaySettings(f.ctx, { locationId: f.location.id, leadTimeMinutes: 15, slotMinutes: 15, minOrder: '', paused: true, pickupHours: '' });
    await expect(pickup(f)).rejects.toMatchObject({ code: 'ordering_paused' });
    expect(await db.order.count()).toBe(0);
  });
});

describe('TEST 8: takeaway order', () => {
  beforeEach(resetDatabase);

  it('submits, prepares and marks READY for pickup; the customer sees the real status', async () => {
    const f = await createOrderingFixture();
    const r = await pickup(f);
    const order = await db.order.findFirstOrThrow();
    expect(order).toMatchObject({ channel: 'TAKEAWAY', customerName: 'Test Guest', totalCents: 1590, paymentMethodIntent: 'PAY_AT_COUNTER' });
    expect(Math.abs(order.pickupAt!.getTime() - Date.now() - 20 * 60_000)).toBeLessThan(60_000);
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    const ticket = await db.kitchenTicket.findFirstOrThrow();
    await changeTicketStatus(f.ctx, { ticketId: ticket.id, expectedFrom: 'PENDING', to: 'READY' });
    expect((await trackOrder(r.trackingToken))?.status).toBe('READY');
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'READY', to: 'COMPLETED' });
    expect((await trackOrder(r.trackingToken))?.status).toBe('COMPLETED');
  });

  it('refuses invalid contact data and dishes not offered for takeaway', async () => {
    const f = await createOrderingFixture();
    await expect(pickup(f, { phone: 'abc' })).rejects.toThrow();
    await db.channelPrice.deleteMany({ where: { productId: f.dish.id, channel: 'TAKEAWAY' } });
    await expect(pickup(f)).rejects.toMatchObject({ code: 'items_unavailable' });
  });
});

describe('M9-04/05 delivery zones', () => {
  beforeEach(resetDatabase);
  it('validates PT and ES patterns', () => {
    expect(parseZonePatterns('PT', '4700-*, 4710001 ; 4715-*')).toEqual(['4700-*', '4710-001', '4715-*']);
    expect(() => parseZonePatterns('PT', '47000')).toThrow(/not a valid Portuguese/);
    expect(parseZonePatterns('ES', '280*, 08001')).toEqual(['280*', '08001']);
    expect(() => parseZonePatterns('ES', '4700-123')).toThrow(/Spanish/);
    expect(() => parseZonePatterns('PT', '')).toThrow(/at least one/);
  });
});

describe('TEST 9 / TEST 10: delivery coverage and fees', () => {
  beforeEach(resetDatabase);

  it('TEST 9: valid zone → server-calculated fee; free delivery above the threshold', async () => {
    const f = await createOrderingFixture();
    await zone(f);
    const pl = (await publicLocation(f.org.slug))!;
    const q1 = await quoteDelivery(pl, '4700123', 'pt', [{ productId: f.dish.id, quantity: 1, modifiers: [] }]);
    expect(q1).toMatchObject({ valid: true, covered: true, zoneName: 'Test centro', feeCents: 250, subtotalCents: 1790, totalCents: 2040, meetsMinimum: true, estimatedMinutes: 40 });
    const q2 = await quoteDelivery(pl, '4700-123', 'pt', [{ productId: f.dish.id, quantity: 2, modifiers: [] }]);
    expect(q2).toMatchObject({ feeCents: 0, totalCents: 3580 });
    await delivery(f, { postalCode: '4700123' });
    const order = await db.order.findFirstOrThrow({ include: { delivery: true } });
    expect(order).toMatchObject({ channel: 'DELIVERY', subtotalCents: 1790, deliveryFeeCents: 250, totalCents: 2040, paymentMethodIntent: 'CASH_ON_DELIVERY' });
    expect(order.delivery).toMatchObject({ postalCode: '4700-123', city: 'Braga', addressLine: 'Rua de Teste, 10' });
  });

  it('TEST 10: unsupported postal codes are rejected; nothing is created', async () => {
    const f = await createOrderingFixture();
    await zone(f);
    const pl = (await publicLocation(f.org.slug))!;
    expect(await quoteDelivery(pl, '4900-001', 'pt', [{ productId: f.dish.id, quantity: 1, modifiers: [] }])).toMatchObject({ valid: true, covered: false });
    expect(await quoteDelivery(pl, '123', 'pt', [{ productId: f.dish.id, quantity: 1, modifiers: [] }])).toMatchObject({ valid: false, covered: false });
    await expect(delivery(f, { postalCode: '4900-001' })).rejects.toMatchObject({ code: 'outside_delivery_zone' });
    await expect(delivery(f, { postalCode: '123' })).rejects.toMatchObject({ code: 'invalid_postal_code' });
    expect(await db.order.count()).toBe(0);
  });

  it('enforces zone minimum, payment options, pause and the active-order limit', async () => {
    const f = await createOrderingFixture();
    await zone(f);
    await expect(delivery(f, { items: [{ productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] }] })).rejects.toMatchObject({ code: 'items_unavailable' }); // tea has no delivery price
    await db.channelPrice.create({ data: { productId: f.tea.id, channel: 'DELIVERY', amountCents: 250 } });
    await expect(delivery(f, { items: [{ productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] }] })).rejects.toMatchObject({ code: 'below_minimum' });
    await expect(delivery(f, { paymentMethod: 'CARD_TERMINAL' })).rejects.toMatchObject({ code: 'payment_method_unavailable' });
    await updateDeliverySettings(f.ctx, { locationId: f.location.id, prepEstimateMinutes: 20, deliveryEstimateMinutes: 25, maxActiveOrders: 1, cashOnDeliveryEnabled: true, cardOnDeliveryEnabled: true, paused: false, deliveryHours: '' });
    await delivery(f, { paymentMethod: 'CARD_TERMINAL' });
    await expect(delivery(f)).rejects.toMatchObject({ code: 'delivery_busy' });
    await updateDeliverySettings(f.ctx, { locationId: f.location.id, prepEstimateMinutes: 20, deliveryEstimateMinutes: 25, maxActiveOrders: 5, cashOnDeliveryEnabled: true, cardOnDeliveryEnabled: false, paused: true, deliveryHours: '' });
    await expect(delivery(f)).rejects.toMatchObject({ code: 'ordering_paused' });
  });

  it('respects delivery hours', async () => {
    const f = await createOrderingFixture();
    await zone(f);
    await updateDeliverySettings(f.ctx, { locationId: f.location.id, prepEstimateMinutes: 20, deliveryEstimateMinutes: 25, maxActiveOrders: 5, cashOnDeliveryEnabled: true, cardOnDeliveryEnabled: false, paused: false, deliveryHours: JSON.stringify(LUNCH_HOURS) });
    await expect(
      submitDeliveryOrder(
        { orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], customerName: 'Test Guest', phone: '+351900000003', address: 'Rua de Teste, 10', postalCode: '4700-123', city: 'Braga', paymentMethod: 'CASH_ON_DELIVERY' },
        'k',
        new Date('2026-11-04T20:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'ordering_closed' });
  });
});

describe('M9-07/08/11 delivery workflow and driver view', () => {
  beforeEach(resetDatabase);

  it('accept → ready → assigned driver takes it out → delivered with cash collected', async () => {
    const f = await createOrderingFixture();
    await zone(f);
    await delivery(f);
    const order = await db.order.findFirstOrThrow();
    const driverUser = await createTestUser('Driver');
    const otherUser = await createTestUser('Other driver');
    const dm = await db.restaurantMembership.create({ data: { userId: driverUser.id, organizationId: f.org.id, role: 'DELIVERY_STAFF' } });
    await db.restaurantMembership.create({ data: { userId: otherUser.id, organizationId: f.org.id, role: 'DELIVERY_STAFF' } });
    const driver = await resolveTenantAccess(driverUser.id, f.org.slug, 'delivery.driver');
    const other = await resolveTenantAccess(otherUser.id, f.org.slug, 'delivery.driver');

    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    await assignDriver(f.ctx, order.id, dm.id);
    await expect(driverUpdate(driver, order.id, 'OUT_FOR_DELIVERY')).rejects.toMatchObject({ code: 'status_conflict' }); // not ready yet
    const ticket = await db.kitchenTicket.findFirstOrThrow();
    await changeTicketStatus(f.ctx, { ticketId: ticket.id, expectedFrom: 'PENDING', to: 'READY' });
    await expect(driverUpdate(other, order.id, 'OUT_FOR_DELIVERY')).rejects.toThrow(/not assigned to you/);
    await driverUpdate(driver, order.id, 'OUT_FOR_DELIVERY');
    await driverUpdate(driver, order.id, 'DELIVERED', true);
    const done = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { delivery: true, payments: true } });
    expect(done.status).toBe('DELIVERED');
    expect(done.paymentStatus).toBe('PAID');
    expect(done.payments.map((p) => [p.method, p.amountCents])).toEqual([['CASH_ON_DELIVERY', 2040]]);
    expect(done.delivery?.outForDeliveryAt && done.delivery?.deliveredAt).toBeTruthy();
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'DELIVERED', to: 'COMPLETED' });
  });

  it('cancelling a delivery requires a reason', async () => {
    const f = await createOrderingFixture();
    await zone(f);
    await delivery(f);
    const order = await db.order.findFirstOrThrow();
    await expect(changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'CANCELLED' })).rejects.toThrow(/reason/);
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Driver unavailable' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).cancelReason).toBe('Driver unavailable');
  });

  it('zones and drivers are tenant-isolated', async () => {
    const a = await createOrderingFixture('Test A');
    const b = await createOrderingFixture('Test B');
    await zone(b);
    await delivery(b);
    const orderB = await db.order.findFirstOrThrow({ where: { organizationId: b.org.id } });
    const zoneB = await db.deliveryZone.findFirstOrThrow({ where: { organizationId: b.org.id } });
    await expect(saveDeliveryZone(a.ctx, { id: zoneB.id, locationId: b.location.id, name: 'x', patterns: '4700-*', fee: '1' })).rejects.toMatchObject({ reason: 'location' });
    await expect(assignDriver(a.ctx, orderB.id, null)).rejects.toThrow(/not found/);
  });
});
