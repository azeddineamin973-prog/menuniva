/**
 * Demo environment seed (M13-10, TEST 20). Writes ONLY to the separate demo database
 * (DEMO_DATABASE_URL, name must contain "demo"). Everything is labelled DEMO:
 *
 * 1. "Restaurante Demo" — a generic fictitious restaurant for sales demos.
 * 2. "Casa de Marrocos (DEMO)" — the real layout given by the owner (dining room, Moroccan
 *    seating area, indoor terrace, Moroccan tent/café, downstairs kitchen, café station,
 *    reception counter for pickups) with FICTITIOUS dishes and prices marked "(demo)".
 *    It is not the real menu and lives only in the demo database.
 *
 *   npm run demo:seed              # migrate the demo DB, then (re)create both demo restaurants
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

const LANGS = ['pt', 'en', 'fr', 'ar', 'es'] as const;
type Names = Record<(typeof LANGS)[number], string>;
type Dish = { cat: 'starters' | 'mains' | 'drinks'; names: Names; cents: number; takeawayCents?: number };
type Tenant = {
  slug: string;
  name: string;
  emailPrefix: string; // owner@…, casa.owner@…
  city: string;
  address: string;
  phone: string | null;
  tagline: string;
  note: string;
  areas: string[];
  stations: { name: string; type: 'KITCHEN' | 'CAFE' }[];
  pickupPoint: string | null;
  tables: number;
  dishes: Dish[];
};
const CATS: Record<Dish['cat'], Names> = {
  starters: { pt: 'Entradas', en: 'Starters', fr: 'Entrées', ar: 'مقبلات', es: 'Entrantes' },
  mains: { pt: 'Pratos', en: 'Mains', fr: 'Plats', ar: 'أطباق رئيسية', es: 'Principales' },
  drinks: { pt: 'Bebidas', en: 'Drinks', fr: 'Boissons', ar: 'مشروبات', es: 'Bebidas' },
};
const GENERIC: Tenant = {
  slug: 'demo-restaurante',
  name: 'Restaurante Demo',
  emailPrefix: '',
  city: 'Cidade Demo',
  address: 'Rua Fictícia, 1 (demo)',
  phone: '+351 000 000 000',
  tagline: 'Restaurante fictício para demonstração',
  note: 'Prato fictício para demonstração.',
  areas: ['Sala (demo)', 'Esplanada interior (demo)'],
  stations: [{ name: 'Cozinha', type: 'KITCHEN' }, { name: 'Café', type: 'CAFE' }],
  pickupPoint: null,
  tables: 6,
  dishes: [
    { cat: 'starters', names: { pt: 'Sopa do dia (demo)', en: 'Soup of the day (demo)', fr: 'Soupe du jour (démo)', ar: 'حساء اليوم (تجريبي)', es: 'Sopa del día (demo)' }, cents: 450, takeawayCents: 400 },
    { cat: 'starters', names: { pt: 'Salada da casa (demo)', en: 'House salad (demo)', fr: 'Salade maison (démo)', ar: 'سلطة البيت (تجريبي)', es: 'Ensalada de la casa (demo)' }, cents: 600 },
    { cat: 'mains', names: { pt: 'Prato de legumes (demo)', en: 'Vegetable dish (demo)', fr: 'Plat de légumes (démo)', ar: 'طبق خضار (تجريبي)', es: 'Plato de verduras (demo)' }, cents: 1250, takeawayCents: 1150 },
    { cat: 'mains', names: { pt: 'Prato de frango (demo)', en: 'Chicken dish (demo)', fr: 'Plat de poulet (démo)', ar: 'طبق دجاج (تجريبي)', es: 'Plato de pollo (demo)' }, cents: 1400, takeawayCents: 1300 },
    { cat: 'mains', names: { pt: 'Cuscuz (demo)', en: 'Couscous (demo)', fr: 'Couscous (démo)', ar: 'كسكس (تجريبي)', es: 'Cuscús (demo)' }, cents: 1350 },
    { cat: 'drinks', names: { pt: 'Chá de menta (demo)', en: 'Mint tea (demo)', fr: 'Thé à la menthe (démo)', ar: 'شاي بالنعناع (تجريبي)', es: 'Té de menta (demo)' }, cents: 250, takeawayCents: 250 },
    { cat: 'drinks', names: { pt: 'Sumo natural (demo)', en: 'Fresh juice (demo)', fr: 'Jus frais (démo)', ar: 'عصير طازج (تجريبي)', es: 'Zumo natural (demo)' }, cents: 350 },
  ],
};
const CASA_DEMO: Tenant = {
  slug: 'casa-de-marrocos-demo',
  name: 'Casa de Marrocos (DEMO)',
  emailPrefix: 'casa.',
  city: 'Braga',
  address: 'Rua de Santa Margarida, 13, 15 e 17',
  phone: null, // never route demo guests to the real restaurant's phone
  tagline: 'Demonstração — pratos e preços fictícios, não é o menu real',
  note: 'Prato fictício de demonstração — não faz parte do menu real da Casa de Marrocos.',
  areas: ['Sala principal', 'Zona de assentos marroquinos', 'Terraço interior', 'Tenda marroquina (café)'],
  stations: [{ name: 'Cozinha (piso inferior)', type: 'KITCHEN' }, { name: 'Café / Chá', type: 'CAFE' }],
  pickupPoint: 'Balcão de receção',
  tables: 4, // one demo table per area; the real table count is entered by the owner
  dishes: [
    { cat: 'starters', names: { pt: 'Harira (demo)', en: 'Harira soup (demo)', fr: 'Harira (démo)', ar: 'حريرة (تجريبي)', es: 'Harira (demo)' }, cents: 500, takeawayCents: 450 },
    { cat: 'mains', names: { pt: 'Tajine de frango (demo)', en: 'Chicken tagine (demo)', fr: 'Tajine de poulet (démo)', ar: 'طاجين دجاج (تجريبي)', es: 'Tajín de pollo (demo)' }, cents: 1600, takeawayCents: 1500 },
    { cat: 'mains', names: { pt: 'Cuscuz de legumes (demo)', en: 'Vegetable couscous (demo)', fr: 'Couscous aux légumes (démo)', ar: 'كسكس بالخضار (تجريبي)', es: 'Cuscús de verduras (demo)' }, cents: 1400 },
    { cat: 'drinks', names: { pt: 'Chá marroquino (demo)', en: 'Moroccan tea (demo)', fr: 'Thé marocain (démo)', ar: 'شاي مغربي (تجريبي)', es: 'Té marroquí (demo)' }, cents: 300, takeawayCents: 300 },
  ],
};

async function main() {
  const { db } = await import('../src/server/db');
  const { hashPassword } = await import('../src/server/auth/password');
  const { createRestaurant } = await import('../src/server/services/organizations');
  const { resolveTenantAccess } = await import('../src/server/tenant');
  const { submitTableOrder, changeOrderStatus } = await import('../src/server/services/orders');
  const { closeTableSession, openTableSession, recordPayment } = await import('../src/server/services/bills');
  const { joinTableSession } = await import('../src/server/services/table-access');
  const { submitFeedback } = await import('../src/server/services/feedback');

  const password = process.env.DEMO_PASSWORD || randomBytes(9).toString('base64url');
  const passwordHash = await hashPassword(password);
  const out: { slug: string; qrToken: string; tables: { label: string; qrToken: string }[] }[] = [];
  // DEMO_ONLY=demo-restaurante seeds only the listed demo restaurants (comma-separated slugs).
  // DEMO_STAFF_LANGUAGE=en gives the demo staff accounts an English dashboard (default pt).
  const only = (process.env.DEMO_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const staffLanguage = process.env.DEMO_STAFF_LANGUAGE === 'en' ? 'en' : 'pt';

  for (const t of [GENERIC, CASA_DEMO].filter((x) => !only.length || only.includes(x.slug))) {
    // Re-running replaces the previous demo restaurant (demo database only).
    const old = await db.restaurantOrganization.findUnique({ where: { slug: t.slug } });
    if (old) {
      if (!old.isDemo) throw new Error(`Refusing to replace "${t.slug}": it is not marked as a demo tenant.`);
      const members = await db.restaurantMembership.findMany({ where: { organizationId: old.id }, select: { userId: true } });
      await db.restaurantOrganization.delete({ where: { id: old.id } });
      await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) }, email: { endsWith: '@demo.menuniva.invalid' } } });
    }
    const mk = (role: string, name: string) => db.user.create({ data: { name: `${name} (demo)`, email: `${t.emailPrefix}${role}@demo.menuniva.invalid`, passwordHash, preferredLanguage: staffLanguage } });
    const owner = await mk('owner', 'Dono Demo');
    const staff = await Promise.all([mk('manager', 'Gerente Demo'), mk('waiter', 'Empregado Demo'), mk('kitchen', 'Cozinha Demo'), mk('cafe', 'Café Demo'), mk('driver', 'Estafeta Demo')]);
    const { org, location } = await createRestaurant({ name: t.name, country: 'PT', city: t.city, locationName: t.name }, { ownerUserId: owner.id, actorUserId: null, isDemo: true });
    await db.restaurantOrganization.update({ where: { id: org.id }, data: { slug: t.slug, status: 'ACTIVE', enabledLanguages: [...LANGS], legalName: `${t.name} — dados fictícios` } });
    await db.restaurantMembership.createMany({
      data: (['RESTAURANT_MANAGER', 'WAITER', 'KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'] as const).map((role, i) => ({ userId: staff[i].id, organizationId: org.id, role })),
    });
    await db.restaurantBranding.update({ where: { organizationId: org.id }, data: { themePreset: 'moroccan', primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', tagline: t.tagline } });
    const stations = [];
    for (const [i, s] of t.stations.entries()) stations.push(await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: s.name, type: s.type, sortOrder: i } }));
    const [kitchen, cafe] = stations;
    const menu = await db.menu.findFirstOrThrow({ where: { organizationId: org.id } });
    const cats: Record<string, string> = {};
    let sort = 0;
    for (const [key, names] of Object.entries(CATS)) {
      if (!t.dishes.some((d) => d.cat === key)) continue;
      const c = await db.menuCategory.create({
        data: { organizationId: org.id, menuId: menu.id, sortOrder: sort++, defaultStationId: key === 'drinks' ? cafe.id : kitchen.id, translations: { create: LANGS.map((l) => ({ language: l, name: names[l], status: l === 'pt' ? 'SOURCE' : 'REVIEWED' })) } },
      });
      cats[key] = c.id;
    }
    const products: string[] = [];
    for (const [i, d] of t.dishes.entries()) {
      const p = await db.menuProduct.create({
        data: {
          organizationId: org.id,
          menuId: menu.id,
          categoryId: cats[d.cat],
          status: 'ACTIVE',
          sortOrder: i,
          isFeatured: d.cat === 'mains' && i === t.dishes.findIndex((x) => x.cat === 'mains'),
          translations: { create: LANGS.map((l) => ({ language: l, name: d.names[l], description: l === 'pt' ? t.note : null, status: l === 'pt' ? 'SOURCE' : 'REVIEWED' })) },
          prices: { create: [{ channel: 'DINE_IN', amountCents: d.cents }, ...(d.takeawayCents ? [{ channel: 'TAKEAWAY' as const, amountCents: d.takeawayCents }] : [])] },
        },
      });
      products.push(p.id);
    }
    const areas = [];
    for (const [i, name] of t.areas.entries()) areas.push(await db.diningArea.create({ data: { organizationId: org.id, locationId: location.id, name, sortOrder: i } }));
    const tables: { id: string; label: string; qrTokens: { token: string }[] }[] = [];
    for (let n = 1; n <= t.tables; n++) {
      tables.push(
        await db.restaurantTable.create({
          data: { organizationId: org.id, locationId: location.id, areaId: areas[Math.min(areas.length - 1, Math.floor(((n - 1) * areas.length) / t.tables))].id, label: String(n).padStart(2, '0'), seats: 4, sortOrder: n, qrTokens: { create: { token: randomBytes(16).toString('base64url') } } },
          include: { qrTokens: true },
        }),
      );
    }
    await db.restaurantLocation.update({
      where: { id: location.id },
      data: { slug: 'principal', isPublished: true, tableOrderingEnabled: true, takeawayEnabled: true, addressLine1: t.address, city: t.city, phone: t.phone, timeZone: 'Europe/Lisbon' },
    });
    if (t.pickupPoint) await db.takeawaySettings.update({ where: { locationId: location.id }, data: { pickupPoint: t.pickupPoint } });

    // A few fictitious orders so the dashboards and analytics have something to show. Demo restaurants
    // are new restaurants, so they use the default table policy for new locations (SESSION_PIN): each
    // order goes through the real flow — staff open the table, a fictitious phone enters the PIN once,
    // then orders. Finished seatings are paid and closed again, so tables 01 and 02 are free; table 03
    // stays open with one order waiting for staff approval.
    const ctx = await resolveTenantAccess(owner.id, t.slug);
    const mains = t.dishes.findIndex((d) => d.cat === 'mains');
    const drink = t.dishes.findIndex((d) => d.cat === 'drinks');
    for (const [table, items, finish] of [
      [0, [[mains, 2], [drink, 2]], true],
      [1, [[mains + 1, 1], [drink, 1]], true],
      [2, [[0, 1]], false],
    ] as [number, [number, number][], boolean][]) {
      const seating = await openTableSession(ctx, tables[table].id);
      const phone = { guest: `demo-phone-${randomUUID()}`, ip: null };
      const grantTokens: string[] = [];
      if (seating.pin) {
        const joined = await joinTableSession({ qrToken: tables[table].qrTokens[0].token, pin: seating.pin }, phone, []);
        if ('token' in joined && joined.token) grantTokens.push(joined.token);
      }
      const o = await submitTableOrder({ qrToken: tables[table].qrTokens[0].token, idempotencyKey: randomUUID(), language: 'pt', items: items.map(([p, q]) => ({ productId: products[p], quantity: q, modifiers: [] })) }, phone, { grantTokens });
      const row = await db.order.findFirstOrThrow({ where: { organizationId: org.id, number: o.orderNumber } });
      if (!finish) continue;
      await changeOrderStatus(ctx, { orderId: row.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
      await db.kitchenTicket.updateMany({ where: { orderId: row.id }, data: { status: 'READY' } });
      await changeOrderStatus(ctx, { orderId: row.id, expectedFrom: 'ACCEPTED', to: 'READY' });
      await changeOrderStatus(ctx, { orderId: row.id, expectedFrom: 'READY', to: 'COMPLETED' });
      await recordPayment(ctx, { orderId: row.id, method: 'CASH', amountCents: row.totalCents });
      await closeTableSession(ctx, { sessionId: seating.id });
    }
    await submitFeedback({ orgSlug: t.slug, rating: 5, comment: 'Comentário fictício (demo).', language: 'pt' }, `demo-seed-${t.slug}`);
    out.push({ slug: t.slug, qrToken: tables[0].qrTokens[0].token, tables: tables.map((x) => ({ label: x.label, qrToken: x.qrTokens[0].token })) });
    console.log(`Demo restaurant ready: ${t.name}\n  Storefront: /r/${t.slug}\n  Table QR:   /t/${tables[0].qrTokens[0].token}\n  Logins:     ${t.emailPrefix}owner@ ${t.emailPrefix}manager@ ${t.emailPrefix}waiter@ ${t.emailPrefix}kitchen@ ${t.emailPrefix}cafe@ ${t.emailPrefix}driver@demo.menuniva.invalid`);
  }
  console.log(`Database: ${new URL(DEMO_URL).pathname.slice(1)} (fictitious data only)\nPassword for every demo login: ${password}${process.env.DEMO_PASSWORD ? ' (from DEMO_PASSWORD)' : ' (random, shown once)'}`);
  if (process.env.DEMO_JSON) console.log(JSON.stringify({ password, tenants: out }));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
