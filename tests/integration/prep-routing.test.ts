import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { submitPickupOrder } from '@/server/services/fulfilment';
import { saveProduct, setCategoryStation } from '@/server/services/menu';
import { createLocation } from '@/server/services/menu-advanced';
import { changeOrderStatus, changeTicketStatus, stationTickets } from '@/server/services/orders';
import { publishChecks, publishLocation } from '@/server/services/publish';
import { getPublicMenu } from '@/server/services/public-menu';
import { NO_PREPARATION, prepRoute } from '@/server/services/routing';
import { getSetupProgress } from '@/server/services/setup-progress';
import { assignCategoryStations, routingReview } from '@/server/services/station-assign';
import { routeProducts, saveStation } from '@/server/services/tables';
import { resolveTenantAccess, type TenantContext } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * Preparation routing per location (restaurant operations audit 2026-11-02):
 * OPS-08 — a dish with no station reached no kitchen and the order still turned READY;
 * OPS-09 — a switched-off station kept receiving tickets nobody could see;
 * and org-wide menu routing could send one location's order to another location's kitchen.
 */
type F = Awaited<ReturnType<typeof createOrderingFixture>>;

async function restaurant() {
  const f = await createOrderingFixture('Test Routing Restaurant');
  const pro = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: 'pro' } });
  await db.subscription.update({ where: { organizationId: f.org.id }, data: { planId: pro.id } });
  const { id: portoId } = await createLocation(f.ctx, { name: 'Porto test', city: 'Porto' });
  const porto = await db.restaurantLocation.update({ where: { id: portoId }, data: { isPublished: true, takeawayEnabled: true } });
  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: f.org.id } });
  const category = (name: string, data: { defaultStationId?: string | null; noPreparation?: boolean } = {}) =>
    db.menuCategory.create({ data: { organizationId: f.org.id, menuId: menu.id, ...data, translations: { create: { language: 'pt', name, status: 'SOURCE' } } } });
  const dish = (categoryId: string, name: string, data: { stationId?: string | null; noPreparation?: boolean } = {}) =>
    db.menuProduct.create({
      data: { organizationId: f.org.id, menuId: menu.id, categoryId, status: 'ACTIVE', ...data, translations: { create: [{ language: 'pt', name, status: 'SOURCE' }] }, prices: { create: [{ channel: 'DINE_IN', amountCents: 400 }, { channel: 'TAKEAWAY', amountCents: 400 }] } },
    });
  const mains = (await db.menuProduct.findUniqueOrThrow({ where: { id: f.dish.id } })).categoryId;
  const drinks = await category('Test chás', { defaultStationId: f.cafe.id });
  const sweets = await category('Test sobremesas sem estação');
  const bottles = await category('Test garrafas', { noPreparation: true });
  const mint = await dish(drinks.id, 'Test chá de menta');
  const baklava = await dish(sweets.id, 'Test baklava');
  const water = await dish(bottles.id, 'Test água 50cl');
  const soda = await dish(sweets.id, 'Test refrigerante lata', { noPreparation: true });
  let n = 0;
  const pickup = (productIds: string[], locationSlug = f.location.slug) => {
    n += 1;
    return submitPickupOrder(
      { orgSlug: f.org.slug, locationSlug, idempotencyKey: randomUUID(), language: 'pt', items: productIds.map((productId) => ({ productId, quantity: 1, modifiers: [] })), pickup: 'asap', customerName: 'Test Guest', phone: `+351 96${String(n).padStart(7, '0')}` },
      `routing-${n}`,
    );
  };
  const order = async (placed: { orderNumber: number }, locationId = f.location.id) =>
    db.order.findFirstOrThrow({ where: { locationId, number: placed.orderNumber }, include: { items: true, tickets: { include: { station: true } } } });
  const staff = async (role: 'KITCHEN_STAFF' | 'CAFE_STAFF' | 'RESTAURANT_MANAGER', locationIds: string[] = []) => {
    const u = await createTestUser(role);
    await db.restaurantMembership.create({ data: { userId: u.id, organizationId: f.org.id, role, locationIds } });
    return resolveTenantAccess(u.id, f.org.slug);
  };
  return { f, porto, mains, drinks, sweets, bottles, dish: f.dish, mint, baklava, water, soda, pickup, order, staff };
}
type R = Awaited<ReturnType<typeof restaurant>>;
const rejection = (p: Promise<unknown>) => p.then(() => 'ok').catch((e: Error) => e.message);
const accept = (ctx: TenantContext, id: string) => changeOrderStatus(ctx, { orderId: id, expectedFrom: 'NEW', to: 'ACCEPTED' });
const guestSees = async (locationId: string, productId: string) => {
  const p = (await getPublicMenu(locationId, 'pt', 'TAKEAWAY')).flatMap((c) => c.products).find((x) => x.id === productId);
  return p ? (p.available ? 'orderable' : 'unavailable') : 'hidden';
};

describe('where a dish is prepared, per location (prepRoute)', () => {
  const here = 'loc-braga';
  const st = (id: string, locationId = here, isActive = true) => ({ id, locationId, isActive });
  const cat = (defaultStation: ReturnType<typeof st> | null = null, noPreparation = false) => ({ defaultStationId: defaultStation?.id ?? null, defaultStation, noPreparation });

  it('uses the dish station first, then "no preparation", then the category', () => {
    expect(prepRoute({ stationId: 'cafe', station: st('cafe'), noPreparation: false, category: cat(st('kitchen')) }, here)).toEqual({ kind: 'station', stationId: 'cafe' });
    expect(prepRoute({ stationId: null, noPreparation: true, category: cat(st('kitchen')) }, here)).toEqual({ kind: 'none' });
    expect(prepRoute({ stationId: null, noPreparation: false, category: cat(st('kitchen')) }, here)).toEqual({ kind: 'station', stationId: 'kitchen' });
    expect(prepRoute({ stationId: null, noPreparation: false, category: cat(null, true) }, here)).toEqual({ kind: 'none' });
    expect(prepRoute({ stationId: null, noPreparation: false, category: cat() }, here)).toMatchObject({ kind: 'missing', reason: 'no_station' });
  });

  it('never falls back: a café dish whose Café is off does not go to the kitchen, and another location’s station is never used', () => {
    expect(prepRoute({ stationId: 'cafe', station: st('cafe', here, false), noPreparation: false, category: cat(st('kitchen')) }, here)).toMatchObject({ kind: 'missing', reason: 'station_off' });
    expect(prepRoute({ stationId: null, noPreparation: false, category: cat(st('porto-kitchen', 'loc-porto')) }, here)).toMatchObject({ kind: 'missing', reason: 'other_location' });
    expect(prepRoute({ stationId: 'porto-cafe', station: st('porto-cafe', 'loc-porto'), noPreparation: false, category: cat(st('kitchen')) }, here)).toMatchObject({ kind: 'missing', reason: 'other_location' });
  });
});

describe('checkout and acceptance only target switched-on stations of the order’s location', () => {
  beforeEach(resetDatabase);

  it('OPS-08: a dish that needs preparation but has no station cannot be ordered, and the guest menu says unavailable', async () => {
    const r = await restaurant();
    expect(await guestSees(r.f.location.id, r.baklava.id)).toBe('unavailable');
    expect(await rejection(r.pickup([r.dish.id, r.baklava.id]))).toBe('items_unavailable');
    expect(await db.order.count({ where: { organizationId: r.f.org.id } })).toBe(0);
  });

  it('OPS-09: while the Café is off its tea cannot be ordered (not sent to the kitchen); switching it on restores it', async () => {
    const r = await restaurant();
    await saveStation(r.f.ctx, { id: r.f.cafe.id, locationId: r.f.location.id, name: r.f.cafe.name, type: 'CAFE', isActive: false, confirmDependents: true });
    expect(await guestSees(r.f.location.id, r.mint.id)).toBe('unavailable');
    expect(await rejection(r.pickup([r.mint.id]))).toBe('items_unavailable');
    // The kitchen dish still sells, and no ticket is ever created on the switched-off station.
    const placed = await r.pickup([r.dish.id]);
    await accept(r.f.ctx, (await r.order(placed)).id);
    expect(await db.kitchenTicket.count({ where: { stationId: r.f.cafe.id } })).toBe(0);
    // Routing was kept: switching the Café back on makes the tea orderable again, at the Café.
    await saveStation(r.f.ctx, { id: r.f.cafe.id, locationId: r.f.location.id, name: r.f.cafe.name, type: 'CAFE', isActive: true });
    const tea = await r.order(await r.pickup([r.mint.id]));
    expect(tea.items[0].stationId).toBe(r.f.cafe.id);
  });

  it('two locations: a Porto order never reaches a Braga station, and Braga kitchen staff never see it', async () => {
    const r = await restaurant();
    const bragaKitchen = await r.staff('KITCHEN_STAFF', [r.f.location.id]);
    // Porto has its own kitchen but nothing is routed to it: Braga-routed dishes are not orderable there.
    const portoKitchen = await db.kitchenStation.create({ data: { organizationId: r.f.org.id, locationId: r.porto.id, name: 'Porto Kitchen', type: 'KITCHEN' } });
    expect(await guestSees(r.porto.id, r.dish.id)).toBe('unavailable');
    expect(await rejection(r.pickup([r.dish.id], r.porto.slug))).toBe('items_unavailable');
    expect(await guestSees(r.f.location.id, r.dish.id)).toBe('orderable');
    // Porto's checks name exactly what cannot be ordered there; Braga's do not.
    expect((await publishChecks(r.f.ctx, r.porto.id)).unrouted.map((u) => u.id)).toEqual(expect.arrayContaining([r.dish.id, r.mint.id]));
    expect((await publishChecks(r.f.ctx, r.f.location.id)).unrouted.map((u) => u.id)).toEqual([r.baklava.id]);
    const portoStep = (await getSetupProgress(r.f.org.id, r.porto.id)).steps.find((s) => s.key === 'kitchen')!;
    expect(portoStep.done).toBe(false);
    // No Porto order is visible on any Braga screen, and Braga staff cannot open Porto's screen.
    expect((await stationTickets(bragaKitchen, r.f.kitchen.id)).tickets).toHaveLength(0);
    await expect(stationTickets(bragaKitchen, portoKitchen.id)).rejects.toThrow();
  });

  it('a location without kitchen screens keeps the counter flow: accepted without tickets, Ready by hand', async () => {
    const r = await restaurant();
    // Porto has no station at all: every order is prepared and handed over from Live Orders.
    const placed = await r.pickup([r.dish.id, r.mint.id], r.porto.slug);
    const o = await r.order(placed, r.porto.id);
    expect(o.items.every((i) => i.stationId === null)).toBe(true);
    await accept(r.f.ctx, o.id);
    expect(await db.kitchenTicket.count({ where: { orderId: o.id } })).toBe(0);
    await changeOrderStatus(r.f.ctx, { orderId: o.id, expectedFrom: 'ACCEPTED', to: 'READY' });
    expect((await r.order(placed, r.porto.id)).items.map((i) => i.prepStatus)).toEqual(['READY', 'READY']);
    expect((await publishChecks(r.f.ctx, r.porto.id)).unrouted).toEqual([]);
  });

  it('acceptance re-checks: an order placed just before its Café was switched off is not accepted onto an invisible ticket', async () => {
    const r = await restaurant();
    const placed = await r.pickup([r.dish.id, r.mint.id]);
    const o = await r.order(placed);
    // Switched off by a concurrent request after the order was stored (bypassing the switch-off checks).
    await db.kitchenStation.update({ where: { id: r.f.cafe.id }, data: { isActive: false } });
    expect(await rejection(accept(r.f.ctx, o.id))).toMatch(/Test Café is switched off, so nobody would see 1× Test chá de menta/);
    expect(await db.kitchenTicket.count({ where: { orderId: o.id } })).toBe(0);
    expect((await r.order(placed)).status).toBe('NEW');
    // A legacy order whose item points at another location's station is refused the same way.
    await db.kitchenStation.update({ where: { id: r.f.cafe.id }, data: { isActive: true, locationId: r.porto.id } });
    expect(await rejection(accept(r.f.ctx, o.id))).toMatch(/belongs to another location/);
  });
});

describe('no-preparation items and mixed orders', () => {
  beforeEach(resetDatabase);

  it('a packaged drink (dish flag or category flag) gets no ticket and does not hold the order back', async () => {
    const r = await restaurant();
    const placed = await r.pickup([r.dish.id, r.water.id, r.soda.id]);
    const o = await r.order(placed);
    expect(o.items.filter((i) => i.stationId === null).map((i) => i.prepStatus)).toEqual(['READY', 'READY']);
    await accept(r.f.ctx, o.id);
    const after = await r.order(placed);
    expect(after.tickets.map((t) => t.station.name)).toEqual(['Test Kitchen']);
    await changeTicketStatus(r.f.ctx, { ticketId: after.tickets[0].id, expectedFrom: 'PENDING', to: 'READY' });
    expect((await r.order(placed)).status).toBe('READY');
  });

  it('OPS-08: a counter item still waiting keeps a mixed order from turning READY on its own; marking it ready confirms it', async () => {
    const r = await restaurant();
    const placed = await r.pickup([r.dish.id]);
    const o = await r.order(placed);
    // An item stored before this fix with no station (or while the location had no screens).
    await db.orderItem.create({ data: { orderId: o.id, organizationId: r.f.org.id, nameSnapshot: 'Test baklava (legacy)', unitPriceCents: 400, quantity: 1, lineTotalCents: 400 } });
    await accept(r.f.ctx, o.id);
    const t = (await r.order(placed)).tickets[0];
    await changeTicketStatus(r.f.ctx, { ticketId: t.id, expectedFrom: 'PENDING', to: 'READY' });
    expect((await r.order(placed)).status).toBe('PREPARING');
    await changeOrderStatus(r.f.ctx, { orderId: o.id, expectedFrom: 'PREPARING', to: 'READY' });
    const done = await r.order(placed);
    expect(done.status).toBe('READY');
    expect(done.items.map((i) => i.prepStatus)).toEqual(['READY', 'READY']);
  });

  it('marking ready by hand is still refused while a station is working', async () => {
    const r = await restaurant();
    const placed = await r.pickup([r.dish.id, r.water.id]);
    const o = await r.order(placed);
    await accept(r.f.ctx, o.id);
    await expect(changeOrderStatus(r.f.ctx, { orderId: o.id, expectedFrom: 'ACCEPTED', to: 'READY' })).rejects.toThrow(/stations are still preparing/);
  });
});

describe('switching a station off safely', () => {
  beforeEach(resetDatabase);
  const off = (r: R, extra: Record<string, unknown> = {}) => saveStation(r.f.ctx, { id: r.f.cafe.id, locationId: r.f.location.id, name: r.f.cafe.name, type: 'CAFE', isActive: false, ...extra });

  it('is refused while an accepted ticket or a new order still needs it', async () => {
    const r = await restaurant();
    const placed = await r.pickup([r.mint.id]);
    expect(await rejection(off(r, { confirmDependents: true }))).toMatch(/still has open orders \(#\d+\)/);
    await accept(r.f.ctx, (await r.order(placed)).id);
    expect(await rejection(off(r, { confirmDependents: true }))).toMatch(/still has open orders/);
    expect((await db.kitchenStation.findUniqueOrThrow({ where: { id: r.f.cafe.id } })).isActive).toBe(true);
  });

  it('asks for a confirmation when dishes depend on it, and keeps their routing', async () => {
    const r = await restaurant();
    expect(await rejection(off(r))).toMatch(/\d+ dishes are prepared at Test Café\. While it is off, guests cannot order them at this location; nothing is sent to another station/);
    // One dependent dish reads in the singular.
    await db.menuProduct.updateMany({ where: { organizationId: r.f.org.id, id: { not: r.mint.id }, OR: [{ stationId: r.f.cafe.id }, { category: { defaultStationId: r.f.cafe.id } }] }, data: { status: 'ARCHIVED' } });
    expect(await rejection(off(r))).toMatch(/^1 dish is prepared at Test Café\. While it is off, guests cannot order it/);
    await off(r, { confirmDependents: true });
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: r.drinks.id } })).defaultStationId).toBe(r.f.cafe.id);
  });

  it('warns that the last station off means Live Orders only', async () => {
    const r = await restaurant();
    await off(r, { confirmDependents: true });
    expect(await rejection(saveStation(r.f.ctx, { id: r.f.kitchen.id, locationId: r.f.location.id, name: r.f.kitchen.name, type: 'KITCHEN', isActive: false }))).toMatch(/last kitchen screen at this location/);
  });

  it('a manager limited to one location cannot switch off or rename another location’s station', async () => {
    const r = await restaurant();
    const portoKitchen = await db.kitchenStation.create({ data: { organizationId: r.f.org.id, locationId: r.porto.id, name: 'Porto Kitchen', type: 'KITCHEN' } });
    const bragaManager = await r.staff('RESTAURANT_MANAGER', [r.f.location.id]);
    expect(await rejection(saveStation(bragaManager, { id: portoKitchen.id, locationId: r.f.location.id, name: 'renamed', type: 'KITCHEN', isActive: false, confirmDependents: true }))).toBe('Station not found.');
    await expect(saveStation(bragaManager, { id: portoKitchen.id, locationId: r.porto.id, name: 'renamed', type: 'KITCHEN', isActive: false, confirmDependents: true })).rejects.toThrow();
    expect(await db.kitchenStation.findUniqueOrThrow({ where: { id: portoKitchen.id } })).toMatchObject({ name: 'Porto Kitchen', isActive: true });
  });
});

describe('routing setters', () => {
  beforeEach(resetDatabase);

  it('refuse a switched-off station for a new assignment, but keep an existing one when the dish is saved', async () => {
    const r = await restaurant();
    await db.menuProduct.update({ where: { id: r.mint.id }, data: { stationId: r.f.cafe.id } });
    await db.kitchenStation.update({ where: { id: r.f.cafe.id }, data: { isActive: false } });
    const switchedOff = /Test Café is switched off/;
    expect(await rejection(routeProducts(r.f.ctx, r.f.cafe.id, [r.baklava.id]))).toMatch(switchedOff);
    expect(await rejection(setCategoryStation(r.f.ctx, r.sweets.id, r.f.cafe.id))).toMatch(switchedOff);
    expect(await rejection(assignCategoryStations(r.f.ctx, { assignments: [{ categoryId: r.sweets.id, stationId: r.f.cafe.id }] }))).toMatch(switchedOff);
    // Editing the tea's price while the Café is off keeps its routing.
    await saveProduct(r.f.ctx, { id: r.mint.id, categoryId: r.drinks.id, stationId: r.f.cafe.id, status: 'ACTIVE', translations: { pt: { name: 'Test chá de menta' } }, prices: { DINE_IN: '4,50' } });
    expect((await db.menuProduct.findUniqueOrThrow({ where: { id: r.mint.id } })).stationId).toBe(r.f.cafe.id);
  });

  it('a location’s routing screen only uses its own stations and never rewrites another location’s routing', async () => {
    const r = await restaurant();
    const portoKitchen = await db.kitchenStation.create({ data: { organizationId: r.f.org.id, locationId: r.porto.id, name: 'Porto Kitchen', type: 'KITCHEN' } });
    expect(await rejection(assignCategoryStations(r.f.ctx, { locationId: r.porto.id, assignments: [{ categoryId: r.sweets.id, stationId: r.f.kitchen.id }] }))).toBe('Choose a station of this location.');
    expect(await rejection(assignCategoryStations(r.f.ctx, { locationId: r.porto.id, assignments: [{ categoryId: r.drinks.id, stationId: portoKitchen.id }] }))).toMatch(/station of another location/);
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: r.drinks.id } })).defaultStationId).toBe(r.f.cafe.id);
    // Porto's review shows Braga-routed categories as read-only, never pre-filled with a Porto station.
    const porto = await routingReview(r.f.ctx, r.porto.id);
    expect(porto.categories.find((c) => c.categoryId === r.drinks.id)).toMatchObject({ current: 'other_location', editable: false, formDefault: '' });
    // Bulk dish routing from Porto leaves a dish routed to a Braga station alone.
    await db.menuProduct.update({ where: { id: r.mint.id }, data: { stationId: r.f.cafe.id } });
    expect(await routeProducts(r.f.ctx, portoKitchen.id, [r.mint.id, r.baklava.id], r.porto.id)).toBe(1);
    expect((await db.menuProduct.findUniqueOrThrow({ where: { id: r.mint.id } })).stationId).toBe(r.f.cafe.id);
    expect(await rejection(routeProducts(r.f.ctx, r.f.kitchen.id, [r.baklava.id], r.porto.id))).toBe('Choose a station of this location.');
  });

  it('a suggestion never replaces a routing the restaurant chose (a café pastry category stays at the Café)', async () => {
    const r = await restaurant();
    const pastry = await db.menuCategory.create({ data: { organizationId: r.f.org.id, menuId: (await db.menu.findFirstOrThrow({ where: { organizationId: r.f.org.id } })).id, defaultStationId: r.f.cafe.id, translations: { create: { language: 'pt', name: 'Pastelaria', status: 'SOURCE' } } } });
    const review = await routingReview(r.f.ctx, r.f.location.id);
    const row = review.categories.find((c) => c.categoryId === pastry.id)!;
    expect(row.suggestedStationId).toBe(r.f.kitchen.id); // "desserts" → kitchen, by name
    expect(row.formDefault).toBe(r.f.cafe.id); // …but the form keeps the Café
    expect(review.categories.find((c) => c.categoryId === r.sweets.id)?.formDefault).toBe(r.f.kitchen.id); // nothing chosen yet: suggestion offered
  });

  it('"No preparation" can be set per dish and per category, and ends when a station is chosen', async () => {
    const r = await restaurant();
    await routeProducts(r.f.ctx, NO_PREPARATION, [r.baklava.id], r.f.location.id);
    expect(await db.menuProduct.findUniqueOrThrow({ where: { id: r.baklava.id } })).toMatchObject({ stationId: null, noPreparation: true });
    expect(await guestSees(r.f.location.id, r.baklava.id)).toBe('orderable');
    await routeProducts(r.f.ctx, r.f.kitchen.id, [r.baklava.id], r.f.location.id);
    expect(await db.menuProduct.findUniqueOrThrow({ where: { id: r.baklava.id } })).toMatchObject({ stationId: r.f.kitchen.id, noPreparation: false });
    await assignCategoryStations(r.f.ctx, { locationId: r.f.location.id, assignments: [{ categoryId: r.sweets.id, stationId: null, noPreparation: true }] });
    expect(await db.menuCategory.findUniqueOrThrow({ where: { id: r.sweets.id } })).toMatchObject({ defaultStationId: null, noPreparation: true });
    await setCategoryStation(r.f.ctx, r.sweets.id, r.f.kitchen.id);
    expect(await db.menuCategory.findUniqueOrThrow({ where: { id: r.sweets.id } })).toMatchObject({ defaultStationId: r.f.kitchen.id, noPreparation: false });
  });

  it('another restaurant’s station is refused everywhere', async () => {
    const r = await restaurant();
    const other: F = await createOrderingFixture('Other Test Restaurant');
    expect(await rejection(routeProducts(r.f.ctx, other.kitchen.id, [r.baklava.id]))).toBe('Station not found.');
    expect(await rejection(setCategoryStation(r.f.ctx, r.sweets.id, other.kitchen.id))).toBe('Invalid station.');
    expect(await rejection(assignCategoryStations(r.f.ctx, { assignments: [{ categoryId: r.sweets.id, stationId: other.kitchen.id }] }))).toBe('Invalid station.');
  });
});

describe('publishing a location with dishes no station prepares', () => {
  beforeEach(resetDatabase);

  it('needs an explicit OK, and says the dishes stay unavailable to guests', async () => {
    const r = await restaurant();
    const week = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '08:00', close: '23:00' }]]));
    await db.restaurantLocation.update({ where: { id: r.f.location.id }, data: { isPublished: false, addressLine1: 'Rua Teste 1', city: 'Braga', phone: '+351 200 000 000', openingHours: week } });
    const checks = await publishChecks(r.f.ctx, r.f.location.id);
    expect(checks.warnings.join(' ')).toMatch(/1 visible dishes have no switched-on station at this location, so guests cannot order them here: Test baklava/);
    expect(await rejection(publishLocation(r.f.ctx, r.f.location.id, true))).toMatch(/guests cannot order them here/);
    await publishLocation(r.f.ctx, r.f.location.id, true, true);
    expect((await db.restaurantLocation.findUniqueOrThrow({ where: { id: r.f.location.id } })).isPublished).toBe(true);
  });
});
