import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { openTableSession } from '@/server/services/bills';
import { submitTableOrder } from '@/server/services/orders';
import { acquireExclusiveDb } from '../support/db-lock';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Regression tests for the 2026-10-30 audit:
 * BUG-01 — 10+ simultaneous orders starved the 10-connection pool and all failed;
 * BUG-03 — simultaneous first orders on one table opened several OPEN sessions (split bills);
 * BUG-02 — the test database must be locked for the whole run.
 */
describe('concurrent ordering (audit BUG-01, BUG-03)', () => {
  beforeEach(resetDatabase);

  it('BUG-01: 25 guests on 5 tables submit at the same moment — every order is stored, numbers unique', async () => {
    const f = await createOrderingFixture();
    const tables = [f.table];
    for (const label of ['11', '12', '13', '14']) {
      tables.push(await db.restaurantTable.create({ data: { organizationId: f.org.id, locationId: f.location.id, label, qrTokens: { create: { token: `qr_conc_${label}_${f.org.id}`.slice(0, 40) } } }, include: { qrTokens: true } }));
    }
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) =>
        submitTableOrder({ qrToken: tables[i % 5].qrTokens[0].token, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${i}`),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.map((r) => String((r as PromiseRejectedResult).reason).slice(0, 120))).toEqual([]);
    const orders = await db.order.findMany({ where: { organizationId: f.org.id }, select: { number: true } });
    expect(orders).toHaveLength(25);
    expect(new Set(orders.map((o) => o.number)).size).toBe(25);
  });

  it('BUG-03: 12 simultaneous first orders on one table share exactly one open table session', async () => {
    const f = await createOrderingFixture();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${i}`)),
    );
    const sessions = await db.tableSession.findMany({ where: { tableId: f.table.id, status: 'OPEN' }, include: { _count: { select: { orders: true } } } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]._count.orders).toBe(12);
  });

  it('BUG-03: staff opening the table while guests order never creates a second session', async () => {
    const f = await createOrderingFixture();
    await Promise.all([
      openTableSession(f.ctx, f.table.id),
      openTableSession(f.ctx, f.table.id),
      ...Array.from({ length: 4 }, (_, i) => submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `guest-${i}`)),
    ]);
    expect(await db.tableSession.count({ where: { tableId: f.table.id, status: 'OPEN' } })).toBe(1);
  });

  it('the same idempotency key submitted 6 times at once creates one order', async () => {
    const f = await createOrderingFixture();
    const key = randomUUID();
    const res = await Promise.all(Array.from({ length: 6 }, () => submitTableOrder({ qrToken: f.qrToken, idempotencyKey: key, language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'same-phone')));
    expect(new Set(res.map((r) => r.orderNumber)).size).toBe(1);
    expect(res.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await db.order.count({ where: { organizationId: f.org.id } })).toBe(1);
  });
});

describe('test database lock (audit BUG-02)', () => {
  it('a second test run cannot use menuniva_test while this run holds it', async () => {
    await expect(acquireExclusiveDb(process.env.DATABASE_URL!, 'second-run')).rejects.toThrow(/already in use by another test run/);
  });
});
