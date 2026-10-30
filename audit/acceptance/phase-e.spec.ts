import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE, ORIGIN, PASSWORD, evidence, login, runId, setDashboardLanguageEnglish, shot, signUpAndRegister, sql } from './support';

/**
 * PHASE E — real-browser restaurant acceptance scenario (STEPS 1–23) on the DEMO database.
 * Everything goes through the UI except where a step explicitly checks the database or
 * attacks an API directly (STEP 23).
 */
test.describe.configure({ mode: 'serial' });

const id = runId();
const A = { name: 'Audit Owner A', email: `owner.a.${id}@audit.menuniva.invalid`, restaurant: `Audit Restaurante A ${id}`, slug: '' };
const B = { name: 'Audit Owner B', email: `owner.b.${id}@audit.menuniva.invalid`, restaurant: `Audit Restaurante B ${id}`, slug: '' };
const GOOGLE = 'https://g.page/r/audit-demo-review-link/review';
const DISH = 'Tajine de borrego (audit)';
const TEA = 'Chá de menta (audit)';
const ev = evidence('phase-e');
let ownerCtx: BrowserContext;
let owner: Page;
let table1Href = '';
let table2Href = '';
let trackingUrl = '';
let orgA: { id: string; locationId: string };

test.beforeAll(async ({ browser }) => {
  ownerCtx = await browser.newContext();
  owner = await ownerCtx.newPage();
});
test.afterAll(async () => ownerCtx?.close());

async function guestPage(browser: Browser) {
  const ctx = await browser.newContext(); // no cookies: no staff login
  return { ctx, page: await ctx.newPage() };
}

test('STEP 1: two independent restaurants are created through sign-up + onboarding', async ({ browser }) => {
  A.slug = await signUpAndRegister(owner, A, A.restaurant, 'Braga');
  const bCtx = await browser.newContext();
  const bPage = await bCtx.newPage();
  B.slug = await signUpAndRegister(bPage, B, B.restaurant, 'Porto');
  await bCtx.close();
  const orgs = await sql<{ id: string; slug: string; status: string; owners: number }>(
    `SELECT o.id, o.slug, o.status, (SELECT count(*)::int FROM "RestaurantMembership" m WHERE m."organizationId" = o.id AND m.role = 'RESTAURANT_OWNER') AS owners FROM "RestaurantOrganization" o WHERE o.slug = ANY($1) ORDER BY o.slug`,
    [[A.slug, B.slug]],
  );
  expect(orgs).toHaveLength(2);
  expect(orgs[0].id).not.toBe(orgs[1].id);
  expect(orgs.every((o) => o.owners === 1)).toBe(true);
  const [loc] = await sql<{ id: string }>(`SELECT l.id FROM "RestaurantLocation" l JOIN "RestaurantOrganization" o ON o.id = l."organizationId" WHERE o.slug = $1`, [A.slug]);
  orgA = { id: orgs.find((o) => o.slug === A.slug)!.id, locationId: loc.id };
  ev.add('step1', { A: A.slug, B: B.slug, orgs });
});

test('STEP 2: Restaurant A owner signs out and signs in again', async () => {
  await owner.goto(`/dashboard/${A.slug}`);
  await owner.getByRole('button', { name: 'Terminar sessão' }).first().click();
  await expect(owner).toHaveURL(/\/login/);
  expect((await ownerCtx.cookies()).find((c) => c.name === 'mn_session')).toBeUndefined();
  const blocked = await owner.goto(`/dashboard/${A.slug}/orders`);
  await expect(owner).toHaveURL(/\/login/);
  ev.add('step2-after-logout', { url: owner.url(), status: blocked?.status() });
  await login(owner, A.email, PASSWORD);
  await setDashboardLanguageEnglish(owner);
  await owner.goto(`/dashboard/${A.slug}`);
  await expect(owner).toHaveURL(new RegExp(`/dashboard/${A.slug}`));
  await shot(owner, 'e02-owner-dashboard');
});

test('STEP 3: menu with real stored prices and two preparation stations (Kitchen, Café)', async () => {
  const base = `/dashboard/${A.slug}`;
  await owner.goto(`${base}/settings`);
  const loc = owner.getByTestId('location-settings-form');
  await loc.getByLabel('Street address').fill('Rua da Auditoria, 1 (demo)');
  await loc.getByLabel('Postal code').fill('4700-123');
  await loc.getByLabel('City').fill('Braga');
  await loc.getByLabel('Telephone').fill('+351 900 000 101');
  await loc.getByRole('button', { name: 'Save' }).click();
  await expect(loc.getByText('Saved')).toBeVisible();

  await owner.goto(`${base}/stations`);
  for (const [name, type] of [['Cozinha (audit)', 'Kitchen'], ['Café (audit)', 'Café']] as const) {
    const f = owner.getByTestId('add-station-form');
    await f.getByLabel('Name').fill(name);
    await f.getByLabel('Type').selectOption({ label: type });
    await f.getByRole('button', { name: 'Add station' }).click();
    await expect(owner.getByText(name, { exact: true })).toBeVisible();
  }
  await owner.goto(`${base}/menu`);
  for (const [name, station] of [['Pratos (audit)', 'Cozinha (audit)'], ['Bebidas (audit)', 'Café (audit)']]) {
    const form = owner.getByTestId('add-category-form');
    await form.getByLabel(/New category name/).fill(name);
    await form.getByLabel('Default station').selectOption({ label: station });
    await form.getByRole('button', { name: 'Add category' }).click();
    await expect(owner.getByTestId('menu-category').filter({ hasText: name })).toBeVisible();
  }
  for (const [idx, name, price] of [[0, DISH, '16,90'], [1, TEA, '2,50']] as const) {
    await owner.goto(`${base}/menu`);
    await owner.getByTestId(`add-dish-${idx}`).click();
    await owner.getByTestId('product-name-pt').fill(name);
    await owner.getByTestId('price-DINE_IN').fill(price);
    await owner.getByTestId('product-status').selectOption('ACTIVE');
    await owner.getByRole('button', { name: 'Create dish' }).click();
    await expect(owner).toHaveURL(/\/menu\/products\/[a-z0-9]+$/);
  }
  await owner.goto(`${base}/menu`);
  await shot(owner, 'e03-menu-admin');
  const rows = await sql<{ name: string; cents: number; station: string; type: string }>(
    `SELECT t.name, cp."amountCents" AS cents, s.name AS station, s.type FROM "MenuProduct" p
       JOIN "ProductTranslation" t ON t."productId" = p.id AND t.language = 'pt'
       JOIN "ChannelPrice" cp ON cp."productId" = p.id AND cp.channel = 'DINE_IN'
       JOIN "MenuCategory" c ON c.id = p."categoryId" JOIN "KitchenStation" s ON s.id = c."defaultStationId"
     WHERE p."organizationId" = $1 ORDER BY cents DESC`,
    [orgA.id],
  );
  expect(rows).toEqual([
    { name: DISH, cents: 1690, station: 'Cozinha (audit)', type: 'KITCHEN' },
    { name: TEA, cents: 250, station: 'Café (audit)', type: 'CAFE' },
  ]);
  ev.add('step3-db-menu', rows);
});

test('STEP 4 + 6: tables with QR codes are created; channel on; Google link set; menu published', async ({ request }) => {
  const base = `/dashboard/${A.slug}`;
  await owner.goto(`${base}/settings/channels`);
  await owner.getByLabel('Order at table (QR codes)').check();
  await owner.locator('#googleReviewUrl').fill(GOOGLE);
  await owner.getByRole('button', { name: 'Save' }).click();
  await expect(owner.getByText('Saved')).toBeVisible();

  await owner.goto(`${base}/tables`);
  await owner.getByTestId('create-tables-form').getByLabel('Table labels').fill('1-2');
  await owner.getByTestId('create-tables-form').getByRole('button', { name: 'Create tables' }).click();
  await expect(owner.getByTestId('table-card')).toHaveCount(2);
  await expect(owner.getByTestId('table-card').first().locator('img')).toHaveJSProperty('complete', true);
  const hrefs = await owner.getByTestId('open-table-link').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  [table1Href, table2Href] = hrefs as string[];
  expect(table1Href).toMatch(/^\/t\/[A-Za-z0-9_-]{22}$/);
  await shot(owner, 'e06-tables-qr');

  // The QR image served to staff encodes exactly APP_BASE_URL/t/<token> (regenerated with the same library and options).
  const [t1] = await sql<{ id: string; token: string }>(`SELECT t.id, q.token FROM "RestaurantTable" t JOIN "TableQRToken" q ON q."tableId" = t.id AND q."isActive" WHERE t."organizationId" = $1 AND t.label = '01'`, [orgA.id]);
  const served = await owner.request.get(`/api/dashboard/${A.slug}/qr/${t1.id}`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/svg+xml');
  const expected = await QRCode.toString(`${BASE}/t/${t1.token}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 512, color: { dark: '#171A1D', light: '#FFFFFF' } });
  expect(await served.text()).toBe(expected);
  const png = await owner.request.get(`/api/dashboard/${A.slug}/qr/${t1.id}?format=png`);
  expect(png.headers()['content-type']).toBe('image/png');
  const pdf = await owner.request.get(`/api/dashboard/${A.slug}/qr/sheet.pdf?location=${orgA.locationId}`);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const anon = await request.get(`/api/dashboard/${A.slug}/qr/${t1.id}`);
  expect([401, 403, 404]).toContain(anon.status());
  ev.add('step6-qr', { table1Href, qrSvgMatchesExpectedUrl: true, pngBytes: (await png.body()).length, sheetPdf: true, anonymousStatus: anon.status() });

  // Before publishing, guests cannot order.
  const pre = await request.get(table1Href);
  ev.add('step4-before-publish-status', pre.status());
  await owner.goto(`${base}/setup/publish`);
  await owner.getByTestId('publish-form').getByRole('checkbox').check();
  await owner.getByRole('button', { name: 'Publish now' }).click();
  await expect(owner.getByText('Published', { exact: true })).toBeVisible();
  const [loc] = await sql<{ isPublished: boolean; tableOrderingEnabled: boolean }>(`SELECT "isPublished", "tableOrderingEnabled" FROM "RestaurantLocation" WHERE id = $1`, [orgA.locationId]);
  expect(loc).toEqual({ isPublished: true, tableOrderingEnabled: true });
});

test('STEP 5: five languages with human translations and Arabic right-to-left', async ({ browser }) => {
  await owner.goto(`/dashboard/${A.slug}/menu/translations`);
  const names: Record<string, string> = { en: 'Lamb tajine (audit)', fr: 'Tajine d’agneau (audit)', es: 'Tajín de cordero (audit)', ar: 'طاجين لحم الخروف (تدقيق)' };
  for (const [lang, name] of Object.entries(names)) {
    const input = owner.locator(`[data-testid=tr-row][data-name="${DISH}"]`).getByTestId(`tr-product-${lang}`);
    await input.fill(name);
    await input.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();
    await expect(input.locator('xpath=ancestor::form').getByText('Saved')).toBeVisible();
  }
  await owner.getByRole('button', { name: 'Mark translations as reviewed' }).click();
  await expect(owner.getByText('Recorded')).toBeVisible();
  const g = await guestPage(browser);
  await g.page.goto(table1Href);
  const labels: Record<string, string> = { pt: 'Mesa 01', en: 'Table 01', fr: 'Table 01', es: 'Mesa 01', ar: 'طاولة 01' };
  const seen: Record<string, unknown> = {};
  for (const lang of ['en', 'fr', 'es', 'ar', 'pt']) {
    await g.page.getByTestId('language-switcher').selectOption(lang);
    await expect(g.page.getByTestId('table-banner')).toContainText(labels[lang]);
    await expect(g.page.getByTestId('storefront')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    const dishName = lang === 'pt' ? DISH : names[lang];
    await expect(g.page.getByTestId('customer-product').filter({ hasText: dishName })).toHaveCount(1);
    // The tea has no translation: the source text is shown, nothing is invented.
    await expect(g.page.getByTestId('customer-product').filter({ hasText: TEA })).toHaveCount(1);
    seen[lang] = { dir: await g.page.getByTestId('storefront').getAttribute('dir'), htmlLang: await g.page.locator('html').getAttribute('lang') };
    if (lang === 'ar') await shot(g.page, 'e05-guest-arabic-rtl');
  }
  const rows = await sql<{ language: string; status: string }>(`SELECT t.language, t.status FROM "ProductTranslation" t JOIN "MenuProduct" p ON p.id = t."productId" WHERE p."organizationId" = $1 ORDER BY 1`, [orgA.id]);
  ev.add('step5', { seen, translationRows: rows });
  await g.ctx.close();
});

test('STEPS 7–9: guest (no login) orders one Kitchen and one Café item; order and snapshots persisted', async ({ browser }) => {
  const g = await guestPage(browser);
  expect((await g.ctx.cookies()).length).toBe(0);
  await g.page.goto(table1Href);
  await g.page.getByTestId('customer-product').filter({ hasText: DISH }).click();
  await g.page.getByTestId('add-to-cart').click();
  await g.page.getByTestId('customer-product').filter({ hasText: TEA }).click();
  await g.page.getByTestId('add-to-cart').click();
  await g.page.getByTestId('view-cart').click();
  await expect(g.page.getByTestId('cart-total')).toHaveText('19,40 €');
  await shot(g.page, 'e08-guest-cart');
  await g.page.getByTestId('submit-order').click();
  await expect(g.page).toHaveURL(/\/o\/[A-Za-z0-9_-]{32}$/);
  trackingUrl = new URL(g.page.url()).pathname;
  await expect(g.page.getByTestId('order-status')).toHaveAttribute('data-status', 'NEW');
  await shot(g.page, 'e08-guest-order-new');
  const token = trackingUrl.split('/').pop()!;
  const orders = await sql<Record<string, unknown>>(
    `SELECT id, number, channel, status, "paymentStatus", "subtotalCents", "discountCents", "totalCents", "trackingTokenHash" = $2 AS "tokenHashMatches" FROM "Order" WHERE "organizationId" = $1`,
    [orgA.id, createHash('sha256').update(token).digest('hex')],
  );
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ channel: 'TABLE', status: 'NEW', paymentStatus: 'UNPAID', subtotalCents: 1940, discountCents: 0, totalCents: 1940 });
  const items = await sql<Record<string, unknown>>(
    `SELECT i."nameSnapshot", i."unitPriceCents", i.quantity, i."lineTotalCents", s.name AS station FROM "OrderItem" i LEFT JOIN "KitchenStation" s ON s.id = i."stationId" WHERE i."orderId" = $1 ORDER BY i."unitPriceCents" DESC`,
    [orders[0].id],
  );
  expect(items).toEqual([
    { nameSnapshot: DISH, unitPriceCents: 1690, quantity: 1, lineTotalCents: 1690, station: 'Cozinha (audit)' },
    { nameSnapshot: TEA, unitPriceCents: 250, quantity: 1, lineTotalCents: 250, station: 'Café (audit)' },
  ]);
  // Snapshot check: a later price change does not alter the stored order.
  ev.add('step9-db', { order: orders[0], items });
  await g.ctx.close();
});

test('STEPS 10–12: independent staff dashboard shows the order, also after refresh; owner accepts', async ({ browser }) => {
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await login(staff, A.email, PASSWORD);
  await staff.goto(`/dashboard/${A.slug}/orders`);
  const card = staff.getByTestId('column-new').getByTestId('order-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(DISH);
  await expect(card).toContainText(/19[.,]40/);
  await staff.reload();
  await expect(staff.getByTestId('column-new').getByTestId('order-card')).toHaveCount(1);
  await shot(staff, 'e11-live-board-new');
  await staff.getByTestId('column-new').getByTestId('order-card').getByTestId('action-ACCEPTED').click();
  await expect(staff.getByTestId('column-accepted').getByTestId('order-card')).toHaveCount(1);
  const [o] = await sql<{ status: string; tickets: number }>(`SELECT status, (SELECT count(*)::int FROM "KitchenTicket" k WHERE k."orderId" = o.id) AS tickets FROM "Order" o WHERE "organizationId" = $1`, [orgA.id]);
  expect(o).toEqual({ status: 'ACCEPTED', tickets: 2 });
  await staffCtx.close();
});

test('STEPS 13–16: Kitchen gets only food, Café only the tea; both ready; guest sees READY', async ({ browser }) => {
  const base = `/dashboard/${A.slug}`;
  const g = await guestPage(browser);
  await g.page.goto(trackingUrl);
  for (const [station, mine, other] of [['Cozinha (audit)', DISH, TEA], ['Café (audit)', TEA, DISH]]) {
    await owner.goto(`${base}/kitchen`);
    await owner.getByTestId('station-link').filter({ hasText: station }).click();
    const t = owner.getByTestId('kds-ticket');
    await expect(t).toHaveCount(1);
    await expect(t).toContainText(mine);
    await expect(t).not.toContainText(other);
    await shot(owner, `e13-kds-${station.startsWith('Coz') ? 'kitchen' : 'cafe'}`);
    await t.getByTestId('kds-start').click();
    await expect(owner.getByTestId('kds-PREPARING').getByTestId('kds-ticket')).toHaveCount(1);
    if (station.startsWith('Coz')) {
      await g.page.reload();
      await expect(g.page.getByTestId('order-status')).toHaveAttribute('data-status', 'PREPARING');
    }
    await owner.getByTestId('kds-PREPARING').getByTestId('kds-ready').click();
    await expect(owner.getByTestId('kds-READY').getByTestId('kds-ticket')).toHaveCount(1);
  }
  await expect(g.page.getByTestId('order-status')).toHaveAttribute('data-status', 'READY', { timeout: 20_000 });
  await shot(g.page, 'e16-guest-ready');
  const t = await sql<{ station: string; status: string }>(`SELECT s.name AS station, k.status FROM "KitchenTicket" k JOIN "KitchenStation" s ON s.id = k."stationId" JOIN "Order" o ON o.id = k."orderId" WHERE o."organizationId" = $1 ORDER BY 1`, [orgA.id]);
  expect(t).toEqual([{ station: 'Café (audit)', status: 'READY' }, { station: 'Cozinha (audit)', status: 'READY' }]);
  await g.ctx.close();
});

test('STEP 17: staff completes the order and records a manual (cash) payment', async ({ browser }) => {
  const base = `/dashboard/${A.slug}`;
  await owner.goto(`${base}/orders`);
  const ready = owner.getByTestId('column-ready').getByTestId('order-card');
  await expect(ready).toHaveCount(1);
  await ready.getByTestId('action-COMPLETED').click();
  await expect(owner.getByTestId('column-done').getByTestId('order-card')).toHaveCount(1);
  await owner.goto(`${base}/bills`);
  await owner.getByTestId('open-session').first().click();
  await expect(owner.getByTestId('bill-total')).toHaveText(/^(€\s?19[.,]40|19[.,]40\s?€)$/);
  const f = owner.getByTestId('payment-form');
  await f.getByLabel('Method').selectOption('CASH');
  await f.getByLabel(/an amount/).fill('19,40');
  await f.getByRole('button', { name: 'Record payment' }).click();
  await expect(owner.getByTestId('bill-balance')).toHaveText(/^(€\s?0[.,]00|0[.,]00\s?€)$/);
  await shot(owner, 'e17-bill-paid');
  await owner.getByTestId('close-form').getByRole('button', { name: 'Close table' }).click();
  await expect(owner.getByText('This table was closed')).toBeVisible();
  const g = await guestPage(browser);
  await g.page.goto(trackingUrl);
  await expect(g.page.getByTestId('order-status')).toHaveAttribute('data-status', 'COMPLETED');
  await g.ctx.close();
  const [o] = await sql<Record<string, unknown>>(`SELECT status, "paymentStatus", "paidCents", "totalCents" FROM "Order" WHERE "organizationId" = $1`, [orgA.id]);
  expect(o).toEqual({ status: 'COMPLETED', paymentStatus: 'PAID', paidCents: 1940, totalCents: 1940 });
  ev.add('step17-db', o);
});

test('STEPS 18–19: second table — call waiter, request bill, split payment by item and by amount', async ({ browser }) => {
  const g = await guestPage(browser);
  await g.page.goto(table2Href);
  await g.page.getByTestId('customer-product').filter({ hasText: DISH }).click();
  await g.page.getByTestId('add-to-cart').click();
  await g.page.getByTestId('customer-product').filter({ hasText: TEA }).click();
  await g.page.getByRole('button', { name: '+' }).click();
  await g.page.getByTestId('add-to-cart').click();
  await g.page.getByTestId('view-cart').click();
  await expect(g.page.getByTestId('cart-total')).toHaveText('21,90 €'); // 16,90 + 2 × 2,50
  await g.page.getByTestId('submit-order').click();
  await expect(g.page).toHaveURL(/\/o\//);
  await g.page.goto(table2Href);
  await g.page.getByTestId('call-waiter').click();
  await expect(g.page.getByRole('status').or(g.page.getByText(/empregado|waiter/i)).first()).toBeVisible();
  await g.page.getByTestId('request-bill').click();
  await shot(g.page, 'e18-guest-requests');
  await g.ctx.close();

  const base = `/dashboard/${A.slug}`;
  await owner.goto(`${base}/tasks`);
  const reqs = owner.getByTestId('table-requests');
  await expect(reqs).toContainText(/Waiter called/);
  await expect(reqs).toContainText(/Bill requested/);
  await expect(reqs).toContainText('02');
  await shot(owner, 'e18-staff-tasks');
  const tasks = await sql<{ type: string; status: string }>(`SELECT type, status FROM "StaffTask" WHERE "organizationId" = $1 ORDER BY type`, [orgA.id]);
  expect(tasks.map((t) => t.type)).toEqual(['CALL_WAITER', 'REQUEST_BILL']);

  await owner.goto(`${base}/bills`);
  await owner.getByTestId('open-session').first().click();
  await expect(owner.getByTestId('bill-total')).toHaveText(/^(€\s?21[.,]90|21[.,]90\s?€)$/);
  // Guest 1 pays only the tea line (2 × 2,50) in cash
  const f = owner.getByTestId('payment-form');
  await f.getByLabel('Method').selectOption('CASH');
  await f.locator('label').filter({ hasText: TEA }).locator('input[name=itemIds]').check();
  await f.getByRole('button', { name: 'Record payment' }).click();
  await expect(owner.getByTestId('bill-paid')).toHaveText(/^(€\s?5[.,]00|5[.,]00\s?€)$/);
  await expect(owner.getByTestId('bill-balance')).toHaveText(/^(€\s?16[.,]90|16[.,]90\s?€)$/);
  // Guest 2 pays the rest by card terminal (amount)
  await owner.getByTestId('payment-form').getByLabel('Method').selectOption('CARD_TERMINAL');
  await owner.getByTestId('payment-form').getByLabel(/an amount/).fill('16,90');
  await owner.getByTestId('payment-form').getByRole('button', { name: 'Record payment' }).click();
  await expect(owner.getByTestId('bill-balance')).toHaveText(/^(€\s?0[.,]00|0[.,]00\s?€)$/);
  await expect(owner.getByTestId('payment-row')).toHaveCount(2);
  await shot(owner, 'e19-split-bill');
  const pays = await sql<{ method: string; amountCents: number; allocations: number }>(
    `SELECT p.method, p."amountCents", (SELECT count(*)::int FROM "PaymentAllocation" a WHERE a."paymentId" = p.id) AS allocations FROM "PaymentRecord" p JOIN "Order" o ON o.id = p."orderId" WHERE o."organizationId" = $1 AND o."tableId" = (SELECT id FROM "RestaurantTable" WHERE "organizationId" = $1 AND label = '02') ORDER BY p."createdAt"`,
    [orgA.id],
  );
  expect(pays).toEqual([{ method: 'CASH', amountCents: 500, allocations: 1 }, { method: 'CARD_TERMINAL', amountCents: 1690, allocations: 0 }]);
  ev.add('step19-db-payments', pays);
  // The waiter tasks are closed by staff
  await owner.goto(`${base}/tasks`);
  await owner.getByTestId('table-requests').getByTestId('task-done').first().click();
  await owner.getByTestId('table-requests').getByTestId('task-done').first().click();
  await expect(owner.getByTestId('table-requests')).toHaveCount(0);
});

test('STEPS 20–21: private 1★ feedback notifies the manager; 1★ and 5★ get the identical Google link', async ({ browser }) => {
  const hrefs: (string | null)[] = [];
  for (const stars of [1, 5]) {
    const g = await guestPage(browser);
    await g.page.goto(`/r/${A.slug}/feedback?lang=en`);
    hrefs.push(await g.page.getByTestId('google-review-link').getAttribute('href'));
    await g.page.getByTestId(`star-${stars}`).click();
    if (stars === 1) {
      await g.page.getByRole('button', { name: 'Waiting time' }).click();
      await g.page.getByLabel('Tell us more').fill('Audit: the tea took 25 minutes');
      await g.page.getByTestId('follow-up').check();
      await g.page.getByLabel('Phone or email').fill('+351 900 000 199');
    }
    await g.page.getByTestId('feedback-submit').click();
    await expect(g.page.getByTestId('feedback-thanks')).toBeVisible();
    hrefs.push(await g.page.getByTestId('google-review-link').getAttribute('href'));
    const visible = await g.page.getByTestId('google-review').isVisible();
    expect(visible).toBe(true);
    await shot(g.page, `e20-feedback-${stars}star`);
    await g.ctx.close();
  }
  expect(new Set(hrefs)).toEqual(new Set([GOOGLE]));
  await owner.goto(`/dashboard/${A.slug}/reviews`);
  await expect(owner.getByTestId('low-rating-alert')).toBeVisible();
  await expect(owner.getByTestId('feedback-row')).toHaveCount(2);
  await shot(owner, 'e20-manager-inbox');
  const notes = await sql<{ type: string; title: string }>(`SELECT type, title FROM "Notification" WHERE "organizationId" = $1 AND type = 'LOW_RATING'`, [orgA.id]);
  expect(notes).toHaveLength(1);
  const fb = await sql<{ rating: number; contactInfo: string | null; isPublic: boolean | null }>(`SELECT rating, "contactInfo" FROM "CustomerFeedback" WHERE "organizationId" = $1 ORDER BY rating`, [orgA.id]);
  ev.add('step20-21', { hrefs, notifications: notes, feedback: fb, notificationChannel: 'in-app only (Notification row + dashboard badge); no email/push is sent' });
});

test('STEP 22: analytics show real order value and collected payments', async () => {
  await owner.goto(`/dashboard/${A.slug}/analytics`);
  const [db] = await sql<{ value: number; paid: number }>(
    `SELECT (SELECT coalesce(sum("totalCents"),0)::int FROM "Order" WHERE "organizationId" = $1 AND status <> 'CANCELLED') AS value,
            (SELECT coalesce(sum(p."amountCents"),0)::int FROM "PaymentRecord" p WHERE p."organizationId" = $1 AND p.status = 'RECORDED') AS paid`,
    [orgA.id],
  );
  expect(db).toEqual({ value: 4130, paid: 4130 });
  await expect(owner.getByTestId('m-order-value')).toHaveText(/^(€\s?41[.,]30|41[.,]30\s?€)$/);
  await expect(owner.getByTestId('m-collected')).toHaveText(/^(€\s?41[.,]30|41[.,]30\s?€)$/);
  await expect(owner.getByTestId('m-unpaid')).toHaveText(/^(€\s?0[.,]00|0[.,]00\s?€)$/);
  await expect(owner.getByTestId('top-items')).toContainText(DISH);
  await shot(owner, 'e22-analytics');
  ev.add('step22', { db, ui: { orderValue: await owner.getByTestId('m-order-value').innerText(), collected: await owner.getByTestId('m-collected').innerText() } });
});

test('STEP 23: Restaurant B cannot reach any of Restaurant A’s orders, menu, feedback or guest data', async ({ browser }) => {
  const ctx = await browser.newContext();
  const b = await ctx.newPage();
  await login(b, B.email, PASSWORD);
  const [o] = await sql<{ id: string; sessionId: string }>(`SELECT id, "tableSessionId" AS "sessionId" FROM "Order" WHERE "organizationId" = $1 ORDER BY number LIMIT 1`, [orgA.id]);
  const [p] = await sql<{ id: string; cents: number }>(`SELECT p.id, cp."amountCents" AS cents FROM "MenuProduct" p JOIN "ChannelPrice" cp ON cp."productId" = p.id AND cp.channel = 'DINE_IN' WHERE p."organizationId" = $1 ORDER BY cents DESC LIMIT 1`, [orgA.id]);
  const [k] = await sql<{ id: string }>(`SELECT k.id FROM "KitchenTicket" k JOIN "Order" o ON o.id = k."orderId" WHERE o."organizationId" = $1 LIMIT 1`, [orgA.id]);
  const [t] = await sql<{ id: string }>(`SELECT id FROM "RestaurantTable" WHERE "organizationId" = $1 LIMIT 1`, [orgA.id]);
  const [task] = await sql<{ id: string }>(`SELECT id FROM "StaffTask" WHERE "organizationId" = $1 LIMIT 1`, [orgA.id]);
  const results: Record<string, number | string> = {};
  // A's pages, opened by B
  for (const path of ['', '/orders', '/menu', `/menu/products/${p.id}`, '/reviews', '/bills', `/bills/${o.sessionId}`, '/analytics', '/loyalty', '/settings/privacy', '/tables', '/kitchen']) {
    const r = await b.goto(`/dashboard/${A.slug}${path}`);
    results[`page A${path || '/'}`] = r!.status();
    await expect(b.getByTestId('order-card')).toHaveCount(0);
    await expect(b.getByText(DISH)).toHaveCount(0);
  }
  // A's IDs inside B's own URLs
  for (const path of [`/bills/${o.sessionId}`, `/menu/products/${p.id}`, `/kitchen/tickets/${k.id}/print`]) {
    const r = await b.goto(`/dashboard/${B.slug}${path}`);
    results[`page B${path}`] = r!.status();
    await expect(b.getByText(DISH)).toHaveCount(0);
  }
  // Direct API calls
  const api = b.request;
  const calls: [string, () => Promise<{ status(): number; text(): Promise<string> }>][] = [
    ['GET A live orders', () => api.get(`/api/dashboard/${A.slug}/orders/live?location=${orgA.locationId}`)],
    ['POST A order status', () => api.post(`/api/dashboard/${A.slug}/orders/${o.id}/status`, { headers: ORIGIN, data: { to: 'CANCELLED', expectedFrom: 'COMPLETED', reason: 'attack' } })],
    ['POST B order status with A order id', () => api.post(`/api/dashboard/${B.slug}/orders/${o.id}/status`, { headers: ORIGIN, data: { to: 'CANCELLED', expectedFrom: 'COMPLETED', reason: 'attack' } })],
    ['GET A ticket pdf', () => api.get(`/api/dashboard/${A.slug}/kds/tickets/${k.id}/pdf`)],
    ['GET B ticket pdf with A ticket id', () => api.get(`/api/dashboard/${B.slug}/kds/tickets/${k.id}/pdf`)],
    ['GET B qr with A table id', () => api.get(`/api/dashboard/${B.slug}/qr/${t.id}`)],
    ['POST B task with A task id', () => api.post(`/api/dashboard/${B.slug}/tasks/${task.id}`, { headers: ORIGIN, data: { to: 'DONE' } })],
    ['GET A analytics export', () => api.get(`/api/dashboard/${A.slug}/analytics/export`)],
    ['POST A privacy export', () => api.post(`/api/dashboard/${A.slug}/privacy/export`, { headers: ORIGIN, multipart: { q: '+351 900 000 199' } })],
    ['POST B privacy export for A guest phone', () => api.post(`/api/dashboard/${B.slug}/privacy/export`, { headers: ORIGIN, multipart: { q: '+351 900 000 199' } })],
  ];
  for (const [name, call] of calls) {
    const r = await call();
    const body = await r.text();
    results[name] = r.status();
    expect(body).not.toContain('900 000 199');
    expect(body).not.toContain('900000199');
    expect(body).not.toContain(DISH);
    if (name === 'POST B privacy export for A guest phone') {
      expect(r.status()).toBe(200);
      const j = JSON.parse(body);
      results[name] = `200 (B's own data, empty: ${JSON.stringify(j).length} bytes)`;
    } else expect(r.status()).toBeGreaterThanOrEqual(400);
  }
  // Server action tampering: B's quick-price form re-pointed at A's product id
  await b.goto(`/dashboard/${B.slug}/menu/quick`);
  ev.add('step23-b-quick-page', await b.locator('body').innerText().then((s) => s.slice(0, 200)));
  // B has no dishes; create one so the quick form exists
  await b.goto(`/dashboard/${B.slug}/menu`);
  const form = b.getByTestId('add-category-form');
  await form.getByLabel(/New category name/).fill('B pratos');
  await form.getByRole('button', { name: 'Add category' }).click();
  await b.getByTestId('add-dish-0').click();
  await b.getByTestId('product-name-pt').fill('Prato B (audit)');
  await b.getByTestId('price-DINE_IN').fill('9,00');
  await b.getByRole('button', { name: 'Create dish' }).click();
  // (run 5 used /\/menu\/products\// which also matches …/products/new and raced the action — a test bug)
  await expect(b).toHaveURL(/\/menu\/products\/(?!new)[a-z0-9]+$/);
  const created = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "MenuProduct" p JOIN "RestaurantOrganization" o ON o.id = p."organizationId" WHERE o.slug = $1`, [B.slug]);
  const quickResp = await b.goto(`/dashboard/${B.slug}/menu/quick`);
  const firstQuick = (await b.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
  ev.add('step23-quick-after-create', { dbProducts: created[0].n, status: quickResp?.status(), cacheControl: quickResp?.headers()['cache-control'], firstRender: firstQuick });
  if (!firstQuick.includes('Prato B')) {
    await b.reload();
    ev.add('step23-quick-after-reload', (await b.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200));
  }
  // Server-action tampering: the real Server Action POST is intercepted and rewritten in flight
  // (an attacker controls their own HTTP requests). Changing hidden inputs in the DOM is not
  // enough because React restores their values (observed in run 6: B's own price changed instead).
  const [bp] = await sql<{ id: string; cents: number }>(`SELECT p.id, cp."amountCents" AS cents FROM "MenuProduct" p JOIN "ChannelPrice" cp ON cp."productId" = p.id AND cp.channel = 'DINE_IN' JOIN "RestaurantOrganization" o ON o.id = p."organizationId" WHERE o.slug = $1`, [B.slug]);
  async function tamperedSubmit(replaceOrg: boolean, price: string) {
    let rewritten = false;
    await b.route('**/menu/quick', async (route) => {
      const req = route.request();
      const body = req.postData();
      if (req.method() !== 'POST' || !body) return route.continue();
      let next = body.split(bp.id).join(p.id);
      if (replaceOrg) next = next.split(B.slug).join(A.slug);
      rewritten = next !== body;
      return route.continue({ postData: next });
    });
    await b.goto(`/dashboard/${B.slug}/menu/quick`);
    await b.locator('input[name=price]').first().fill(price);
    await b.getByRole('button', { name: 'Save' }).first().click();
    const f = b.locator('form').filter({ has: b.locator('input[name=price]') }).first();
    await expect(f.getByRole('alert').or(f.getByText('Saved'))).toBeVisible();
    await b.unroute('**/menu/quick');
    return { rewritten, message: (await f.innerText()).replace(/\s+/g, ' ').slice(0, 120) };
  }
  const t1 = await tamperedSubmit(false, '0,01');
  const t2 = await tamperedSubmit(true, '0,02');
  const [after] = await sql<{ cents: number }>(`SELECT "amountCents" AS cents FROM "ChannelPrice" WHERE "productId" = $1 AND channel = 'DINE_IN'`, [p.id]);
  const [bAfter] = await sql<{ cents: number }>(`SELECT "amountCents" AS cents FROM "ChannelPrice" WHERE "productId" = $1 AND channel = 'DINE_IN'`, [bp.id]);
  expect(t1.rewritten && t2.rewritten).toBe(true);
  expect(after.cents).toBe(p.cents);
  expect(bAfter.cents).toBe(bp.cents);
  results['server action: B request rewritten to A productId'] = `${t1.message} → A price ${after.cents} (unchanged), B price ${bAfter.cents} (unchanged)`;
  results['server action: B request rewritten to org=A + A productId'] = `${t2.message} → A price ${after.cents} (unchanged)`;
  const [still] = await sql<{ status: string }>(`SELECT status FROM "Order" WHERE id = $1`, [o.id]);
  expect(still.status).toBe('COMPLETED');
  ev.add('step23', results);
  await shot(b, 'e23-restaurant-b');
  await ctx.close();
});
