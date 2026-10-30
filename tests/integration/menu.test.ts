import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { saveAllergens, saveCategory, saveProduct, saveProductOptions } from '@/server/services/menu';
import { getPublicMenu } from '@/server/services/public-menu';
import { saveTranslation } from '@/server/services/translations';
import { createRestaurant } from '@/server/services/organizations';
import { resolveTenantAccess } from '@/server/tenant';
import { createTestUser, resetDatabase } from '../support/db';

async function tenant(name = 'Test Menu Restaurant') {
  const owner = await createTestUser();
  const { org, location } = await createRestaurant({ name, country: 'PT' }, { ownerUserId: owner.id, actorUserId: owner.id });
  return { ctx: await resolveTenantAccess(owner.id, org.slug), org, location };
}

describe('menu management', () => {
  beforeEach(resetDatabase);

  it('creates a category and dish with only the source language and integer-cent prices', async () => {
    const { ctx, location } = await tenant();
    const { id: categoryId } = await saveCategory(ctx, { translations: { pt: { name: 'Pratos de teste' } } });
    const { id } = await saveProduct(ctx, { categoryId, status: 'ACTIVE', translations: { pt: { name: 'Prato de teste' } }, prices: { DINE_IN: '16,90', TAKEAWAY: '15.90' } });
    const prices = await db.channelPrice.findMany({ where: { productId: id }, orderBy: { channel: 'asc' } });
    expect(prices.map((p) => [p.channel, p.amountCents])).toEqual([['DINE_IN', 1690], ['TAKEAWAY', 1590]]);
    await db.restaurantLocation.update({ where: { id: location.id }, data: { isPublished: true } });
    const en = await getPublicMenu(location.id, 'en', 'TABLE');
    expect(en[0].products[0].name).toBe('Prato de teste'); // falls back to source, no invented translation
  });

  it('refuses a visible dish without a dine-in price and ambiguous prices', async () => {
    const { ctx } = await tenant();
    const { id: categoryId } = await saveCategory(ctx, { translations: { pt: { name: 'Cat' } } });
    await expect(saveProduct(ctx, { categoryId, status: 'ACTIVE', translations: { pt: { name: 'X' } }, prices: {} })).rejects.toThrow(/dine-in price/);
    await expect(saveProduct(ctx, { categoryId, status: 'DRAFT', translations: { pt: { name: 'X' } }, prices: { DINE_IN: '16,999' } })).rejects.toThrow(/Invalid/);
  });

  it('hides unverified allergens and unreviewed machine translations from guests', async () => {
    const { ctx, location } = await tenant();
    const { id: categoryId } = await saveCategory(ctx, { translations: { pt: { name: 'Cat' } } });
    const { id } = await saveProduct(ctx, { categoryId, status: 'ACTIVE', translations: { pt: { name: 'Prato' } }, prices: { DINE_IN: '10' } });
    await saveAllergens(ctx, id, { declarations: [{ allergen: 'GLUTEN', presence: 'CONTAINS' }], verify: false });
    await db.productTranslation.create({ data: { productId: id, language: 'fr', name: 'Plat (machine)', status: 'MACHINE' } });
    let menu = await getPublicMenu(location.id, 'fr', 'TABLE');
    expect(menu[0].products[0].allergens).toBeNull();
    expect(menu[0].products[0].name).toBe('Prato');
    await saveAllergens(ctx, id, { declarations: [{ allergen: 'GLUTEN', presence: 'CONTAINS' }], verify: true });
    await saveTranslation(ctx, { kind: 'product', id, language: 'fr', name: 'Plat' });
    menu = await getPublicMenu(location.id, 'fr', 'TABLE');
    expect(menu[0].products[0].allergens).toEqual({ contains: ['GLUTEN'], mayContain: [] });
    expect(menu[0].products[0].name).toBe('Plat');
  });

  it('saves variants and modifier groups with partial language names', async () => {
    const { ctx } = await tenant();
    const { id: categoryId } = await saveCategory(ctx, { translations: { pt: { name: 'Cat' } } });
    const { id } = await saveProduct(ctx, { categoryId, status: 'DRAFT', translations: { pt: { name: 'Chá' } }, prices: { DINE_IN: '2,50' } });
    await saveProductOptions(
      ctx,
      id,
      [{ names: { pt: 'Pequeno' }, priceDelta: '0' }, { names: { pt: 'Bule' }, priceDelta: '3,00' }],
      [{ names: { pt: 'Açúcar' }, minSelect: 1, maxSelect: 1, options: [{ names: { pt: 'Sim' } }, { names: { pt: 'Mel' }, priceDelta: '0,50' }] }],
    );
    const p = await db.menuProduct.findUniqueOrThrow({ where: { id }, include: { variants: true, modifierGroups: { include: { options: true } } } });
    expect(p.variants.map((v) => v.priceDeltaCents).sort()).toEqual([0, 300]);
    expect(p.modifierGroups[0].options.map((o) => o.priceDeltaCents).sort()).toEqual([0, 50]);
  });

  it('cannot use another tenant’s category or station', async () => {
    const a = await tenant('Test A');
    const b = await tenant('Test B');
    const { id: catB } = await saveCategory(b.ctx, { translations: { pt: { name: 'B' } } });
    await expect(saveProduct(a.ctx, { categoryId: catB, translations: { pt: { name: 'X' } }, prices: { DINE_IN: '1' } })).rejects.toThrow(/Invalid category/);
    const stationB = await db.kitchenStation.create({ data: { organizationId: b.org.id, locationId: b.location.id, name: 'B kitchen' } });
    await expect(saveCategory(a.ctx, { translations: { pt: { name: 'A' } }, defaultStationId: stationB.id })).rejects.toThrow(/Invalid station/);
  });
});
