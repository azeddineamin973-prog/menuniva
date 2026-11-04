import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { login, PNG_1x1, seed, sql, type Seed } from './helpers';

/**
 * Pickup and the restaurant's own delivery, end to end, on a fictional Moroccan restaurant in the
 * TEST database: storefront choice → menu → options → cart → checkout → confirmation → Live Orders
 * → Kitchen/Café stations → driver → completion. Also: client-side validation, cart kept and
 * re-priced when switching method, delivery zone and fee, lost answers and double taps.
 */
let s: Seed;
let x: { tajineId: string; couscousId: string; teaId: string; kitchenId: string; cafeId: string };
const shots = process.env.E2E_SHOTS === '1';
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  await page.waitForTimeout(400); // let the sheet's slide-up animation finish
  await page.screenshot({ path: `test-results/premium/${name}.png`, fullPage: false });
};

test.beforeAll(async () => {
  s = seed(`po${Date.now()}`);
  const out = execFileSync('npx', ['tsx', '--conditions=react-server', 'tests/e2e/seed-ordering.ts', s.orgId, s.locationId], { env: { ...process.env, APP_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL }, encoding: 'utf8' });
  x = JSON.parse(out.trim().split('\n').reverse().find((l) => l.startsWith('{'))!);
});

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const orderRequests = (page: Page, path: string) => {
  const sent: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith(path) && sent.push(r.url()));
  return sent;
};

test('pickup on a phone: choose pickup, quick add, sizes and extras, checkout validation, one order on a double tap, confirmation', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const g = await ctx.newPage();
  await g.goto(`/r/${s.orgSlug}`);
  const choice = g.getByTestId('order-choice');
  await expect(choice.getByRole('link')).toHaveCount(2);
  await expect(choice.getByRole('link', { name: /Recolha no restaurante/ })).toContainText('Pronto em cerca de 20 min');
  await expect(choice.getByRole('link', { name: /A nossa entrega/ })).toContainText('Taxa de entrega desde 3,00 €');
  await shot(g, '01-storefront');
  await choice.getByRole('link', { name: /Recolha no restaurante/ }).click();
  await expect(g).toHaveURL(/\/order\/pickup/);
  await expect(g.getByTestId('mode-switch').locator('[aria-current=page]')).toHaveText('Recolha');
  await expect(g.getByTestId('order-mode')).toContainText('Balcão de receção');
  await expect(g.getByTestId('order-mode')).toContainText('Pedido mínimo: 5,00 €');

  // A dish without choices goes straight in.
  await g.getByTestId('customer-product').filter({ hasText: 'Cuscuz real' }).locator('..').getByTestId('quick-add').click();
  await expect(g.getByTestId('cart-toast')).toContainText('1 × Cuscuz real');
  await expect(g.getByTestId('bar-checkout')).toContainText('16,90');
  await expect(g.getByTestId('journey-steps').locator('[aria-current=step]')).toContainText('Escolher');
  // On the tile the add button becomes − n +.
  const cuscuz = g.getByTestId('customer-product').filter({ hasText: 'Cuscuz real' }).locator('..');
  await expect(cuscuz.getByTestId('tile-qty')).toHaveText('1');
  await cuscuz.getByTestId('quick-add').click();
  await expect(cuscuz.getByTestId('tile-qty')).toHaveText('2');
  await expect(g.getByTestId('bar-checkout')).toContainText('33,80');
  await cuscuz.getByTestId('tile-dec').click();
  await expect(cuscuz.getByTestId('tile-qty')).toHaveText('1');
  await expect(g.getByTestId('bar-checkout')).toContainText('16,90');
  await shot(g, '02-pickup-menu');

  // A dish with a size and extras: the price follows every choice.
  await g.getByTestId('customer-product').filter({ hasText: 'Tajine de frango' }).click();
  await g.getByRole('radio', { name: /Para dois/ }).check();
  await g.getByRole('checkbox', { name: /Batatas fritas/ }).check();
  await g.getByRole('button', { name: '+', exact: true }).click();
  await expect(g.getByTestId('add-to-cart')).toContainText('59,80'); // (14,90 + 12,00 + 3,00) × 2
  await shot(g, '03-product-sheet');
  await g.getByTestId('add-to-cart').click();
  await expect(g.getByTestId('bar-checkout')).toContainText('76,70');

  await g.getByTestId('view-cart').click();
  await expect(g.getByTestId('cart-line')).toHaveCount(2);
  await expect(g.getByTestId('cart-total')).toHaveText('76,70 €');
  await shot(g, '04-cart');
  await g.getByTestId('cart-close').click();
  // Straight to checkout from the bar.
  await g.getByTestId('bar-checkout').click();
  await expect(g).toHaveURL(/\/order\/pickup\/checkout/);
  await expect(g.getByTestId('checkout-step')).toBeVisible();
  await expect(g.getByTestId('journey-steps').locator('[aria-current=step]')).toContainText('Dados');

  // Missing details are pointed out on the spot; nothing is sent.
  const sent = orderRequests(g, '/api/public/orders/pickup');
  await g.getByTestId('submit-order').click();
  await expect(g.getByTestId('field-error')).toHaveCount(2);
  await expect(g.getByTestId('submit-error')).toHaveText('Verifique os campos assinalados.');
  await expect(g.getByLabel('O seu nome')).toBeFocused();
  expect(sent).toHaveLength(0);

  await g.getByLabel('O seu nome').fill('Teste Recolha');
  await g.getByLabel('Telefone').fill('+351 912 345 678');
  await expect(g.getByTestId('field-error')).toHaveCount(0);
  await expect(g.getByTestId('submit-error')).toHaveCount(0);
  await expect(g.getByTestId('pickup-select')).toHaveValue('asap');
  await expect(g.getByTestId('checkout-pickup-point')).toContainText('Balcão de receção');
  await expect(g.getByTestId('payment-note')).toContainText('Paga ao balcão');
  await expect(g.getByTestId('submit-order')).toContainText('Confirmar pedido');
  await expect(g.getByTestId('submit-order')).toContainText('76,70 €');
  await shot(g, '05-checkout-pickup');

  // Pick a later slot, then tap twice quickly: one request, one order.
  const slots = await g.getByTestId('pickup-select').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  await g.getByTestId('pickup-select').selectOption(slots[2]);
  await g.getByTestId('submit-order').dblclick();
  await expect(g).toHaveURL(/\/o\//);
  expect(sent).toHaveLength(1);
  const rows = await sql<{ n: string; total: number; pickupAt: Date; pay: string }>(`SELECT count(*)::text n, max("totalCents") total, max("pickupAt") "pickupAt", max("paymentMethodIntent"::text) pay FROM "Order" WHERE "customerName" = 'Teste Recolha'`);
  expect(rows[0]).toMatchObject({ n: '1', total: 7670, pay: 'PAY_AT_COUNTER' });
  expect(new Date(rows[0].pickupAt).toISOString()).toBe(slots[2]);

  await expect(g.getByTestId('order-confirmation')).toContainText('Pedido confirmado!');
  await expect(g.getByTestId('order-number')).toHaveText(/^#\d+$/);
  await expect(g.getByTestId('confirmation-mode')).toContainText(/Recolha (Hoje|Amanhã)/);
  await expect(g.getByTestId('pickup-point')).toContainText('Balcão de receção');
  await expect(g.getByTestId('call-restaurant')).toHaveAttribute('href', 'tel:+351900000001');
  await expect(g.getByTestId('confirmation-total')).toHaveText('76,70 €');
  await expect(g.getByTestId('order-status')).toHaveAttribute('data-status', 'NEW');
  await shot(g, '06-confirmation-pickup');
  await ctx.close();
});

test('delivery: cart kept and re-priced from pickup, zone and fee checks, lost answer retried safely, one order', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const g = await ctx.newPage();
  await g.goto(`/r/${s.orgSlug}/order/pickup`);
  const quick = (name: string) => g.getByTestId('customer-product').filter({ hasText: name }).locator('..').getByTestId('quick-add').click();
  await quick('Cuscuz real');
  await quick('Chá de menta');
  await expect(g.getByTestId('bar-checkout')).toContainText('19,40'); // pickup prices 16,90 + 2,50

  // Switch to delivery: same items, delivery prices.
  await g.getByTestId('mode-switch').getByRole('link', { name: 'Entrega' }).click();
  await expect(g).toHaveURL(/\/order\/delivery/);
  await expect(g.getByTestId('cart-toast')).toContainText('Os seus artigos foram mantidos');
  await expect(g.getByTestId('bar-checkout')).toContainText('20,70'); // 17,90 + 2,80
  await g.getByTestId('view-cart').click();
  await expect(g.getByTestId('delivery-fee')).toHaveText('Taxa de entrega indicada ao finalizar');
  await g.getByTestId('go-checkout').click();

  await g.getByLabel('Nome do destinatário').fill('Teste Entrega');
  await g.getByLabel('Telefone').fill('+351 913 000 111');
  await g.getByLabel('Rua e número').fill('Avenida da Liberdade, 45');
  await g.getByLabel('Localidade').fill('Braga');
  await expect(g.getByTestId('enter-postal')).toBeVisible();
  await g.getByTestId('postal-input').fill('4900-001');
  await expect(g.getByTestId('outside-zone')).toContainText('não entregamos');
  await expect(g.getByTestId('outside-zone').getByRole('link')).toHaveAttribute('href', /\/order\/pickup/);
  await expect(g.getByTestId('submit-order')).toBeDisabled();
  await g.getByTestId('postal-input').fill('4700123');
  await expect(g.getByTestId('delivery-zone')).toContainText('3,00 €');
  await expect(g.getByTestId('delivery-zone')).toContainText('40 min');
  await expect(g.getByTestId('delivery-fee')).toHaveText('3,00 €');
  await expect(g.getByTestId('cart-total')).toHaveText('23,70 €');
  await g.getByRole('radio', { name: /Cartão na entrega/ }).check();
  await expect(g.getByTestId('submit-order')).toContainText('Fazer pedido');
  await expect(g.getByTestId('submit-order')).toContainText('23,70 €');
  await shot(g, '07-checkout-delivery');

  // The order reaches the server but the phone never gets the answer (three attempts).
  await g.route('**/api/public/orders/delivery', async (r) => {
    await r.fetch();
    await r.abort('connectionreset');
  });
  await g.getByTestId('submit-order').click();
  await expect(g.getByTestId('submit-error')).toContainText('Não conseguimos confirmar o envio', { timeout: 20_000 });
  await g.unroute('**/api/public/orders/delivery');
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  const [o] = await sql<{ n: string; total: number; fee: number; pay: string; postal: string }>(
    `SELECT count(*)::text n, max(o."totalCents") total, max(o."deliveryFeeCents") fee, max(o."paymentMethodIntent"::text) pay, max(d."postalCode") postal FROM "Order" o JOIN "DeliveryOrderDetails" d ON d."orderId" = o.id WHERE o."customerName" = 'Teste Entrega'`,
  );
  expect(o).toEqual({ n: '1', total: 2370, fee: 300, pay: 'CARD_TERMINAL', postal: '4700-123' });
  await expect(g.getByTestId('confirmation-mode')).toContainText('Entrega pela nossa equipa');
  await expect(g.getByTestId('order-confirmation')).toContainText('Pedido confirmado!');
  await shot(g, '08-confirmation-delivery');
  await ctx.close();
});

test('delivery minimum: below the zone minimum the guest is told how much is missing and cannot place it', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const g = await ctx.newPage();
  await g.goto(`/r/${s.orgSlug}/order/delivery`);
  await g.getByTestId('customer-product').filter({ hasText: 'Chá de menta' }).locator('..').getByTestId('quick-add').click();
  await g.getByTestId('view-cart').click();
  await g.getByTestId('go-checkout').click();
  await g.getByTestId('postal-input').fill('4700-200');
  await expect(g.getByTestId('submit-blocker')).toContainText('Faltam 7,20 €'); // 10,00 − 2,80
  await expect(g.getByTestId('submit-order')).toBeDisabled();
  await ctx.close();
});

test('Live Orders: both orders arrive, pickup and delivery are told apart and filtered; accept routes to Kitchen and Café; driver assigned; reject with a quick reason', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  const newCol = page.getByTestId('column-new');
  const pickupCard = newCol.getByTestId('order-card').filter({ hasText: 'Teste Recolha' });
  const deliveryCard = newCol.getByTestId('order-card').filter({ hasText: 'Teste Entrega' });
  await expect(pickupCard).toHaveAttribute('data-channel', 'TAKEAWAY');
  await expect(pickupCard.getByTestId('channel-tag')).toHaveText('Takeaway');
  await expect(pickupCard.getByTestId('pickup-time')).toContainText('Pickup');
  await expect(pickupCard).toContainText('Pays at the counter');
  await expect(deliveryCard.getByTestId('channel-tag')).toHaveText('Delivery');
  await expect(deliveryCard.getByTestId('delivery-address')).toContainText('Avenida da Liberdade, 45');
  await expect(deliveryCard).toContainText('Card at the door');
  await expect(page.getByTestId('sidebar').getByTestId('nav-badge-liveOrders')).toBeVisible();
  await shot(page, '09-live-orders');

  await page.getByTestId('channel-filter-DELIVERY').click();
  await expect(newCol.getByTestId('order-card')).toHaveCount(1);
  await expect(newCol.getByTestId('order-card')).toContainText('Teste Entrega');
  await page.getByTestId('channel-filter-all').click();

  // Nobody assigns a driver: the restaurant's only driver received it when it was placed.
  await expect(deliveryCard.getByTestId('live-driver')).toContainText('E2E driver');
  await expect(deliveryCard.getByTestId('live-driver-select')).toHaveCount(0);
  expect((await sql<{ d: string | null }>(`SELECT d."driverMembershipId" d FROM "DeliveryOrderDetails" d JOIN "Order" o ON o.id = d."orderId" WHERE o."customerName" = 'Teste Entrega'`))[0].d).not.toBeNull();

  await pickupCard.getByTestId('action-ACCEPTED').click();
  await deliveryCard.getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card')).toHaveCount(2);
  const stations = async (name: string) =>
    (await sql<{ station: string }>(`SELECT k.name station FROM "KitchenTicket" t JOIN "KitchenStation" k ON k.id = t."stationId" JOIN "Order" o ON o.id = t."orderId" WHERE o."customerName" = $1 ORDER BY k.name`, [name])).map((r) => r.station);
  expect(await stations('Teste Recolha')).toEqual(['Seed Kitchen']);
  expect(await stations('Teste Entrega')).toEqual(['Seed Café', 'Seed Kitchen']);

  // The Café screen shows only the tea; the kitchen screen only the food.
  await page.goto(`/dashboard/${s.orgSlug}/kitchen/${x.cafeId}`);
  const cafeTicket = page.getByTestId('kds-ticket').filter({ hasText: 'Chá de menta' });
  await expect(cafeTicket).toHaveCount(1);
  await expect(cafeTicket).not.toContainText('Cuscuz');
  await cafeTicket.getByTestId('kds-ready').click();
  await page.goto(`/dashboard/${s.orgSlug}/kitchen/${x.kitchenId}`);
  const kitchenTickets = page.getByTestId('kds-ticket');
  await expect(kitchenTickets).toHaveCount(2);
  await expect(kitchenTickets.filter({ hasText: 'Chá de menta' })).toHaveCount(0);
  for (const t of [kitchenTickets.filter({ hasText: 'Tajine de frango' }), kitchenTickets.filter({ hasText: 'Cuscuz real' }).filter({ hasNotText: 'Tajine de frango' })]) {
    await expect(t).toHaveCount(1);
    await t.getByTestId('kds-ready').click();
    await expect(t.getByTestId('kds-ready')).toHaveCount(0);
  }
  await expect.poll(async () => (await sql<{ status: string }>(`SELECT status FROM "Order" WHERE "customerName" IN ('Teste Recolha','Teste Entrega') ORDER BY "customerName"`)).map((r) => r.status)).toEqual(['READY', 'READY']);

  // Pickup: staff hand it over.
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  await page.getByTestId('column-ready').getByTestId('order-card').filter({ hasText: 'Teste Recolha' }).getByTestId('action-COMPLETED').click();
  await expect(page.getByTestId('column-done').getByTestId('order-card').filter({ hasText: 'Teste Recolha' })).toHaveAttribute('data-status', 'COMPLETED');
  // Delivery: staff hand it to the driver, who confirms on their phone; no button to repeat here.
  const readyDelivery = page.getByTestId('column-ready').getByTestId('order-card').filter({ hasText: 'Teste Entrega' });
  await expect(readyDelivery.getByTestId('waiting-driver')).toBeVisible();
  await expect(readyDelivery.getByTestId('action-OUT_FOR_DELIVERY')).toHaveCount(0);
  const staffTry = await page.request.post(`/api/dashboard/${s.orgSlug}/orders/${(await sql<{ id: string }>(`SELECT id FROM "Order" WHERE "customerName" = 'Teste Entrega'`))[0].id}/status`, { headers: { Origin: 'http://localhost:3100' }, data: { to: 'OUT_FOR_DELIVERY', expectedFrom: 'READY' } });
  expect(staffTry.status()).toBe(400);

  // Reject a new order with a quick reason.
  const res = await page.request.post('/api/public/orders/pickup', {
    headers: { Origin: 'http://localhost:3100' },
    data: { orgSlug: s.orgSlug, idempotencyKey: crypto.randomUUID(), language: 'pt', items: [{ productId: x.couscousId, quantity: 1 }], pickup: 'asap', customerName: 'Teste Recusa', phone: '+351 914 000 000' },
  });
  expect(res.status()).toBe(201);
  const reject = page.getByTestId('column-new').getByTestId('order-card').filter({ hasText: 'Teste Recusa' });
  await expect(reject.getByTestId('action-CANCELLED')).toHaveText('Reject', { timeout: 15_000 });
  await reject.getByTestId('action-CANCELLED').click();
  await page.getByTestId('quick-reasons').getByRole('button', { name: 'We are too busy right now. Sorry!' }).click();
  await page.getByTestId('confirm-cancel').click();
  await expect.poll(async () => (await sql<{ status: string; r: string }>(`SELECT status, "cancelReason" r FROM "Order" WHERE "customerName" = 'Teste Recusa'`))[0]).toEqual({ status: 'CANCELLED', r: 'We are too busy right now. Sorry!' });

  // Driver: confirms pickup when handed the order, then delivered (card at the door: no cash to record).
  const dctx = await browser.newContext(phone);
  const driver = await dctx.newPage();
  await login(driver, s.driver, s.password);
  await driver.goto(`/dashboard/${s.orgSlug}/driver`);
  const card = driver.getByTestId('driver-order');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Avenida da Liberdade, 45');
  await card.getByTestId('driver-out').getByRole('button').click();
  await card.getByTestId('driver-delivered').getByRole('button').click();
  await expect(card).toContainText('Delivered');
  await shot(driver, '10-driver');
  const [done] = await sql<{ status: string }>(`SELECT status FROM "Order" WHERE "customerName" = 'Teste Entrega'`);
  expect(done.status).toBe('DELIVERED');
  await dctx.close();
});

test('desktop: the order sits next to the menu (no bar, no sheet); checkout has the form and the order side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/r/${s.orgSlug}/order/pickup`);
  await expect(page.getByTestId('cart-aside')).toContainText('O seu pedido');
  await page.getByTestId('customer-product').filter({ hasText: 'Cuscuz real' }).locator('..').getByTestId('quick-add').click();
  const aside = page.getByTestId('cart-aside');
  await expect(aside.getByTestId('cart-line')).toHaveCount(1);
  await expect(aside.getByTestId('cart-total')).toHaveText('16,90 €');
  await expect(page.getByTestId('view-cart')).toHaveCount(0);
  // The order column does not cover any dish.
  const a = (await aside.boundingBox())!;
  const dish = (await page.getByTestId('customer-product').first().boundingBox())!;
  expect(dish.x + dish.width).toBeLessThanOrEqual(a.x);
  await aside.getByTestId('go-checkout').click();
  await expect(page).toHaveURL(/\/order\/pickup\/checkout/);
  await expect(page.getByTestId('checkout-step')).toBeVisible();
  const form = (await page.getByTestId('checkout-step').boundingBox())!;
  const summary = (await page.getByTestId('cart-totals').boundingBox())!;
  expect(summary.x).toBeGreaterThan(form.x + form.width - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, '11-desktop-checkout');
  // Changing method from checkout keeps the cart and opens checkout on the other method.
  await expect(page.getByTestId('checkout-mode-switch')).toHaveAttribute('href', /\/order\/delivery\/checkout/);
  await page.getByTestId('checkout-mode-switch').click();
  await expect(page).toHaveURL(/\/order\/delivery\/checkout/);
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await expect(page.getByTestId('cart-line')).toContainText('17,90 €'); // delivery price
  await page.getByTestId('checkout-edit-order').click();
  await expect(page).toHaveURL(/\/order\/delivery$/);
  await expect(page.getByTestId('cart-aside').getByTestId('cart-line')).toHaveCount(1);
});

test('checkout with an empty cart says so and leads back to the menu', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const g = await ctx.newPage();
  await g.goto(`/r/${s.orgSlug}/order/delivery/checkout`);
  await expect(g.getByTestId('checkout-empty')).toBeVisible();
  await g.getByTestId('checkout-empty').getByRole('link').click();
  await expect(g).toHaveURL(/\/order\/delivery$/);
  await ctx.close();
});

test('cover photo set on Branding shows as the store banner on the ordering menu; the footer shows the restaurant’s own details', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form = page.getByTestId('branding-form');
  await expect(form.getByTestId('cover-preview')).toContainText('No cover photo yet');
  await form.locator('#cover').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.concat([PNG_1x1, Buffer.from('store-cover')]) });
  await expect(form.getByTestId('cover-preview').locator('img')).toHaveCount(1); // previewed before saving
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  const cover = (await sql<{ coverUrl: string }>(`SELECT "coverUrl" FROM "RestaurantBranding" WHERE "organizationId" = $1`, [s.orgId]))[0].coverUrl;
  expect(cover).toMatch(/^\/media\/.+\/branding\/.+\.png$/);

  const ctx = await browser.newContext(phone);
  const g = await ctx.newPage();
  await g.goto(`/r/${s.orgSlug}/order/pickup`);
  const hero = g.getByTestId('store-hero');
  await expect(hero.locator(`img[src="${cover}"]`)).toHaveCount(1);
  await expect(hero.getByTestId('hero-open-status')).toBeVisible();
  // Footer: only what the restaurant entered (address, phone, hours, its ordering methods).
  const footer = g.getByTestId('storefront-footer');
  await expect(footer.getByTestId('storefront-contact')).toContainText('Rua de Teste, 13, 4700-001 Braga');
  await expect(footer.getByRole('link', { name: /\+351 900 000 001/ })).toHaveAttribute('href', 'tel:+351900000001');
  await expect(footer.getByTestId('storefront-hours')).toBeVisible();
  await expect(footer.getByTestId('other-modes').getByRole('link', { name: 'Recolha no restaurante' })).toHaveAttribute('href', `/r/${s.orgSlug}/order/pickup`);
  await expect(footer.getByTestId('other-modes').getByRole('link', { name: 'A nossa entrega' })).toHaveAttribute('href', `/r/${s.orgSlug}/order/delivery`);
  await expect(footer).toContainText('Com tecnologia MenuNiva');

  // Removing the cover removes the banner (the menu stays as it was).
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  await form.getByLabel('Remove the current cover photo').check();
  await expect(form.getByTestId('cover-preview')).toContainText('No cover photo yet');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  await g.reload();
  await expect(g.getByTestId('store-hero')).toHaveCount(0);
  await expect(g.getByTestId('customer-product').first()).toBeVisible();
  await ctx.close();
});
