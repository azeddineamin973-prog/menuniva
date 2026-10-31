/**
 * UX / responsive audit seed (2026-10-31). Writes ONLY to the isolated database
 * `menuniva_test_ux` (never dev, test or demo). Everything is fictitious.
 *
 * Creates a realistic, busy restaurant so every dashboard and guest screen has content:
 * long names, photos, variants, allergens, orders in every state, bills, reservations,
 * promotions, reviews, loyalty members, staff tasks, an import in review, plus a second
 * restaurant still in onboarding and a Super Admin.
 *
 *   UX_DATABASE_URL=postgresql://…/menuniva_test_ux npx tsx --conditions=react-server audit/ux/seed-ux.ts
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import pg from 'pg';

const URL_ = process.env.UX_DATABASE_URL ?? '';
if (!/\/menuniva_test_ux(\?|$)/.test(URL_)) {
  console.error('UX_DATABASE_URL must point to the isolated menuniva_test_ux database.');
  process.exit(1);
}
process.env.DATABASE_URL = URL_;
process.env.APP_ENV = 'test';
process.env.UPLOAD_DIR = './storage/ux-uploads';
process.env.STORAGE_DRIVER = 'local';

const LANGS = ['pt', 'en', 'fr', 'ar', 'es'] as const;
type L = (typeof LANGS)[number];
type Names = Partial<Record<L, string>>;

/** Real PNG with a diagonal two-colour gradient (looks like a photo placeholder, not a flat block). */
function gradientPng(w: number, h: number, a: [number, number, number], b: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      row[1 + x * 3] = Math.round(a[0] + (b[0] - a[0]) * t);
      row[2 + x * 3] = Math.round(a[1] + (b[1] - a[1]) * t);
      row[3 + x * 3] = Math.round(a[2] + (b[2] - a[2]) * t);
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function storeImage(orgId: string, folder: 'products' | 'branding', png: Buffer) {
  const key = `${orgId}/${folder}/${randomBytes(16).toString('base64url')}.png`;
  const full = path.resolve('storage/ux-uploads', key);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, png);
  return `/media/${key}`;
}

async function wipe() {
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  const { rows } = await c.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'");
  if (rows.length) await c.query(`TRUNCATE TABLE ${rows.map((r) => `"public"."${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await c.end();
}

const ALL_DAY = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '00:00', close: '00:00' }]]));

async function main() {
  await wipe();
  const { db } = await import('../../src/server/db');
  const { hashPassword } = await import('../../src/server/auth/password');
  const { createRestaurant } = await import('../../src/server/services/organizations');
  const { resolveTenantAccess } = await import('../../src/server/tenant');
  const { submitTableOrder, changeOrderStatus, setOrderPriority } = await import('../../src/server/services/orders');
  const { recordPayment } = await import('../../src/server/services/bills');
  const { submitFeedback } = await import('../../src/server/services/feedback');
  const { submitPickupOrder, submitDeliveryOrder, assignDriver } = await import('../../src/server/services/fulfilment');
  const { requestReservation } = await import('../../src/server/services/reservations');
  const { createTableRequest } = await import('../../src/server/services/staff-tasks');
  const { startImport } = await import('../../src/server/import/service');

  const password = 'ux-audit-password-123';
  const passwordHash = await hashPassword(password);
  const user = (email: string, name: string, extra: Record<string, unknown> = {}) => db.user.create({ data: { email, name, passwordHash, preferredLanguage: 'en', ...extra } });

  const admin = await user('admin@ux.menuniva.local', 'Platform Admin', { platformRole: 'PLATFORM_SUPER_ADMIN' });
  const owner = await user('owner@ux.menuniva.local', 'Ana Ribeiro');
  const roles = ['RESTAURANT_MANAGER', 'WAITER', 'KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'] as const;
  const staff = await Promise.all(roles.map((r, i) => user(`${['manager', 'waiter', 'kitchen', 'cafe', 'driver'][i]}@ux.menuniva.local`, ['Bruno Costa', 'Carla Mendes', 'Diogo Faria', 'Eva Sousa', 'Filipe Rocha'][i])));

  const { org, location } = await createRestaurant({ name: 'Casa Aurora — Cozinha Mediterrânica', country: 'PT', city: 'Braga', locationName: 'Casa Aurora Centro' }, { ownerUserId: owner.id, actorUserId: owner.id });
  await db.restaurantMembership.createMany({ data: roles.map((role, i) => ({ userId: staff[i].id, organizationId: org.id, role })) });
  await db.restaurantOrganization.update({ where: { id: org.id }, data: { slug: 'casa-aurora', status: 'ACTIVE', enabledLanguages: [...LANGS], legalName: 'Casa Aurora Restauração, Lda. (fictícia)' } });
  const slug = 'casa-aurora';

  const logo = storeImage(org.id, 'branding', gradientPng(256, 256, [31, 92, 74], [184, 151, 90]));
  const cover = storeImage(org.id, 'branding', gradientPng(1600, 600, [24, 60, 50], [214, 170, 100]));
  await db.restaurantBranding.update({ where: { organizationId: org.id }, data: { themePreset: 'moroccan', logoUrl: logo, coverUrl: cover, tagline: 'Sabores do Mediterrâneo no centro histórico de Braga' } });

  const kitchen = await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: 'Cozinha principal', type: 'KITCHEN', sortOrder: 0 } });
  const cafe = await db.kitchenStation.create({ data: { organizationId: org.id, locationId: location.id, name: 'Bar & Café', type: 'CAFE', sortOrder: 1 } });

  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: org.id } });
  const CATS: { key: string; names: Names; station: string }[] = [
    { key: 'starters', names: { pt: 'Entradas', en: 'Starters', fr: 'Entrées', ar: 'مقبلات', es: 'Entrantes' }, station: kitchen.id },
    { key: 'mains', names: { pt: 'Pratos principais', en: 'Main courses', fr: 'Plats principaux', ar: 'أطباق رئيسية', es: 'Platos principales' }, station: kitchen.id },
    { key: 'veg', names: { pt: 'Vegetariano', en: 'Vegetarian', fr: 'Végétarien', es: 'Vegetariano' }, station: kitchen.id },
    { key: 'desserts', names: { pt: 'Sobremesas', en: 'Desserts', fr: 'Desserts', ar: 'حلويات', es: 'Postres' }, station: kitchen.id },
    { key: 'hot', names: { pt: 'Bebidas quentes', en: 'Hot drinks', fr: 'Boissons chaudes', ar: 'مشروبات ساخنة', es: 'Bebidas calientes' }, station: cafe.id },
    { key: 'cold', names: { pt: 'Bebidas frias', en: 'Cold drinks' }, station: cafe.id },
  ];
  const cat: Record<string, string> = {};
  for (const [i, c] of CATS.entries()) {
    const row = await db.menuCategory.create({
      data: {
        organizationId: org.id,
        menuId: menu.id,
        sortOrder: i,
        defaultStationId: c.station,
        translations: { create: Object.entries(c.names).map(([l, name]) => ({ language: l as L, name: name!, status: l === 'pt' ? 'SOURCE' : 'REVIEWED' })) },
      },
    });
    cat[c.key] = row.id;
  }

  type Dish = { cat: string; names: Names; desc?: Names; cents: number; take?: number; deliv?: number; photo?: [number, number, number][]; featured?: boolean; popular?: boolean; soldOut?: boolean; variants?: boolean; modifiers?: boolean; allergens?: string[]; tags?: string[]; draft?: boolean };
  const D: Dish[] = [
    { cat: 'starters', names: { pt: 'Harira tradicional', en: 'Traditional harira soup', fr: 'Harira traditionnelle', ar: 'حريرة تقليدية', es: 'Harira tradicional' }, desc: { pt: 'Sopa de tomate, grão-de-bico e lentilhas com coentros frescos e limão.', en: 'Tomato, chickpea and lentil soup with fresh coriander and lemon.' }, cents: 550, take: 500, deliv: 600, photo: [[180, 70, 40], [240, 160, 80]], popular: true, allergens: ['CELERY'] },
    { cat: 'starters', names: { pt: 'Briouats de queijo de cabra e mel', en: 'Goat cheese and honey briouats' }, desc: { pt: 'Folhado estaladiço recheado com queijo de cabra, mel de rosmaninho e amêndoa torrada.' }, cents: 750, take: 700, photo: [[200, 150, 70], [250, 220, 150]], allergens: ['GLUTEN', 'MILK', 'NUTS'] },
    { cat: 'starters', names: { pt: 'Salada marroquina de laranja, rabanete e azeitona preta com hortelã', en: 'Moroccan orange, radish and black olive salad with mint' }, cents: 690, take: 650, photo: [[230, 120, 30], [120, 160, 60]] },
    { cat: 'starters', names: { pt: 'Hummus com pão pita', en: 'Hummus with pita bread', fr: 'Houmous et pain pita' }, cents: 600, take: 550, deliv: 650 },
    { cat: 'mains', names: { pt: 'Tajine de frango com limão confitado e azeitonas', en: 'Chicken tagine with preserved lemon and olives', fr: 'Tajine de poulet au citron confit', ar: 'طاجين دجاج بالليمون المصبر', es: 'Tajín de pollo con limón confitado' }, desc: { pt: 'Frango do campo cozinhado lentamente em tajine de barro com cebola, açafrão, gengibre, limão confitado e azeitonas violeta. Servido com pão caseiro.', en: 'Free-range chicken slow-cooked in a clay tagine with onion, saffron, ginger, preserved lemon and violet olives. Served with home-made bread.' }, cents: 1650, take: 1550, deliv: 1750, photo: [[150, 90, 30], [230, 190, 90]], featured: true, popular: true, variants: true, modifiers: true, allergens: ['GLUTEN'] },
    { cat: 'mains', names: { pt: 'Cuscuz real com sete legumes e borrego', en: 'Royal couscous with seven vegetables and lamb', fr: 'Couscous royal aux sept légumes', es: 'Cuscús real con siete verduras y cordero' }, desc: { pt: 'O prato de sexta-feira: sêmola de trigo, borrego, grão-de-bico e sete legumes da época.' }, cents: 1850, take: 1750, deliv: 1950, photo: [[200, 160, 80], [120, 80, 40]], featured: true, allergens: ['GLUTEN', 'CELERY'] },
    { cat: 'mains', names: { pt: 'Pastilla de pombo e amêndoa', en: 'Pigeon and almond pastilla' }, cents: 2200, photo: [[170, 120, 60], [240, 220, 190]], soldOut: true, allergens: ['GLUTEN', 'EGGS', 'NUTS'] },
    { cat: 'mains', names: { pt: 'Kefta de borrego grelhada', en: 'Grilled lamb kefta', ar: 'كفتة لحم الضأن المشوية' }, cents: 1500, take: 1400, deliv: 1600, photo: [[110, 50, 30], [200, 100, 60]] },
    { cat: 'mains', names: { pt: 'Robalo grelhado com chermoula', en: 'Grilled sea bass with chermoula' }, desc: { pt: 'Robalo fresco do dia, marinado em chermoula de coentros, cominhos e limão.' }, cents: 1990, take: 1890, photo: [[60, 110, 140], [200, 220, 230]], allergens: ['FISH'] },
    { cat: 'mains', names: { pt: 'Prato do dia' }, cents: 1100, draft: true },
    { cat: 'veg', names: { pt: 'Tajine de legumes e grão', en: 'Vegetable and chickpea tagine' }, cents: 1350, take: 1250, deliv: 1450, photo: [[90, 140, 60], [220, 180, 70]], tags: ['vegan'] },
    { cat: 'veg', names: { pt: 'Falafel com molho de tahini', en: 'Falafel with tahini sauce' }, cents: 1100, take: 1000, deliv: 1200, allergens: ['SESAME'] },
    { cat: 'desserts', names: { pt: 'Pastéis de amêndoa e água de flor de laranjeira', en: 'Almond and orange-blossom pastries' }, cents: 450, take: 400, photo: [[230, 200, 150], [250, 240, 220]], allergens: ['NUTS', 'GLUTEN'] },
    { cat: 'desserts', names: { pt: 'Laranja com canela', en: 'Orange with cinnamon' }, cents: 400, take: 380 },
    { cat: 'hot', names: { pt: 'Chá de menta', en: 'Mint tea', fr: 'Thé à la menthe', ar: 'شاي بالنعناع', es: 'Té de menta' }, cents: 250, take: 250, deliv: 300, photo: [[60, 120, 60], [190, 220, 160]], popular: true, variants: true },
    { cat: 'hot', names: { pt: 'Café expresso', en: 'Espresso' }, cents: 120, take: 120 },
    { cat: 'hot', names: { pt: 'Café com especiarias (canela, cardamomo e cravinho)', en: 'Spiced coffee (cinnamon, cardamom and clove)' }, cents: 220, take: 220 },
    { cat: 'cold', names: { pt: 'Limonada de hortelã', en: 'Mint lemonade' }, cents: 350, take: 350, deliv: 400, photo: [[230, 230, 120], [120, 200, 120]] },
    { cat: 'cold', names: { pt: 'Água mineral 50 cl', en: 'Still water 50 cl' }, cents: 180, take: 180, deliv: 200 },
    { cat: 'cold', names: { pt: 'Sumo natural de laranja', en: 'Fresh orange juice' }, cents: 380, take: 380, deliv: 420 },
  ];
  const ids: string[] = [];
  for (const [i, d] of D.entries()) {
    const p = await db.menuProduct.create({
      data: {
        organizationId: org.id,
        menuId: menu.id,
        categoryId: cat[d.cat],
        status: d.draft ? 'DRAFT' : 'ACTIVE',
        sortOrder: i,
        soldOut: !!d.soldOut,
        isFeatured: !!d.featured,
        isPopular: !!d.popular,
        tags: d.tags ?? [],
        allergensVerifiedAt: d.allergens ? new Date() : null,
        allergensVerifiedById: d.allergens ? owner.id : null,
        translations: {
          create: Object.entries(d.names).map(([l, name]) => ({ language: l as L, name: name!, description: d.desc?.[l as L] ?? null, status: l === 'pt' ? 'SOURCE' : 'REVIEWED' })),
        },
        prices: {
          create: [
            ...(d.draft ? [] : [{ channel: 'DINE_IN' as const, amountCents: d.cents }]),
            ...(d.take ? [{ channel: 'TAKEAWAY' as const, amountCents: d.take }] : []),
            ...(d.deliv ? [{ channel: 'DELIVERY' as const, amountCents: d.deliv }] : []),
          ],
        },
        ...(d.variants
          ? { variants: { create: [{ names: { pt: 'Normal', en: 'Regular' }, priceDeltaCents: 0, isDefault: true, sortOrder: 0 }, { names: { pt: 'Grande', en: 'Large' }, priceDeltaCents: d.cat === 'hot' ? 150 : 400, sortOrder: 1 }] } }
          : {}),
        ...(d.modifiers
          ? {
              modifierGroups: {
                create: [
                  { names: { pt: 'Acompanhamento', en: 'Side' }, minSelect: 1, maxSelect: 1, sortOrder: 0, options: { create: [{ names: { pt: 'Pão caseiro', en: 'Home-made bread' }, sortOrder: 0 }, { names: { pt: 'Cuscuz', en: 'Couscous' }, priceDeltaCents: 150, sortOrder: 1 }, { names: { pt: 'Arroz de açafrão', en: 'Saffron rice' }, priceDeltaCents: 200, sortOrder: 2 }] } },
                  { names: { pt: 'Extras', en: 'Extras' }, minSelect: 0, maxSelect: 3, sortOrder: 1, options: { create: [{ names: { pt: 'Azeitonas extra', en: 'Extra olives' }, priceDeltaCents: 100, sortOrder: 0 }, { names: { pt: 'Harissa picante', en: 'Spicy harissa' }, priceDeltaCents: 50, sortOrder: 1 }, { names: { pt: 'Ovo cozido', en: 'Boiled egg' }, priceDeltaCents: 80, sortOrder: 2 }] } },
                ],
              },
            }
          : {}),
        ...(d.allergens ? { allergens: { create: d.allergens.map((a) => ({ allergen: a as never, presence: 'CONTAINS' as const, verifiedAt: new Date(), verifiedById: owner.id })) } } : {}),
      },
    });
    if (d.photo) await db.productImage.create({ data: { productId: p.id, url: storeImage(org.id, 'products', gradientPng(800, 600, d.photo[0], d.photo[1])), rightsConfirmed: true, sortOrder: 0 } });
    ids.push(p.id);
  }
  const P = (name: string) => ids[D.findIndex((d) => d.names.pt === name)];

  // Areas and tables
  const areaNames = ['Sala principal', 'Esplanada', 'Tenda marroquina (café)'];
  const areas = [];
  for (const [i, name] of areaNames.entries()) areas.push(await db.diningArea.create({ data: { organizationId: org.id, locationId: location.id, name, sortOrder: i } }));
  const tables: { id: string; label: string; token: string }[] = [];
  for (let n = 1; n <= 12; n++) {
    const t = await db.restaurantTable.create({
      data: { organizationId: org.id, locationId: location.id, areaId: areas[n <= 6 ? 0 : n <= 9 ? 1 : 2].id, label: String(n).padStart(2, '0'), seats: n % 3 === 0 ? 6 : 4, sortOrder: n, qrTokens: { create: { token: randomBytes(16).toString('base64url') } } },
      include: { qrTokens: true },
    });
    tables.push({ id: t.id, label: t.label, token: t.qrTokens[0].token });
  }

  await db.restaurantLocation.update({
    where: { id: location.id },
    data: {
      slug: 'centro',
      isPublished: true,
      publishedAt: new Date(),
      tableOrderingEnabled: true,
      takeawayEnabled: true,
      deliveryEnabled: true,
      reservationsEnabled: true,
      whatsappOrderingEnabled: true,
      addressLine1: 'Rua do Souto, 101',
      postalCode: '4700-329',
      city: 'Braga',
      phone: '+351 253 000 000',
      whatsappNumber: '+351 910 000 000',
      email: 'ola@casa-aurora.example',
      websiteUrl: 'https://casa-aurora.example',
      instagramUrl: 'https://instagram.com/casa.aurora.example',
      glovoUrl: 'https://glovoapp.com/pt/en/braga/casa-aurora-example/',
      openingHours: ALL_DAY,
    },
  });
  await db.takeawaySettings.upsert({ where: { locationId: location.id }, update: { pickupPoint: 'Balcão da entrada', leadTimeMinutes: 20 }, create: { locationId: location.id, pickupPoint: 'Balcão da entrada' } });
  await db.deliverySettings.upsert({ where: { locationId: location.id }, update: { cashOnDeliveryEnabled: true, cardOnDeliveryEnabled: true }, create: { locationId: location.id, cashOnDeliveryEnabled: true, cardOnDeliveryEnabled: true } });
  await db.deliveryZone.createMany({
    data: [
      { organizationId: org.id, locationId: location.id, name: 'Centro histórico', postalCodePatterns: ['4700-3*', '4700-4*'], feeCents: 200, minOrderCents: 1000, freeDeliveryThresholdCents: 3000, estimatedMinutes: 30, sortOrder: 0 },
      { organizationId: org.id, locationId: location.id, name: 'São Vicente e Maximinos', postalCodePatterns: ['4700-0*', '4705-*'], feeCents: 350, minOrderCents: 1500, estimatedMinutes: 45, sortOrder: 1 },
    ],
  });
  await db.reservationSettings.upsert({ where: { locationId: location.id }, update: { minNoticeMinutes: 30 }, create: { locationId: location.id, minNoticeMinutes: 30 } });
  await db.reviewSettings.upsert({ where: { locationId: location.id }, update: { googleReviewUrl: 'https://g.page/r/casa-aurora-example/review' }, create: { locationId: location.id, googleReviewUrl: 'https://g.page/r/casa-aurora-example/review' } });
  await db.loyaltyProgram.update({ where: { organizationId: org.id }, data: { enabled: true, type: 'STAMPS', stampsForReward: 8, rewardDescription: { pt: 'Um chá de menta grátis' } } });
  await db.restaurantSettings.update({ where: { organizationId: org.id }, data: { allergyNotice: { pt: 'Informe a equipa sobre alergias antes de encomendar.', en: 'Tell our team about any allergies before ordering.' } } });

  // Promotions
  const promo1 = await db.promotion.create({ data: { organizationId: org.id, name: 'Happy hour do chá (2×1)', type: 'BUY_X_GET_Y', buyQuantity: 2, getQuantity: 1, productIds: [P('Chá de menta')], channels: ['TABLE', 'TAKEAWAY'], priority: 2, description: { pt: 'Leve 2 chás, pague 1', en: 'Buy 2 teas, pay 1' } } });
  const promo2 = await db.promotion.create({ data: { organizationId: org.id, name: 'Bem-vindo 10 %', type: 'PERCENTAGE', percentBasisPoints: 1000, requiresCode: true, minOrderCents: 2000, priority: 5, channels: ['TAKEAWAY', 'DELIVERY'] } });
  await db.coupon.create({ data: { organizationId: org.id, promotionId: promo2.id, code: 'BEMVINDO10', usageLimit: 100 } });
  await db.promotion.create({ data: { organizationId: org.id, name: 'Menu almoço (expirado)', type: 'FIXED_AMOUNT', amountCents: 300, isActive: false, endsAt: new Date(Date.now() - 7 * 86400_000) } });
  void promo1;

  await db.upsellRule.create({ data: { organizationId: org.id, triggerCategoryId: cat.mains, suggestedProductId: P('Chá de menta'), priority: 1 } });
  await db.upsellRule.create({ data: { organizationId: org.id, triggerProductId: P('Harira tradicional'), suggestedProductId: P('Hummus com pão pita'), priority: 0 } });

  // Orders
  const ctx = await resolveTenantAccess(owner.id, slug);
  const order = async (table: number, items: [string, number, Record<string, unknown>?][], lang: L = 'pt', notes?: string) => {
    const o = await submitTableOrder(
      { qrToken: tables[table].token, idempotencyKey: randomUUID(), language: lang, notes, items: items.map(([n, q, extra]) => ({ productId: P(n), quantity: q, modifiers: [], ...(extra ?? {}) })) },
      `ux-${randomUUID()}`,
    );
    return { ...o, row: await db.order.findFirstOrThrow({ where: { organizationId: org.id, number: o.orderNumber } }) };
  };
  const tajine = await db.menuProduct.findUniqueOrThrow({ where: { id: P('Tajine de frango com limão confitado e azeitonas') }, include: { variants: true, modifierGroups: { include: { options: true } } } });
  const tajineOpts = { variantId: tajine.variants.find((v) => v.isDefault)!.id, modifiers: [{ optionId: tajine.modifierGroups[0].options[1].id, quantity: 1 }, { optionId: tajine.modifierGroups[1].options[1].id, quantity: 1 }] };
  const tea = await db.menuProduct.findUniqueOrThrow({ where: { id: P('Chá de menta') }, include: { variants: true } });
  const teaOpts = { variantId: tea.variants.find((v) => v.isDefault)!.id };

  const tracking: Record<string, string> = {};
  // completed + paid
  for (const [t, items] of [
    [0, [['Tajine de frango com limão confitado e azeitonas', 2, tajineOpts], ['Chá de menta', 2, teaOpts]]],
    [1, [['Cuscuz real com sete legumes e borrego', 1], ['Limonada de hortelã', 1]]],
    [2, [['Kefta de borrego grelhada', 1], ['Água mineral 50 cl', 2]]],
  ] as [number, [string, number, Record<string, unknown>?][]][]) {
    const o = await order(t, items);
    await changeOrderStatus(ctx, { orderId: o.row.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    await db.kitchenTicket.updateMany({ where: { orderId: o.row.id }, data: { status: 'READY' } });
    await changeOrderStatus(ctx, { orderId: o.row.id, expectedFrom: 'ACCEPTED', to: 'READY' });
    await changeOrderStatus(ctx, { orderId: o.row.id, expectedFrom: 'READY', to: 'COMPLETED' });
    await recordPayment(ctx, { orderId: o.row.id, method: t === 1 ? 'CARD_TERMINAL' : 'CASH', amountCents: o.row.totalCents });
    tracking.completed = o.trackingToken;
  }
  // active table orders in several states (table 04 has two orders → merged bill, partly paid)
  const a1 = await order(3, [['Harira tradicional', 2], ['Briouats de queijo de cabra e mel', 1], ['Chá de menta', 3, teaOpts]], 'en', 'One harira without coriander, please.');
  await changeOrderStatus(ctx, { orderId: a1.row.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
  await changeOrderStatus(ctx, { orderId: a1.row.id, expectedFrom: 'ACCEPTED', to: 'PREPARING' });
  tracking.preparing = a1.trackingToken;
  const a2 = await order(3, [['Pastéis de amêndoa e água de flor de laranjeira', 2]]);
  await changeOrderStatus(ctx, { orderId: a2.row.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
  await recordPayment(ctx, { orderId: a1.row.id, method: 'CASH', amountCents: 1000 });
  const a3 = await order(4, [['Robalo grelhado com chermoula', 1], ['Sumo natural de laranja', 1]], 'fr');
  await changeOrderStatus(ctx, { orderId: a3.row.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
  await db.kitchenTicket.updateMany({ where: { orderId: a3.row.id }, data: { status: 'READY' } });
  await changeOrderStatus(ctx, { orderId: a3.row.id, expectedFrom: 'ACCEPTED', to: 'READY' });
  tracking.ready = a3.trackingToken;
  const n1 = await order(6, [['Tajine de legumes e grão', 1], ['Falafel com molho de tahini', 1], ['Café com especiarias (canela, cardamomo e cravinho)', 2]], 'ar');
  tracking.newOrder = n1.trackingToken;
  const n2 = await order(7, [['Salada marroquina de laranja, rabanete e azeitona preta com hortelã', 1], ['Café expresso', 1]], 'es');
  await setOrderPriority(ctx, n2.row.id, true).catch(() => {});
  const c1 = await order(8, [['Hummus com pão pita', 1]]);
  await changeOrderStatus(ctx, { orderId: c1.row.id, expectedFrom: 'NEW', to: 'CANCELLED', reason: 'Guest left before ordering was confirmed' }).catch(() => {});

  // takeaway + delivery
  const tk = await submitPickupOrder({ orgSlug: slug, idempotencyKey: randomUUID(), language: 'pt', pickup: 'asap', customerName: 'Joana Pereira', phone: '+351912345678', items: [{ productId: P('Cuscuz real com sete legumes e borrego'), quantity: 2, modifiers: [] }, { productId: P('Limonada de hortelã'), quantity: 2, modifiers: [] }] }, `ux-${randomUUID()}`);
  tracking.pickup = tk.trackingToken;
  const dl = await submitDeliveryOrder(
    { orgSlug: slug, idempotencyKey: randomUUID(), language: 'en', customerName: 'Mark Johnson', phone: '+351913333444', address: 'Rua dos Chãos, 45, 2.º esq.', postalCode: '4700-345', city: 'Braga', paymentMethod: 'CASH_ON_DELIVERY', deliveryNotes: 'Ring twice, 2nd floor', items: [{ productId: P('Tajine de legumes e grão'), quantity: 1, modifiers: [] }, { productId: P('Harira tradicional'), quantity: 2, modifiers: [] }] },
    `ux-${randomUUID()}`,
  );
  tracking.delivery = dl.trackingToken;
  const dlRow = await db.order.findFirstOrThrow({ where: { organizationId: org.id, channel: 'DELIVERY' } });
  await changeOrderStatus(ctx, { orderId: dlRow.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
  await db.kitchenTicket.updateMany({ where: { orderId: dlRow.id }, data: { status: 'READY' } });
  await changeOrderStatus(ctx, { orderId: dlRow.id, expectedFrom: 'ACCEPTED', to: 'READY' });
  const driverMembership = await db.restaurantMembership.findFirstOrThrow({ where: { organizationId: org.id, role: 'DELIVERY_STAFF' } });
  await assignDriver(ctx, dlRow.id, driverMembership.id);

  // Staff tasks
  await createTableRequest({ qrToken: tables[3].token, type: 'REQUEST_BILL' }, `ux-${randomUUID()}`);
  await createTableRequest({ qrToken: tables[9].token, type: 'CALL_WAITER' }, `ux-${randomUUID()}`);

  // Reservations: through the service for the coming days, plus direct rows for today
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' });
  const resTokens: string[] = [];
  for (const [d, time, size, name] of [
    [1, '13:00', 4, 'Família Oliveira'],
    [1, '20:00', 2, 'Sophie Martin'],
    [2, '19:30', 8, 'Aniversário da Rita — mesa grande junto à janela, por favor'],
  ] as [number, string, number, string][]) {
    const r = await requestReservation({ orgSlug: slug, date: day(d), time, partySize: size, name, phone: '+351 914 000 111', email: 'guest@example.com', specialRequest: size === 8 ? 'Precisamos de uma cadeira de bebé e de um bolo à sobremesa.' : undefined, idempotencyKey: randomUUID(), language: 'pt' }, `ux-${randomUUID()}`);
    resTokens.push(r.token);
  }
  const todayAt = (h: number, m: number) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };
  for (const [h, m, size, name, status] of [
    [12, 30, 2, 'Pedro Alves', 'COMPLETED'],
    [19, 0, 4, 'Grupo Erasmus', 'CONFIRMED'],
    [20, 30, 3, 'Laura Gómez', 'REQUESTED'],
    [21, 0, 6, 'Jantar de empresa — Contabilidade Minho', 'CONFIRMED'],
  ] as [number, number, number, string, 'COMPLETED' | 'CONFIRMED' | 'REQUESTED'][]) {
    await db.reservation.create({ data: { organizationId: org.id, locationId: location.id, startsAt: todayAt(h, m), endsAt: new Date(todayAt(h, m).getTime() + 90 * 60_000), partySize: size, name, phone: '+351 915 222 333', status, trackingTokenHash: randomBytes(32).toString('hex'), idempotencyKey: randomUUID() } });
  }

  // Feedback (5★, 3★ and a 1★ with follow-up → low-rating alert)
  await submitFeedback({ orgSlug: slug, rating: 5, comment: 'O melhor tajine que comi fora de Marrocos. Voltaremos!', language: 'pt' }, `ux-${randomUUID()}`);
  await submitFeedback({ orgSlug: slug, rating: 3, categories: ['WAITING_TIME'], comment: 'Comida boa, mas esperámos 40 minutos pelo prato principal.', language: 'pt' }, `ux-${randomUUID()}`);
  await submitFeedback({ orgSlug: slug, rating: 1, categories: ['SERVICE', 'FOOD_QUALITY'], comment: 'The couscous was cold and nobody came to check on us.', wantsFollowUp: true, contactName: 'Tom', contactInfo: 'tom@example.com', language: 'en' }, `ux-${randomUUID()}`);

  // Loyalty members
  for (const [phone, name, balance, birthday] of [
    ['+351911111111', 'Marta Lopes', 5, '11-12'],
    ['+351922222222', 'Rui Gomes', 8, null],
    ['+351933333333', null, 1, null],
  ] as [string, string | null, number, string | null][]) {
    const acc = await db.loyaltyAccount.create({ data: { organizationId: org.id, phone, name, balance, birthday, consentAt: new Date(), marketingOptIn: !!birthday, marketingOptInAt: birthday ? new Date() : null } });
    await db.loyaltyTransaction.create({ data: { accountId: acc.id, type: 'EARN', amount: balance, note: 'Seed' } });
  }

  // Import in review
  const csv = ['categoria;nome;descrição;preço', 'Entradas;Zaalouk de beringela;Salada morna de beringela e tomate;6,50', 'Entradas;Harira tradicional;;5,50', 'Pratos;Tanjia de vitela;Cozinhada 8 horas em ânfora de barro;19,90', 'Pratos;Mechoui de borrego;;', 'Sobremesas;Chebakia;Bolinhos de sésamo e mel;3,90', 'Bebidas;Chá de menta;;2,50'].join('\n');
  const imp = await startImport(ctx, { type: 'CSV', text: csv, fileName: 'menu-inverno.csv' });

  await db.supportTicket.create({ data: { organizationId: org.id, subject: 'Como imprimo os QR codes em A5?', body: 'Gostaria de imprimir 2 QR por folha A5 para as mesas da esplanada.', createdById: owner.id } });

  // Second restaurant still in onboarding (empty dashboard / setup wizard)
  const owner2 = await user('newowner@ux.menuniva.local', 'Nuno Teixeira');
  const second = await createRestaurant({ name: 'Tasca Nova', country: 'PT', city: 'Porto' }, { ownerUserId: owner2.id, actorUserId: owner2.id });

  console.log(
    JSON.stringify({
      password,
      slug,
      orgId: org.id,
      secondSlug: second.org.slug,
      admin: admin.email,
      owner: owner.email,
      newOwner: owner2.email,
      staff: Object.fromEntries(roles.map((r, i) => [r, staff[i].email])),
      tables: tables.map((t) => t.token),
      tracking,
      reservationTokens: resTokens,
      importJobId: imp.jobId,
      productIds: { tajine: tajine.id, tea: tea.id, harira: P('Harira tradicional'), draft: P('Prato do dia') },
      categoryId: cat.mains,
      kitchenStationId: kitchen.id,
      cafeStationId: cafe.id,
    }),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
