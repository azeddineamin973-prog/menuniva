// E2E seed for pickup + own delivery (TEST DATABASE ONLY). Adds to a restaurant created by
// seed.ts: a Moroccan-style brand, opening hours, pickup and delivery settings, one delivery
// zone, Kitchen and Café stations and a small fictional menu with sizes and extras.
//   DATABASE_URL=<test db> tsx --conditions=react-server tests/e2e/seed-ordering.ts <orgId> <locationId>
import 'dotenv/config';
import { db } from '../../src/server/db';

async function main() {
  if (!process.env.DATABASE_URL?.includes('menuniva_test')) throw new Error('Refusing to seed a non-test database');
  const [orgId, locationId] = process.argv.slice(2);
  if (!orgId || !locationId) throw new Error('Usage: seed-ordering.ts <orgId> <locationId>');
  const allDay = [{ open: '00:00', close: '00:00' }];
  const hours = { mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay };

  await db.restaurantBranding.upsert({
    where: { organizationId: orgId },
    update: { themePreset: 'moroccan', primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', textColor: '#1E2420', tagline: 'Cozinha marroquina autêntica (teste)' },
    create: { organizationId: orgId, themePreset: 'moroccan', primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', textColor: '#1E2420', tagline: 'Cozinha marroquina autêntica (teste)' },
  });
  await db.restaurantLocation.update({
    where: { id: locationId },
    data: { takeawayEnabled: true, deliveryEnabled: true, openingHours: hours, addressLine1: 'Rua de Teste, 13', postalCode: '4700-001', city: 'Braga', phone: '+351 900 000 001', timeZone: 'Europe/Lisbon' },
  });
  const takeaway = { leadTimeMinutes: 20, slotMinutes: 15, minOrderCents: 500, pickupPoint: 'Balcão de receção', paused: false };
  const delivery = { cashOnDeliveryEnabled: true, cardOnDeliveryEnabled: true, maxActiveOrders: 50, paused: false };
  await db.takeawaySettings.upsert({ where: { locationId }, update: takeaway, create: { locationId, ...takeaway } });
  await db.deliverySettings.upsert({ where: { locationId }, update: delivery, create: { locationId, ...delivery } });
  await db.deliveryZone.create({ data: { organizationId: orgId, locationId, name: 'Braga centro (teste)', postalCodePatterns: ['4700-*'], feeCents: 300, minOrderCents: 1000, freeDeliveryThresholdCents: 6000, estimatedMinutes: 40 } });

  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: orgId } });
  const kitchen = await db.kitchenStation.findFirstOrThrow({ where: { organizationId: orgId, type: 'KITCHEN' } });
  const cafe = await db.kitchenStation.create({ data: { organizationId: orgId, locationId, name: 'Seed Café', type: 'CAFE' } });
  const tajines = await db.menuCategory.create({ data: { organizationId: orgId, menuId: menu.id, sortOrder: -2, defaultStationId: kitchen.id, translations: { create: { language: 'pt', name: 'Tajines', status: 'SOURCE' } } } });
  const drinks = await db.menuCategory.create({ data: { organizationId: orgId, menuId: menu.id, sortOrder: -1, defaultStationId: cafe.id, translations: { create: { language: 'pt', name: 'Chá e café', status: 'SOURCE' } } } });
  const prices = (dineIn: number, takeaway: number, delivery: number) => ({ create: [{ channel: 'DINE_IN' as const, amountCents: dineIn }, { channel: 'TAKEAWAY' as const, amountCents: takeaway }, { channel: 'DELIVERY' as const, amountCents: delivery }] });
  const tajine = await db.menuProduct.create({
    data: {
      organizationId: orgId,
      menuId: menu.id,
      categoryId: tajines.id,
      status: 'ACTIVE',
      isPopular: true,
      translations: { create: [{ language: 'pt', name: 'Tajine de frango com limão', description: 'Frango cozinhado lentamente com limão confitado e azeitonas.', status: 'SOURCE' }] },
      prices: prices(1490, 1490, 1590),
      variants: { create: [{ names: { pt: 'Normal' }, priceDeltaCents: 0, isDefault: true, sortOrder: 0 }, { names: { pt: 'Para dois' }, priceDeltaCents: 1200, sortOrder: 1 }] },
      modifierGroups: {
        create: {
          names: { pt: 'Extras' },
          minSelect: 0,
          maxSelect: 3,
          options: { create: [{ names: { pt: 'Batatas fritas' }, priceDeltaCents: 300, sortOrder: 0 }, { names: { pt: 'Cuscuz extra' }, priceDeltaCents: 350, sortOrder: 1 }, { names: { pt: 'Pão marroquino' }, priceDeltaCents: 150, sortOrder: 2 }] },
        },
      },
    },
  });
  const couscous = await db.menuProduct.create({
    data: {
      organizationId: orgId,
      menuId: menu.id,
      categoryId: tajines.id,
      status: 'ACTIVE',
      translations: { create: [{ language: 'pt', name: 'Cuscuz real', description: 'Sêmola, legumes da época e grão.', status: 'SOURCE' }] },
      prices: prices(1690, 1690, 1790),
    },
  });
  const tea = await db.menuProduct.create({
    data: {
      organizationId: orgId,
      menuId: menu.id,
      categoryId: drinks.id,
      status: 'ACTIVE',
      translations: { create: [{ language: 'pt', name: 'Chá de menta', description: 'Chá verde com hortelã fresca.', status: 'SOURCE' }] },
      prices: prices(250, 250, 280),
    },
  });
  console.log(JSON.stringify({ tajineId: tajine.id, couscousId: couscous.id, teaId: tea.id, kitchenId: kitchen.id, cafeId: cafe.id }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
