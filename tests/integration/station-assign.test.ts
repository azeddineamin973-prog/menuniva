import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { changeOrderStatus, stationTickets, submitTableOrder } from '@/server/services/orders';
import { assignCategoryStations, createStations, routingReview } from '@/server/services/station-assign';
import { getSetupProgress } from '@/server/services/setup-progress';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;

/** A category with one dish and no station, as an import leaves it. */
async function unroutedCategory(f: F, name: string) {
  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: f.org.id } });
  const category = await db.menuCategory.create({
    data: { organizationId: f.org.id, menuId: menu.id, translations: { create: { language: 'pt', name, status: 'SOURCE' } } },
  });
  const product = await db.menuProduct.create({
    data: {
      organizationId: f.org.id,
      menuId: menu.id,
      categoryId: category.id,
      status: 'ACTIVE',
      origin: 'IMPORTED',
      translations: { create: { language: 'pt', name: `${name} dish`, status: 'SOURCE' } },
      prices: { create: { channel: 'DINE_IN', amountCents: 500 } },
    },
  });
  return { category, product };
}

describe('routing a whole menu to stations', () => {
  beforeEach(resetDatabase);

  it('suggests café for drinks and the kitchen for food, and says what is already right', async () => {
    const f = await createOrderingFixture();
    const drinks = await unroutedCategory(f, 'Bebidas');
    const food = await unroutedCategory(f, 'Tajines');
    const review = await routingReview(f.ctx, f.location.id);

    const byId = new Map(review.categories.map((c) => [c.categoryId, c]));
    expect(byId.get(drinks.category.id)).toMatchObject({ suggestedType: 'CAFE', suggestedStationId: f.cafe.id, currentStationId: null });
    expect(byId.get(food.category.id)).toMatchObject({ suggestedType: 'KITCHEN', suggestedStationId: f.kitchen.id, currentStationId: null });
    // The fixture's own categories already have stations, so nothing is suggested for them.
    expect(review.assignable).toBe(2);
    expect(review.unassignedProducts).toBe(2);
  });

  it('assigns every category in one submit, and the dishes reach the right screen', async () => {
    const f = await createOrderingFixture();
    const drinks = await unroutedCategory(f, 'Chá e café');
    const food = await unroutedCategory(f, 'Tajines');
    const review = await routingReview(f.ctx, f.location.id);
    const res = await assignCategoryStations(f.ctx, {
      assignments: review.categories.map((c) => ({ categoryId: c.categoryId, stationId: c.suggestedStationId ?? c.currentStationId })),
    });
    expect(res.categories).toBeGreaterThanOrEqual(2);
    expect((await routingReview(f.ctx, f.location.id)).unassignedProducts).toBe(0);

    // A real order proves the routing: each board sees only its own items.
    await submitTableOrder(
      { qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: food.product.id, quantity: 1, modifiers: [] }, { productId: drinks.product.id, quantity: 1, modifiers: [] }] },
      `k${Math.random()}`,
    );
    const order = await db.order.findFirstOrThrow({ include: { items: true } });
    expect(order.items.every((i) => i.stationId)).toBe(true);
    // Station boards only show accepted orders, so staff accept it first.
    await changeOrderStatus(f.ctx, { orderId: order.id, to: 'ACCEPTED', expectedFrom: 'NEW' });
    const kitchen = await stationTickets(f.ctx, f.kitchen.id);
    const cafe = await stationTickets(f.ctx, f.cafe.id);
    expect(kitchen.tickets[0].order.items.map((i) => i.nameSnapshot)).toEqual(['Tajines dish']);
    expect(cafe.tickets[0].order.items.map((i) => i.nameSnapshot)).toEqual(['Chá e café dish']);
  });

  it('keeps a dish that was routed by hand', async () => {
    const f = await createOrderingFixture();
    const drinks = await unroutedCategory(f, 'Bebidas');
    // This one dish is prepared in the kitchen even though its category is drinks.
    await db.menuProduct.update({ where: { id: drinks.product.id }, data: { stationId: f.kitchen.id } });
    const review = await routingReview(f.ctx, f.location.id);
    expect(review.categories.find((c) => c.categoryId === drinks.category.id)?.overridden).toBe(1);
    await assignCategoryStations(f.ctx, { assignments: [{ categoryId: drinks.category.id, stationId: f.cafe.id }] });
    expect((await db.menuProduct.findUniqueOrThrow({ where: { id: drinks.product.id } })).stationId).toBe(f.kitchen.id);
  });

  it('can clear a category back to no station', async () => {
    const f = await createOrderingFixture();
    const c = await unroutedCategory(f, 'Bebidas');
    await assignCategoryStations(f.ctx, { assignments: [{ categoryId: c.category.id, stationId: f.cafe.id }] });
    await assignCategoryStations(f.ctx, { assignments: [{ categoryId: c.category.id, stationId: null }] });
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: c.category.id } })).defaultStationId).toBeNull();
  });

  it('treats a switched-off station as no station, like the publish check does', async () => {
    const f = await createOrderingFixture();
    const c = await unroutedCategory(f, 'Bebidas');
    await assignCategoryStations(f.ctx, { assignments: [{ categoryId: c.category.id, stationId: f.cafe.id }] });
    expect((await routingReview(f.ctx, f.location.id)).unassignedProducts).toBe(0);

    await db.kitchenStation.update({ where: { id: f.cafe.id }, data: { isActive: false } });
    const review = await routingReview(f.ctx, f.location.id);
    // Nobody is watching a switched-off screen, so everything that pointed at it — the new
    // category and the fixture's own drinks — counts as unrouted again.
    expect(review.unassignedProducts).toBe(2);
    expect(review.unrouted.map((u) => u.name)).toEqual(expect.arrayContaining(['Bebidas dish', 'Test tea']));
    // And the setup step agrees, instead of showing a green tick while publishing refuses.
    const step = (await getSetupProgress(f.org.id)).steps.find((s) => s.key === 'kitchen')!;
    expect(step.done).toBe(false);
    expect(step.missing.join(' ')).toMatch(/reach no kitchen screen/);
  });

  it('refuses a station that belongs to another restaurant', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    const c = await unroutedCategory(a, 'Bebidas');
    await expect(assignCategoryStations(a.ctx, { assignments: [{ categoryId: c.category.id, stationId: b.cafe.id }] })).rejects.toThrow(/Invalid station/);
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: c.category.id } })).defaultStationId).toBeNull();
  });

  it('ignores a category that belongs to another restaurant', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    const theirs = await unroutedCategory(b, 'Bebidas');
    await expect(assignCategoryStations(a.ctx, { assignments: [{ categoryId: theirs.category.id, stationId: a.cafe.id }] })).rejects.toThrow(/No categories found/);
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: theirs.category.id } })).defaultStationId).toBeNull();
  });
});

describe('creating the stations a restaurant uses', () => {
  beforeEach(resetDatabase);

  it('creates only what the owner ticked, and nothing on its own', async () => {
    const f = await createOrderingFixture();
    // Start from a restaurant with no stations at all, as a new tenant has.
    await db.kitchenStation.deleteMany({ where: { organizationId: f.org.id } });
    const review = await routingReview(f.ctx, f.location.id);
    expect(review.stations).toHaveLength(0);
    // With no station to send anything to, nothing is suggested.
    expect(review.categories.every((c) => c.suggestedStationId === null)).toBe(true);

    const res = await createStations(f.ctx, { locationId: f.location.id, types: ['KITCHEN', 'CAFE'] });
    expect(res.created).toEqual(['Kitchen', 'Café']);
    const stations = await db.kitchenStation.findMany({ where: { locationId: f.location.id }, orderBy: { sortOrder: 'asc' } });
    expect(stations.map((s) => [s.name, s.type, s.isActive])).toEqual([
      ['Kitchen', 'KITCHEN', true],
      ['Café', 'CAFE', true],
    ]);
  });

  it('is harmless to press twice', async () => {
    const f = await createOrderingFixture();
    await db.kitchenStation.deleteMany({ where: { organizationId: f.org.id } });
    await createStations(f.ctx, { locationId: f.location.id, types: ['KITCHEN'] });
    await expect(createStations(f.ctx, { locationId: f.location.id, types: ['KITCHEN'] })).rejects.toThrow(/already exist/);
    expect(await db.kitchenStation.count({ where: { locationId: f.location.id } })).toBe(1);
  });

  it('cannot create a station in another restaurant', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await expect(createStations(a.ctx, { locationId: b.location.id, types: ['KITCHEN'] })).rejects.toThrow();
    expect(await db.kitchenStation.count({ where: { locationId: b.location.id } })).toBe(2); // only the fixture's own
  });
});
