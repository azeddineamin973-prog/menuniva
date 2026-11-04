import { db } from '@/server/db';
import { createRestaurant } from '@/server/services/organizations';
import { resolveTenantAccess } from '@/server/tenant';
import { createTestUser } from './db';

/**
 * TEST-ONLY fixture: a clearly fictitious restaurant ("Test Restaurant …") in the test
 * database. Never used for real tenants.
 */
export async function createOrderingFixture(name = 'Test Restaurant') {
  const owner = await createTestUser(`${name} Owner`);
  const { org, location } = await createRestaurant({ name, country: 'PT' }, { ownerUserId: owner.id, actorUserId: owner.id });
  const ctx = await resolveTenantAccess(owner.id, org.slug);
  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: org.id } });
  const kitchen = await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: 'Test Kitchen', type: 'KITCHEN' } });
  const cafe = await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: 'Test Café', type: 'CAFE' } });
  const mains = await db.menuCategory.create({ data: { organizationId: org.id, menuId: menu.id, defaultStationId: kitchen.id, translations: { create: { language: 'pt', name: 'Test mains', status: 'SOURCE' } } } });
  const drinks = await db.menuCategory.create({ data: { organizationId: org.id, menuId: menu.id, defaultStationId: cafe.id, translations: { create: { language: 'pt', name: 'Test drinks', status: 'SOURCE' } } } });
  const dish = await db.menuProduct.create({
    data: {
      organizationId: org.id,
      menuId: menu.id,
      categoryId: mains.id,
      status: 'ACTIVE',
      translations: { create: [{ language: 'pt', name: 'Test dish', status: 'SOURCE' }, { language: 'en', name: 'Test dish EN', status: 'REVIEWED' }] },
      prices: { create: [{ channel: 'DINE_IN', amountCents: 1690 }, { channel: 'TAKEAWAY', amountCents: 1590 }, { channel: 'DELIVERY', amountCents: 1790 }] },
    },
  });
  const tea = await db.menuProduct.create({
    data: {
      organizationId: org.id,
      menuId: menu.id,
      categoryId: drinks.id,
      status: 'ACTIVE',
      translations: { create: [{ language: 'pt', name: 'Test tea', status: 'SOURCE' }] },
      prices: { create: [{ channel: 'DINE_IN', amountCents: 250 }, { channel: 'TAKEAWAY', amountCents: 250 }] },
      modifierGroups: {
        create: {
          names: { pt: 'Açúcar' },
          minSelect: 1,
          maxSelect: 1,
          options: { create: [{ names: { pt: 'Com açúcar' }, priceDeltaCents: 0 }, { names: { pt: 'Com mel' }, priceDeltaCents: 50 }] },
        },
      },
    },
    include: { modifierGroups: { include: { options: true } } },
  });
  const area = await db.diningArea.create({ data: { organizationId: org.id, locationId: location.id, name: 'Test area' } });
  const table = await db.restaurantTable.create({ data: { organizationId: org.id, locationId: location.id, areaId: area.id, label: '05', qrTokens: { create: { token: `qr_${org.id}_05`.slice(0, 40) } } }, include: { qrTokens: true } });
  // As an existing restaurant after the migration (open table ordering, pending cap 50): the pricing,
  // kitchen, bill and payment suites test those flows, not table access. New locations default to SESSION_PIN, covered by
  // tests/integration/secure-table-sessions.test.ts.
  await db.restaurantLocation.update({ where: { id: location.id }, data: { isPublished: true, tableOrderingEnabled: true, takeawayEnabled: true, deliveryEnabled: true, tableOrderingPolicy: 'OPEN', tablePendingOrderCap: 50 } });
  return { owner, org, location, ctx, kitchen, cafe, dish, tea, honey: tea.modifierGroups[0].options[1], sugar: tea.modifierGroups[0].options[0], table, qrToken: table.qrTokens[0].token };
}
