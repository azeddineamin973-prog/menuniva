/**
 * Demo environment seed (M13-10). Writes ONLY to the separate demo database
 * (DEMO_DATABASE_URL, name must contain "demo"). Everything is fictitious and labelled DEMO:
 * restaurant, people, dishes, prices, orders. No real restaurant data is used.
 *
 *   npm run demo:seed              # migrate the demo DB, then (re)create the demo restaurant
 *   DEMO_PASSWORD=… npm run demo:seed
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const DEMO_URL = process.env.DEMO_DATABASE_URL ?? '';
if (!/demo/i.test(new URL(DEMO_URL || 'postgres://x/none').pathname)) {
  console.error('DEMO_DATABASE_URL must point to a separate database whose name contains "demo".');
  process.exit(1);
}
// The services below read their configuration from the environment at import time.
process.env.DATABASE_URL = DEMO_URL;
process.env.APP_ENV = 'demo';
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });

const SLUG = 'demo-restaurante';
const DEMO_NOTE = 'Prato fictício para demonstração.';
type Names = { pt: string; en: string; fr: string; ar: string; es: string };
const DISHES: { cat: 'starters' | 'mains' | 'drinks'; names: Names; cents: number; takeawayCents?: number }[] = [
  { cat: 'starters', names: { pt: 'Sopa do dia (demo)', en: 'Soup of the day (demo)', fr: 'Soupe du jour (démo)', ar: 'حساء اليوم (تجريبي)', es: 'Sopa del día (demo)' }, cents: 450, takeawayCents: 400 },
  { cat: 'starters', names: { pt: 'Salada da casa (demo)', en: 'House salad (demo)', fr: 'Salade maison (démo)', ar: 'سلطة البيت (تجريبي)', es: 'Ensalada de la casa (demo)' }, cents: 600 },
  { cat: 'mains', names: { pt: 'Prato de legumes (demo)', en: 'Vegetable dish (demo)', fr: 'Plat de légumes (démo)', ar: 'طبق خضار (تجريبي)', es: 'Plato de verduras (demo)' }, cents: 1250, takeawayCents: 1150 },
  { cat: 'mains', names: { pt: 'Prato de frango (demo)', en: 'Chicken dish (demo)', fr: 'Plat de poulet (démo)', ar: 'طبق دجاج (تجريبي)', es: 'Plato de pollo (demo)' }, cents: 1400, takeawayCents: 1300 },
  { cat: 'mains', names: { pt: 'Cuscuz (demo)', en: 'Couscous (demo)', fr: 'Couscous (démo)', ar: 'كسكس (تجريبي)', es: 'Cuscús (demo)' }, cents: 1350 },
  { cat: 'drinks', names: { pt: 'Chá de menta (demo)', en: 'Mint tea (demo)', fr: 'Thé à la menthe (démo)', ar: 'شاي بالنعناع (تجريبي)', es: 'Té de menta (demo)' }, cents: 250, takeawayCents: 250 },
  { cat: 'drinks', names: { pt: 'Sumo natural (demo)', en: 'Fresh juice (demo)', fr: 'Jus frais (démo)', ar: 'عصير طازج (تجريبي)', es: 'Zumo natural (demo)' }, cents: 350 },
];
const CATS: Record<'starters' | 'mains' | 'drinks', Names> = {
  starters: { pt: 'Entradas', en: 'Starters', fr: 'Entrées', ar: 'مقبلات', es: 'Entrantes' },
  mains: { pt: 'Pratos', en: 'Mains', fr: 'Plats', ar: 'أطباق رئيسية', es: 'Principales' },
  drinks: { pt: 'Bebidas', en: 'Drinks', fr: 'Boissons', ar: 'مشروبات', es: 'Bebidas' },
};
const LANGS = ['pt', 'en', 'fr', 'ar', 'es'] as const;

async function main() {
  const { db } = await import('../src/server/db');
  const { hashPassword } = await import('../src/server/auth/password');
  const { createRestaurant } = await import('../src/server/services/organizations');
  const { resolveTenantAccess } = await import('../src/server/tenant');
  const { submitTableOrder, changeOrderStatus } = await import('../src/server/services/orders');
  const { recordPayment } = await import('../src/server/services/bills');
  const { submitFeedback } = await import('../src/server/services/feedback');

  // Re-running replaces the previous demo restaurant (demo database only).
  const old = await db.restaurantOrganization.findUnique({ where: { slug: SLUG } });
  if (old) {
    if (!old.isDemo) throw new Error(`Refusing to replace "${SLUG}": it is not marked as a demo tenant.`);
    const members = await db.restaurantMembership.findMany({ where: { organizationId: old.id }, select: { userId: true } });
    await db.restaurantOrganization.delete({ where: { id: old.id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) }, email: { endsWith: '@demo.menuniva.invalid' } } });
  }

  const password = process.env.DEMO_PASSWORD || randomBytes(9).toString('base64url');
  const passwordHash = await hashPassword(password);
  const mk = (role: string, name: string) => db.user.create({ data: { name: `${name} (demo)`, email: `${role}@demo.menuniva.invalid`, passwordHash, preferredLanguage: 'pt' } });
  const owner = await mk('owner', 'Dona Demo');
  const staff = await Promise.all([mk('manager', 'Gerente Demo'), mk('waiter', 'Empregado Demo'), mk('kitchen', 'Cozinha Demo'), mk('cafe', 'Café Demo'), mk('driver', 'Estafeta Demo')]);

  const { org, location } = await createRestaurant({ name: 'Restaurante Demo', country: 'PT', city: 'Cidade Demo', locationName: 'Restaurante Demo' }, { ownerUserId: owner.id, actorUserId: null, isDemo: true });
  await db.restaurantOrganization.update({ where: { id: org.id }, data: { slug: SLUG, status: 'ACTIVE', enabledLanguages: [...LANGS], legalName: 'Restaurante Demo (fictício)' } });
  await db.restaurantMembership.createMany({
    data: (['RESTAURANT_MANAGER', 'WAITER', 'KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'] as const).map((role, i) => ({ userId: staff[i].id, organizationId: org.id, role })),
  });

  await db.restaurantBranding.update({ where: { organizationId: org.id }, data: { themePreset: 'moroccan', tagline: 'Restaurante fictício para demonstração' } });
  const kitchen = await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: 'Cozinha', type: 'KITCHEN' } });
  const cafe = await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: 'Café', type: 'CAFE' } });
  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: org.id } });
  const cats: Record<string, string> = {};
  let sort = 0;
  for (const [key, names] of Object.entries(CATS)) {
    const c = await db.menuCategory.create({
      data: { organizationId: org.id, menuId: menu.id, sortOrder: sort++, defaultStationId: key === 'drinks' ? cafe.id : kitchen.id, translations: { create: LANGS.map((l) => ({ language: l, name: names[l], status: l === 'pt' ? 'SOURCE' : 'REVIEWED' })) } },
    });
    cats[key] = c.id;
  }
  const products: string[] = [];
  for (const [i, d] of DISHES.entries()) {
    const p = await db.menuProduct.create({
      data: {
        organizationId: org.id,
        menuId: menu.id,
        categoryId: cats[d.cat],
        status: 'ACTIVE',
        sortOrder: i,
        isFeatured: i === 3,
        translations: { create: LANGS.map((l) => ({ language: l, name: d.names[l], description: l === 'pt' ? DEMO_NOTE : null, status: l === 'pt' ? 'SOURCE' : 'REVIEWED' })) },
        prices: { create: [{ channel: 'DINE_IN', amountCents: d.cents }, ...(d.takeawayCents ? [{ channel: 'TAKEAWAY' as const, amountCents: d.takeawayCents }] : [])] },
      },
    });
    products.push(p.id);
  }

  const areas = await Promise.all(['Sala (demo)', 'Esplanada interior (demo)'].map((name, i) => db.diningArea.create({ data: { organizationId: org.id, locationId: location.id, name, sortOrder: i } })));
  const tables: { qrTokens: { token: string }[] }[] = [];
  for (let n = 1; n <= 6; n++) {
    tables.push(
      await db.restaurantTable.create({
        data: { organizationId: org.id, locationId: location.id, areaId: areas[n <= 4 ? 0 : 1].id, label: String(n).padStart(2, '0'), seats: 4, sortOrder: n, qrTokens: { create: { token: randomBytes(16).toString('base64url') } } },
        include: { qrTokens: true },
      }),
    );
  }
  await db.restaurantLocation.update({
    where: { id: location.id },
    data: { slug: 'principal', isPublished: true, tableOrderingEnabled: true, takeawayEnabled: true, addressLine1: 'Rua Fictícia, 1 (demo)', city: 'Cidade Demo', phone: '+351 000 000 000' },
  });

  // A few fictitious orders so the dashboards and analytics have something to show.
  const ctx = await resolveTenantAccess(owner.id, SLUG);
  const order = (t: number, items: [number, number][]) =>
    submitTableOrder({ qrToken: tables[t].qrTokens[0].token, idempotencyKey: randomUUID(), language: 'pt', items: items.map(([p, q]) => ({ productId: products[p], quantity: q, modifiers: [] })) }, `demo-${randomUUID()}`);
  for (const [t, items, finish] of [
    [0, [[3, 2], [5, 2]], true],
    [1, [[2, 1], [6, 1]], true],
    [2, [[4, 1]], false],
  ] as [number, [number, number][], boolean][]) {
    const o = await order(t, items);
    const row = await db.order.findFirstOrThrow({ where: { organizationId: org.id, number: o.orderNumber } });
    if (!finish) continue;
    await changeOrderStatus(ctx, { orderId: row.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    await db.kitchenTicket.updateMany({ where: { orderId: row.id }, data: { status: 'READY' } });
    await changeOrderStatus(ctx, { orderId: row.id, expectedFrom: 'ACCEPTED', to: 'READY' });
    await changeOrderStatus(ctx, { orderId: row.id, expectedFrom: 'READY', to: 'COMPLETED' });
    await recordPayment(ctx, { orderId: row.id, method: 'CASH', amountCents: row.totalCents });
  }
  await submitFeedback({ orgSlug: SLUG, rating: 5, comment: 'Comentário fictício (demo).', language: 'pt' }, 'demo-seed');

  console.log(
    [
      'Demo restaurant ready (fictitious data, demo database only).',
      `  Database:   ${new URL(DEMO_URL).pathname.slice(1)}`,
      `  Storefront: /r/${SLUG}`,
      `  Table QR:   /t/${tables[0].qrTokens[0].token}`,
      `  Logins:     owner@ manager@ waiter@ kitchen@ cafe@ driver@demo.menuniva.invalid`,
      `  Password:   ${password}${process.env.DEMO_PASSWORD ? ' (from DEMO_PASSWORD)' : ' (random, shown once)'}`,
    ].join('\n'),
  );
  if (process.env.DEMO_JSON) console.log(JSON.stringify({ slug: SLUG, password, qrToken: tables[0].qrTokens[0].token }));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
