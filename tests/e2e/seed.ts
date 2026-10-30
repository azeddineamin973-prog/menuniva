// E2E seed (TEST DATABASE ONLY). Creates a fictitious restaurant through the real services
// and prints JSON with logins/tokens for the browser tests.
//   DATABASE_URL=<test db> tsx --conditions=react-server tests/e2e/seed.ts <prefix>
import 'dotenv/config';
import { hashPassword } from '../../src/server/auth/password';
import { db } from '../../src/server/db';
import { createRestaurant } from '../../src/server/services/organizations';

async function main() {
  if (!process.env.DATABASE_URL?.includes('menuniva_test')) throw new Error('Refusing to seed a non-test database');
  const prefix = process.argv[2] ?? `e2e${Date.now()}`;
  const password = 'e2e-password-123';
  const passwordHash = await hashPassword(password);
  const mk = (role: string) => db.user.create({ data: { name: `E2E ${role}`, email: `${prefix}.${role}@test.menuniva.local`, passwordHash } });
  const [owner, cook, waiter] = await Promise.all([mk('owner'), mk('cook'), mk('waiter')]);
  const { org, location } = await createRestaurant({ name: `E2E Seed ${prefix}`, country: 'PT' }, { ownerUserId: owner.id, actorUserId: owner.id });
  await db.restaurantMembership.createMany({
    data: [
      { userId: cook.id, organizationId: org.id, role: 'KITCHEN_STAFF' },
      { userId: waiter.id, organizationId: org.id, role: 'WAITER' },
    ],
  });
  await db.user.updateMany({ where: { id: { in: [owner.id, cook.id, waiter.id] } }, data: { preferredLanguage: 'en' } });
  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: org.id } });
  const kitchen = await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: 'Seed Kitchen', type: 'KITCHEN' } });
  const cat = await db.menuCategory.create({ data: { organizationId: org.id, menuId: menu.id, defaultStationId: kitchen.id, translations: { create: { language: 'pt', name: 'Seed pratos', status: 'SOURCE' } } } });
  const dish = await db.menuProduct.create({
    data: {
      organizationId: org.id,
      menuId: menu.id,
      categoryId: cat.id,
      status: 'ACTIVE',
      translations: { create: [{ language: 'pt', name: 'Seed tajine', status: 'SOURCE' }] },
      prices: { create: [{ channel: 'DINE_IN', amountCents: 1500 }] },
      variants: { create: [{ names: { pt: 'Normal' }, priceDeltaCents: 0, isDefault: true, sortOrder: 0 }, { names: { pt: 'Grande' }, priceDeltaCents: 400, sortOrder: 1 }] },
      modifierGroups: {
        create: {
          names: { pt: 'Acompanhamento' },
          minSelect: 1,
          maxSelect: 1,
          options: { create: [{ names: { pt: 'Cuscuz' }, priceDeltaCents: 0, sortOrder: 0 }, { names: { pt: 'Arroz' }, priceDeltaCents: 150, sortOrder: 1 }] },
        },
      },
    },
  });
  const plain = await db.menuProduct.create({
    data: {
      organizationId: org.id,
      menuId: menu.id,
      categoryId: cat.id,
      status: 'ACTIVE',
      translations: { create: [{ language: 'pt', name: 'Seed harira', status: 'SOURCE' }] },
      prices: { create: [{ channel: 'DINE_IN', amountCents: 650 }] },
    },
  });
  const table = await db.restaurantTable.create({ data: { organizationId: org.id, locationId: location.id, label: '07', qrTokens: { create: { token: `seed${prefix}`.padEnd(22, 'x').slice(0, 22) } } }, include: { qrTokens: true } });
  await db.restaurantLocation.update({
    where: { id: location.id },
    data: { isPublished: true, tableOrderingEnabled: true, addressLine1: 'Rua E2E, 1', city: 'Braga', phone: '+351 900 000 001' },
  });
  await db.restaurantOrganization.update({ where: { id: org.id }, data: { status: 'ACTIVE' } });
  console.log(
    JSON.stringify({ orgSlug: org.slug, orgId: org.id, locationId: location.id, dishId: dish.id, plainDishId: plain.id, password, owner: owner.email, cook: cook.email, waiter: waiter.email, qrToken: table.qrTokens[0].token }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
