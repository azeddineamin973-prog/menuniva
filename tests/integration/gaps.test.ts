import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { publishChecks } from '@/server/services/publish';
import { updateChannelSettings } from '@/server/services/settings';
import { createTables } from '@/server/services/tables';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/** Local fixes for audit gaps GAP-04 (takeaway/delivery without hours) and GAP-05 (table limit race). */
describe('audit gaps', () => {
  beforeEach(resetDatabase);
  const channels = (locationId: string, extra: Record<string, boolean>) => ({ locationId, tableOrderingEnabled: true, takeawayEnabled: false, deliveryEnabled: false, reservationsEnabled: false, whatsappOrderingEnabled: false, orderingPaused: false, tableOrderingPolicy: 'OPEN', tablePendingOrderCap: 15, ...extra });

  it('GAP-04: takeaway/delivery cannot be switched on or published without any hours', async () => {
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { takeawayEnabled: false, deliveryEnabled: false, openingHours: undefined } });
    await expect(updateChannelSettings(f.ctx, channels(f.location.id, { takeawayEnabled: true }))).rejects.toThrow(/opening hours .*pickup hours/);
    await expect(updateChannelSettings(f.ctx, channels(f.location.id, { deliveryEnabled: true }))).rejects.toThrow(/delivery hours/);
    // A restaurant that already had takeaway on without hours is blocked at publish and warned
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { takeawayEnabled: true } });
    expect((await publishChecks(f.ctx, f.location.id)).blockers).toEqual(expect.arrayContaining([expect.stringContaining('takeaway would otherwise accept orders at any time')]));
    // With the restaurant's hours it is allowed
    const week = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '12:00', close: '22:00' }]]));
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { openingHours: week } });
    await expect(updateChannelSettings(f.ctx, channels(f.location.id, { takeawayEnabled: true, deliveryEnabled: true }))).resolves.toBeUndefined();
    expect((await publishChecks(f.ctx, f.location.id)).blockers.filter((b) => /any time/.test(b))).toEqual([]);
  });

  it('GAP-05: two parallel bulk table creations cannot exceed the plan limit together', async () => {
    const f = await createOrderingFixture(); // 1 table, Starter limit 30
    const labels = (from: number) => Array.from({ length: 20 }, (_, i) => String(from + i));
    const res = await Promise.allSettled([createTables(f.ctx, { locationId: f.location.id, labels: labels(100) }), createTables(f.ctx, { locationId: f.location.id, labels: labels(200) })]);
    expect(res.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(String((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/up to 30 tables/);
    expect(await db.restaurantTable.count({ where: { organizationId: f.org.id, isActive: true } })).toBe(21);
  });

  it('restaurants created in the DEMO environment are always labelled as demo', async () => {
    const { createRestaurant } = await import('@/server/services/organizations');
    const { env } = await import('@/server/env');
    const original = env.APP_ENV;
    (env as { APP_ENV: string }).APP_ENV = 'demo';
    try {
      const { org } = await createRestaurant({ name: 'Demo signup', country: 'PT' }, { actorUserId: null });
      expect(org.isDemo).toBe(true);
    } finally {
      (env as { APP_ENV: string }).APP_ENV = original;
    }
  });
});
