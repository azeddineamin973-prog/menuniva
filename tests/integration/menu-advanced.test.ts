import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { createLocation, deleteTaxClass, saveLocationOverride, saveSchedule, saveTaxClass } from '@/server/services/menu-advanced';
import { saveProduct } from '@/server/services/menu';
import { submitTableOrder } from '@/server/services/orders';
import { getPublicMenu } from '@/server/services/public-menu';
import { quoteCart } from '@/server/services/pricing';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

// Wednesday 2026-11-04 13:00 and 20:00 in Europe/Lisbon (UTC+0 in November)
const LUNCH = new Date('2026-11-04T13:00:00Z');
const DINNER = new Date('2026-11-04T20:00:00Z');

describe('M4-05 location price overrides', () => {
  beforeEach(resetDatabase);

  it('uses the location price when set and the base price when empty; can hide a dish per location', async () => {
    const f = await createOrderingFixture();
    const items = [{ productId: f.dish.id, quantity: 1, modifiers: [] }];
    await saveLocationOverride(f.ctx, { productId: f.dish.id, locationId: f.location.id, isAvailable: true, soldOut: false, dineIn: '18,00', takeaway: '', delivery: '' });
    expect((await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items })).subtotalCents).toBe(1800);
    expect((await quoteCart({ locationId: f.location.id, channel: 'TAKEAWAY', lang: 'pt', items })).subtotalCents).toBe(1590);
    await saveLocationOverride(f.ctx, { productId: f.dish.id, locationId: f.location.id, isAvailable: false, soldOut: false, dineIn: '', takeaway: '', delivery: '' });
    expect((await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items })).issues[0].code).toBe('unavailable');
    const menu = await getPublicMenu(f.location.id, 'pt', 'TABLE');
    expect(menu.flatMap((c) => c.products).some((p) => p.id === f.dish.id)).toBe(false);
  });

  it('imported platform prices are reference data and never change in-house prices', async () => {
    const f = await createOrderingFixture();
    await db.externalSourcePrice.create({ data: { productId: f.dish.id, provider: 'GLOVO', amountCents: 1990 } });
    const q = await quoteCart({ locationId: f.location.id, channel: 'DELIVERY', lang: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] });
    expect(q.subtotalCents).toBe(1790);
  });

  it('rejects an override for a location of another tenant', async () => {
    const a = await createOrderingFixture('Test A');
    const b = await createOrderingFixture('Test B');
    await expect(saveLocationOverride(a.ctx, { productId: a.dish.id, locationId: b.location.id, isAvailable: false, soldOut: false, dineIn: '', takeaway: '', delivery: '' })).rejects.toMatchObject({ reason: 'location' });
  });
});

describe('M4-08 availability schedules', () => {
  beforeEach(resetDatabase);

  it('hides and blocks a lunch-only dish outside its hours (menu AND server pricing)', async () => {
    const f = await createOrderingFixture();
    await saveSchedule(f.ctx, { target: 'product', id: f.dish.id, ranges: [{ days: [1, 2, 3, 4, 5], start: '12:00', end: '15:00' }] });
    const items = [{ productId: f.dish.id, quantity: 1, modifiers: [] }];
    expect((await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items, now: LUNCH })).issues).toEqual([]);
    expect((await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items, now: DINNER })).issues[0].code).toBe('unavailable');
    const dinnerMenu = await getPublicMenu(f.location.id, 'pt', 'TABLE', DINNER);
    expect(dinnerMenu.flatMap((c) => c.products).find((p) => p.id === f.dish.id)?.available).toBe(false);
    await saveSchedule(f.ctx, { target: 'product', id: f.dish.id, ranges: [] });
    expect((await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items, now: DINNER })).issues).toEqual([]);
  });

  it('category schedules apply to every dish in the category', async () => {
    const f = await createOrderingFixture();
    const tea = await db.menuProduct.findUniqueOrThrow({ where: { id: f.tea.id } });
    await saveSchedule(f.ctx, { target: 'category', id: tea.categoryId, ranges: [{ days: [3], start: '19:00', end: '23:00' }] });
    const items = [{ productId: f.tea.id, quantity: 1, modifiers: [{ optionId: f.sugar.id, quantity: 1 }] }];
    expect((await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items, now: LUNCH })).issues[0]?.code).toBe('unavailable');
    expect((await quoteCart({ locationId: f.location.id, channel: 'TABLE', lang: 'pt', items, now: DINNER })).issues).toEqual([]);
  });

  it('rejects invalid ranges', async () => {
    const f = await createOrderingFixture();
    await expect(saveSchedule(f.ctx, { target: 'product', id: f.dish.id, ranges: [{ days: [1], start: '15:00', end: '12:00' }] })).rejects.toThrow(/end after it starts/);
  });

  it('a real order for a scheduled dish is refused outside its hours', async () => {
    const f = await createOrderingFixture();
    const now = new Date();
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    // Schedule a window that certainly excludes "now" (location is Europe/Lisbon; pick a 1-minute window 12 h away)
    const start = (minute + 720) % 1440;
    const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    await saveSchedule(f.ctx, { target: 'product', id: f.dish.id, ranges: [{ days: [0, 1, 2, 3, 4, 5, 6], start: t(Math.min(start, 1438)), end: t(Math.min(start, 1438) + 1) }] });
    await expect(submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'ip')).rejects.toMatchObject({ code: 'items_unavailable' });
  });
});

describe('M4-14 tax classes', () => {
  beforeEach(resetDatabase);

  it('stores restaurant-approved rates in basis points; unapproved classes cannot be assigned to dishes in the UI list', async () => {
    const f = await createOrderingFixture();
    await saveTaxClass(f.ctx, { name: 'IVA intermédia', rate: '13', approved: true });
    await saveTaxClass(f.ctx, { name: 'IVA normal', rate: '23', approved: false });
    const classes = await db.taxClass.findMany({ where: { organizationId: f.org.id }, orderBy: { rateBasisPoints: 'asc' } });
    expect(classes.map((c) => [c.rateBasisPoints, !!c.approvedAt])).toEqual([[1300, true], [2300, false]]);
    await expect(saveTaxClass(f.ctx, { name: 'Wrong', rate: '75', approved: true })).rejects.toThrow(/too high/);
    const dish = await db.menuProduct.findUniqueOrThrow({ where: { id: f.dish.id } });
    await saveProduct(f.ctx, { id: dish.id, categoryId: dish.categoryId, taxClassId: classes[0].id, status: 'ACTIVE', translations: { pt: { name: 'Test dish' } }, prices: {} });
    expect((await db.menuProduct.findUniqueOrThrow({ where: { id: f.dish.id } })).taxClassId).toBe(classes[0].id);
    await expect(deleteTaxClass(f.ctx, classes[0].id)).rejects.toThrow(/used by dishes/);
  });

  it('cannot assign another tenant’s tax class', async () => {
    const a = await createOrderingFixture('Test A');
    const b = await createOrderingFixture('Test B');
    await saveTaxClass(b.ctx, { name: 'B rate', rate: '10', approved: true });
    const tc = await db.taxClass.findFirstOrThrow({ where: { organizationId: b.org.id } });
    const dish = await db.menuProduct.findUniqueOrThrow({ where: { id: a.dish.id } });
    await expect(saveProduct(a.ctx, { id: dish.id, categoryId: dish.categoryId, taxClassId: tc.id, translations: { pt: { name: 'x' } }, prices: {} })).rejects.toThrow(/Invalid tax class/);
  });
});

describe('M3-07 multi-location', () => {
  beforeEach(resetDatabase);

  it('respects the plan location limit and creates complete locations', async () => {
    const f = await createOrderingFixture();
    await expect(createLocation(f.ctx, { name: 'Second branch' })).rejects.toThrow(/plan includes 1 location/);
    const pro = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: 'pro' } });
    await db.subscription.update({ where: { organizationId: f.org.id }, data: { planId: pro.id } });
    const { id } = await createLocation(f.ctx, { name: 'Second branch', city: 'Porto' });
    const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id }, include: { takeawaySettings: true, reviewSettings: true } });
    expect(loc.slug).toBe('second-branch');
    expect(loc.timeZone).toBe('Europe/Lisbon');
    expect(loc.isPublished).toBe(false);
    expect(loc.takeawaySettings && loc.reviewSettings).toBeTruthy();
  });
});
