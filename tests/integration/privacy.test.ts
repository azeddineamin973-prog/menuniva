import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { submitFeedback } from '@/server/services/feedback';
import { submitPickupOrder } from '@/server/services/fulfilment';
import { enrolFromOrder, updateLoyaltyProgram } from '@/server/services/loyalty';
import { applyRetention, ERASED, eraseGuestData, exportGuestData, findGuestData, parseGuestKey, updateRetention } from '@/server/services/privacy';
import { requestReservation, updateReservationSettings } from '@/server/services/reservations';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const PHONE = '+351 912 345 678';
const pickup = (f: F, phone = PHONE) =>
  submitPickupOrder({ orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [], notes: 'sem cebola' }], pickup: 'asap', customerName: 'Ana Guest', phone, notes: 'Ring the bell' }, `k${Math.random()}`);

async function guestEverywhere(f: F) {
  const o = await pickup(f);
  await updateLoyaltyProgram(f.ctx, { enabled: true, type: 'STAMPS', stampsForReward: 5, pointsPerEuro: 1, rewardText: 'Test reward', expiryDays: '' });
  await enrolFromOrder({ orderToken: o.trackingToken, phone: '00351912345678', consent: true, name: 'Ana' }, 'k1');
  await submitFeedback({ orgSlug: f.org.slug, rating: 2, language: 'pt', wantsFollowUp: true, contactName: 'Ana', contactInfo: '912 345 678' }, 'k2');
  await submitFeedback({ orgSlug: f.org.slug, rating: 3, language: 'pt', wantsFollowUp: true, contactInfo: 'ana@example.test' }, 'k3');
  await db.restaurantLocation.update({ where: { id: f.location.id }, data: { reservationsEnabled: true } });
  await updateReservationSettings(f.ctx, { locationId: f.location.id, slotMinutes: 30, durationMinutes: 90, bufferMinutes: 15, maxPartySize: 8, maxCoversPerSlot: 10, minNoticeMinutes: 60, maxDaysAhead: 30, bookableHours: JSON.stringify({ fri: [{ open: '19:00', close: '23:00' }] }) });
  await requestReservation({ orgSlug: f.org.slug, date: '2026-11-06', time: '20:00', partySize: 2, name: 'Ana Guest', phone: '912345678', email: 'ANA@example.test', idempotencyKey: randomUUID(), language: 'pt' }, 'k4', new Date('2026-11-04T10:00:00Z'));
  return o;
}

describe('M13-02 GDPR access, erasure and retention', () => {
  beforeEach(resetDatabase);

  it('identifiers: phone in any format (≥ 9 digits) or email', () => {
    expect(parseGuestKey('+351 912-345-678')).toEqual({ kind: 'phone', digits: '351912345678' });
    expect(parseGuestKey(' Ana@Example.test ')).toEqual({ kind: 'email', email: 'ana@example.test' });
    expect(() => parseGuestKey('1234')).toThrow();
    expect(() => parseGuestKey('not@valid')).toThrow();
  });

  it('finds and exports everything linked to a phone number, whatever its formatting', async () => {
    const f = await createOrderingFixture();
    await guestEverywhere(f);
    await pickup(f, '+351 933 000 000'); // someone else
    expect(await findGuestData(f.ctx, '912345678')).toEqual({ orders: 1, reservations: 1, feedback: 1, loyalty: 1 });
    expect(await findGuestData(f.ctx, 'ana@example.test')).toEqual({ orders: 0, reservations: 1, feedback: 1, loyalty: 0 });
    const data = await exportGuestData(f.ctx, PHONE);
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({ customerName: 'Ana Guest', customerNotes: 'Ring the bell' });
    expect(data.orders[0].items[0]).toMatchObject({ notes: 'sem cebola', quantity: 1 });
    expect(data.reservations[0]).toMatchObject({ name: 'Ana Guest', partySize: 2 });
    expect(data.loyalty[0]).toMatchObject({ name: 'Ana', marketingOptIn: false });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'privacy.data_exported' } });
    expect(JSON.stringify(log.metadata)).not.toMatch(/912|ana@/i); // identifier is never logged
  });

  it('erasure anonymises personal data but keeps amounts; requires typing ERASE; other guests untouched', async () => {
    const f = await createOrderingFixture();
    await guestEverywhere(f);
    await pickup(f, '+351 933 000 000');
    await expect(eraseGuestData(f.ctx, PHONE, 'yes')).rejects.toThrow(/ERASE/);
    expect(await eraseGuestData(f.ctx, PHONE, 'erase')).toEqual({ orders: 1, reservations: 1, feedback: 1, loyalty: 1 });
    const mine = await db.order.findFirstOrThrow({ where: { number: 1 }, include: { items: true } });
    expect(mine).toMatchObject({ customerName: null, customerPhone: null, customerNotes: null, totalCents: 1590 });
    expect(mine.items[0]).toMatchObject({ notes: null, quantity: 1 });
    expect(await db.reservation.findFirstOrThrow()).toMatchObject({ name: ERASED, phone: ERASED, email: null });
    expect(await db.customerFeedback.count({ where: { contactInfo: { not: null } } })).toBe(1); // the email-only follow-up remains
    expect(await db.loyaltyAccount.findFirstOrThrow()).toMatchObject({ name: null, deletedAt: expect.any(Date) });
    expect((await db.order.findFirstOrThrow({ where: { number: 2 } })).customerPhone).toBe('+351 933 000 000');
    expect(await findGuestData(f.ctx, PHONE)).toEqual({ orders: 0, reservations: 0, feedback: 0, loyalty: 0 });
    expect(await eraseGuestData(f.ctx, 'ana@example.test', 'ERASE')).toMatchObject({ feedback: 1 });
  });

  it('TEST 15 (guest data): another restaurant cannot find, export or erase this guest', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await pickup(a);
    expect(await findGuestData(b.ctx, PHONE)).toEqual({ orders: 0, reservations: 0, feedback: 0, loyalty: 0 });
    expect((await exportGuestData(b.ctx, PHONE)).orders).toHaveLength(0);
    await eraseGuestData(b.ctx, PHONE, 'ERASE');
    expect((await db.order.findFirstOrThrow({ where: { organizationId: a.org.id } })).customerPhone).toBe(PHONE);
  });

  it('retention erases only finished records older than the restaurant’s period, and cleans expired security records', async () => {
    const f = await createOrderingFixture();
    await updateRetention(f.ctx, 90);
    await expect(updateRetention(f.ctx, 5)).rejects.toThrow();
    await pickup(f);
    await pickup(f, '+351 933 000 000');
    const [old, open] = await db.order.findMany({ orderBy: { number: 'asc' } });
    await db.order.update({ where: { id: old.id }, data: { status: 'COMPLETED', createdAt: new Date(Date.now() - 100 * 86400_000) } });
    await db.order.update({ where: { id: open.id }, data: { createdAt: new Date(Date.now() - 100 * 86400_000) } }); // still NEW → kept
    await db.session.create({ data: { userId: f.owner.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() - 1000) } });
    const r = await applyRetention();
    expect(r.guestData.orders).toBe(1);
    expect(r.platform.sessions).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: old.id } })).customerPhone).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: open.id } })).customerPhone).toBe('+351 933 000 000');
    expect((await applyRetention()).guestData.orders).toBe(0); // idempotent
    expect(await db.auditLog.count({ where: { action: 'privacy.retention_applied' } })).toBe(1);
  });
});
