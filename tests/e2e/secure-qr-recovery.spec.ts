import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

/**
 * Secure QR ordering on a real phone browser, when things go wrong (final QA): a reload after the PIN,
 * the back button from the confirmation, the answer lost after the order was stored, and a phone that
 * goes offline while sending. The PIN is entered once per phone; every case ends with exactly the
 * orders the guest meant to send. Fictitious restaurant in the TEST database.
 */
const PHONE = { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' };
let s: Seed;
let pin = '';
test.beforeAll(async ({ browser }) => {
  s = seed(`sqrr${Date.now()}`);
  await sql(`UPDATE "RestaurantLocation" SET "tableOrderingPolicy" = 'SESSION_PIN' WHERE id = $1`, [s.locationId]);
  pin = await openTable(browser);
});

async function openTable(browser: Browser) {
  const staff = await browser.newContext();
  const waiter = await staff.newPage();
  await login(waiter, s.waiter, s.password);
  await waiter.goto(`/dashboard/${s.orgSlug}/tables`);
  await waiter.getByTestId('open-table').click();
  await waiter.getByTestId('table-pin-07-show').click();
  const value = (await waiter.getByTestId('table-pin-07-value').innerText()).trim();
  await staff.close();
  return value;
}
async function addHarira(p: Page) {
  await p.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await p.getByTestId('add-to-cart').click();
  await p.getByTestId('view-cart').click();
  await expect(p.getByTestId('cart-total')).toHaveText('6,50 €');
}
const orders = async () => (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "Order" WHERE "organizationId" = $1`, [s.orgId]))[0].n;

test('PIN once, then reload and back button: still authorised, no second PIN, each order sent once', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const g = await ctx.newPage();
  await g.goto(`/t/${s.qrToken}`);
  await expect(g.getByTestId('table-access-banner')).toHaveAttribute('data-state', 'pin');
  const before = await orders();
  await addHarira(g);
  await g.getByTestId('table-pin-input').fill(pin);
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  // Reload the confirmation, then go back to the menu with the browser's back button.
  await g.reload();
  await expect(g.getByTestId('order-number')).toBeVisible();
  await g.goBack();
  await expect(g).toHaveURL(new RegExp(`/t/${s.qrToken}`));
  await g.reload();
  // Authorised for this seating: no PIN banner and no PIN field.
  await expect(g.getByTestId('table-access-banner')).toHaveCount(0);
  await addHarira(g);
  await expect(g.getByTestId('table-pin-box')).toHaveCount(0);
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  expect(await orders()).toBe(before + 2);
  const devices = await sql<{ n: number }>(`SELECT count(DISTINCT "tableSessionDeviceId")::int AS n FROM "Order" WHERE "organizationId" = $1 AND "tableSessionDeviceId" IS NOT NULL`, [s.orgId]);
  expect(devices[0].n).toBe(1);
  await ctx.close();
});

test('answer lost after the order was stored: clear message, safe retry after reload, one order, no new PIN', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const g = await ctx.newPage();
  await g.goto(`/t/${s.qrToken}`);
  await addHarira(g);
  await g.getByTestId('table-pin-input').fill(pin);
  const before = await orders();
  await g.route('**/api/public/orders/table', async (r) => {
    await r.fetch(); // reaches the server: the order is committed
    await r.abort('connectionreset'); // the phone never gets the answer
  });
  await g.getByTestId('submit-order').click();
  await expect(g.getByTestId('submit-error')).toContainText('Não conseguimos confirmar o envio', { timeout: 20_000 });
  expect(await orders()).toBe(before + 1); // stored once, despite 3 attempts
  await g.unroute('**/api/public/orders/table');
  await g.reload();
  await g.getByTestId('view-cart').click();
  await expect(g.getByTestId('submit-pending')).toBeVisible();
  await expect(g.getByTestId('table-pin-box')).toHaveCount(0); // the PIN was accepted before the order was sent
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  expect(await orders()).toBe(before + 1);
  await ctx.close();
});

test('offline while sending: nothing stored; back online → checked once automatically, one order', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const g = await ctx.newPage();
  await g.goto(`/t/${s.qrToken}`);
  await addHarira(g);
  await g.getByTestId('table-pin-input').fill(pin);
  // Enter the PIN online first (the phone is authorised), then lose the connection before the order.
  await g.route('**/api/public/orders/table', (r) => r.abort('internetdisconnected'));
  const before = await orders();
  await g.getByTestId('submit-order').click();
  await expect(g.getByTestId('submit-error')).toContainText('Não conseguimos confirmar o envio', { timeout: 20_000 });
  expect(await orders()).toBe(before);
  await g.unroute('**/api/public/orders/table');
  await ctx.setOffline(true);
  await ctx.setOffline(false); // the 'online' event triggers one safe check with the same key
  await expect(g).toHaveURL(/\/o\//, { timeout: 15_000 });
  expect(await orders()).toBe(before + 1);
  await ctx.close();
});

test('tracking link after staff replace the QR (V5): it never hands out the new QR, and holds no PIN or authorisation', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const g = await ctx.newPage();
  await g.goto(`/t/${s.qrToken}`);
  await addHarira(g);
  await g.getByTestId('table-pin-input').fill(pin);
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  const tracking = g.url();
  // While the seating is open and the QR unchanged, "order more" goes back to this table's menu.
  await expect(g.getByTestId('order-more')).toHaveAttribute('href', `/t/${s.qrToken}`);
  // Staff replace the table's QR (as rotateTableQr does): the old token is switched off, a new one issued.
  const fresh = `newqr${Date.now().toString(36)}`.padEnd(22, 'y');
  const [{ tableId }] = await sql<{ tableId: string }>(`UPDATE "TableQRToken" SET "isActive" = false WHERE token = $1 RETURNING "tableId"`, [s.qrToken]);
  await sql(`INSERT INTO "TableQRToken" (id, "tableId", token) VALUES ($1, $2, $3)`, [`v5${Date.now().toString(36)}`, tableId, fresh]);
  // Someone holding the old tracking link (a forwarded screenshot, a former guest) opens it.
  const other = await browser.newContext(PHONE);
  const o = await other.newPage();
  await o.goto(tracking);
  await expect(o.getByTestId('order-number')).toBeVisible();
  const href = await o.getByTestId('order-more').getAttribute('href');
  expect(href).not.toContain(fresh);
  expect(href).toBe(`/r/${s.orgSlug}`);
  const html = await o.content();
  expect(html).not.toContain(fresh);
  expect(html).not.toContain(pin);
  // The tracking page sets no table authorisation cookie.
  expect((await other.cookies()).find((c) => c.name === 'mn_tg')).toBeUndefined();
  // The old QR no longer orders, even from the phone that was authorised with it.
  const r = await g.request.post('/api/public/orders/table', { headers: { Origin: 'http://localhost:3100' }, data: { qrToken: s.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: s.plainDishId, quantity: 1, modifiers: [] }] } });
  expect(r.status()).toBe(422);
  expect((await r.json()).error).toBe('qr_invalid');
  await Promise.all([ctx.close(), other.close()]);
});
