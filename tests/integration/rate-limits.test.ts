import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { submitTableOrder, TABLE_ORDER_LIMITS } from '@/server/services/orders';
import { submitPickupOrder } from '@/server/services/fulfilment';
import { RateLimitError } from '@/server/rate-limit';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';
import { awaitFreshWindow } from '../support/rate-window';

/**
 * Audit BUG-05: guests on one restaurant Wi-Fi with the same phone model must not block each
 * other, while one abusive client is still stopped.
 */
const WIFI = 'ip_restaurant-public-address';
// awaitFreshWindow may wait up to 60 s for the next limit window before the test starts filling it; the
// default 30 s test timeout made these tests fail whenever they ran in the last minute of a window.
const WAITS_FOR_WINDOW = 120_000;
async function tables(f: Awaited<ReturnType<typeof createOrderingFixture>>, n: number) {
  const out = [f.qrToken];
  for (let i = 1; i < n; i++) {
    const t = await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label: `W${i}`, qrTokens: { create: { token: `qr_w${i}_${f.org.id}`.slice(0, 40) } } }, include: { qrTokens: true } });
    out.push(t.qrTokens[0].token);
  }
  return out;
}
const order = (qrToken: string, who: { guest: string; ip: string | null }, f: Awaited<ReturnType<typeof createOrderingFixture>>) =>
  submitTableOrder({ qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, who);

describe('public order throttling (audit BUG-05)', () => {
  beforeEach(resetDatabase);

  it('40 guests behind one public IP, 2 orders each, 10 tables, at the same moment: nobody is refused', async () => {
    const f = await createOrderingFixture();
    const qr = await tables(f, 10);
    const jobs = Array.from({ length: 80 }, (_, i) => order(qr[i % 10], { guest: `g_guest${i % 40}`, ip: WIFI }, f));
    const res = await Promise.allSettled(jobs);
    expect(res.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    expect(await db.order.count({ where: { organizationId: f.org.id } })).toBe(80);
  });

  it('one guest is limited to 10 orders per 10 minutes; others on the same Wi-Fi continue', async () => {
    const f = await createOrderingFixture();
    const qr = await tables(f, 2);
    for (let i = 0; i < TABLE_ORDER_LIMITS.guest[0]; i++) await order(qr[0], { guest: 'g_busy', ip: WIFI }, f);
    await expect(order(qr[0], { guest: 'g_busy', ip: WIFI }, f)).rejects.toBeInstanceOf(RateLimitError);
    await expect(order(qr[1], { guest: 'g_other', ip: WIFI }, f)).resolves.toMatchObject({ duplicate: false });
  });

  it('a client that keeps deleting its cookie is still stopped by the per-IP limit and the overflow is reported', async () => {
    const f = await createOrderingFixture();
    // Throttling under test, not the pending-approval cap (secure-table-sessions.test.ts covers that).
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tablePendingOrderCap: 50 } });
    const qr = await tables(f, 6);
    const ipLimit = TABLE_ORDER_LIMITS.ip[0];
    // 150 orders take a few seconds; 60 s of window left is ample headroom.
    await awaitFreshWindow(TABLE_ORDER_LIMITS.ip[1], 60_000);
    for (let i = 0; i < ipLimit; i++) await order(qr[i % 6], { guest: `g_fresh${i}`, ip: 'ip_attacker' }, f);
    await expect(order(qr[0], { guest: 'g_fresh-next', ip: 'ip_attacker' }, f)).rejects.toBeInstanceOf(RateLimitError);
    const abuse = await db.errorLog.findMany({ where: { source: 'abuse' } });
    expect(abuse.map((a) => a.message)).toEqual([expect.stringContaining('Rate limit exceeded')]);
    expect(JSON.stringify(abuse)).not.toContain('attacker-real-ip');
  }, WAITS_FOR_WINDOW);

  it('without a trusted IP (no proxy configured) the per-table limit still caps one table', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { tablePendingOrderCap: 50 } });
    const [limit] = TABLE_ORDER_LIMITS.table;
    await awaitFreshWindow(TABLE_ORDER_LIMITS.table[1], 60_000);
    for (let i = 0; i < limit; i++) await order(f.qrToken, { guest: `g_anon${i}`, ip: null }, f);
    await expect(order(f.qrToken, { guest: 'g_anon-x', ip: null }, f)).rejects.toBeInstanceOf(RateLimitError);
  }, WAITS_FOR_WINDOW);

  it('retrying with the same idempotency key never consumes the limit nor creates a second order', async () => {
    const f = await createOrderingFixture();
    const key = randomUUID();
    const body = { qrToken: f.qrToken, idempotencyKey: key, language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] };
    for (let i = 0; i < 25; i++) await submitTableOrder(body, { guest: 'g_retry', ip: WIFI });
    expect(await db.order.count({ where: { organizationId: f.org.id } })).toBe(1);
    // The 25 retries used none of the phone's 10 orders per 10 minutes: its next order goes through.
    await expect(submitTableOrder({ ...body, idempotencyKey: randomUUID() }, { guest: 'g_retry', ip: WIFI })).resolves.toMatchObject({ duplicate: false });
  });

  it('takeaway: many guests from one Wi-Fi are fine; one phone number is capped', async () => {
    const f = await createOrderingFixture();
    const pickup = (i: number, phone: string) =>
      submitPickupOrder({ orgSlug: f.org.slug, locationSlug: f.location.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], pickup: 'asap', customerName: `Guest ${i}`, phone }, { guest: `g_tk${i}`, ip: WIFI });
    const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => pickup(i, `+351 91${String(i).padStart(7, '0')}`)));
    expect(res.filter((r) => r.status === 'rejected')).toEqual([]);
    await awaitFreshWindow(3600, 60_000);
    for (let i = 0; i < 8; i++) await pickup(100 + i, '+351 912 345 678');
    await expect(pickup(200, '+351912345678')).rejects.toBeInstanceOf(RateLimitError);
  }, WAITS_FOR_WINDOW);
});
