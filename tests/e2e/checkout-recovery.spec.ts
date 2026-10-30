import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

/**
 * Audit BUG-08/09/10 (browser): no false "invalid code" flash, typed details survive closing the
 * cart, and a lost connection gives a clear, safe way to check and retry — never a duplicate.
 */
let s: Seed;
test.beforeAll(async () => {
  s = seed(`cr${Date.now()}`);
  await sql(`UPDATE "RestaurantLocation" SET "takeawayEnabled" = true WHERE id = $1`, [s.locationId]);
});
const orders = async () => Number((await sql<{ n: string }>(`SELECT count(*)::text AS n FROM "Order" WHERE "organizationId" = $1`, [s.orgId]))[0].n);
async function cartWithHarira(p: Page, path: string) {
  await p.goto(path);
  await p.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await p.getByTestId('add-to-cart').click();
  await p.getByTestId('view-cart').click();
}

test('BUG-08: a valid promo code never shows "not valid" while it is being checked', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/promotions`);
  const f = page.getByTestId('promotion-form');
  await f.getByLabel('Name shown to guests').fill('Code 1 €');
  await f.getByLabel('Type').selectOption('FIXED_AMOUNT');
  await f.getByLabel('€ off').fill('1,00');
  await f.getByLabel('Promo code').fill('ONEOFF');
  await f.getByRole('button', { name: 'Create promotion' }).click();
  await expect(page.getByTestId('promotion').filter({ hasText: 'Code 1 €' })).toBeVisible();

  const g = await (await browser.newContext()).newPage();
  // Slow the quote down so the "checking" state is observable
  await g.route('**/api/public/quote', async (r) => {
    await new Promise((res) => setTimeout(res, 700));
    await r.continue();
  });
  await cartWithHarira(g, `/t/${s.qrToken}`);
  let flashed = false;
  await g.exposeFunction('__sawError', () => (flashed = true));
  await g.evaluate(() => new MutationObserver(() => document.querySelector('[data-testid=coupon-error]') && (window as unknown as { __sawError: () => void }).__sawError()).observe(document.body, { childList: true, subtree: true }));
  await g.getByTestId('coupon-input').fill('oneoff');
  await g.getByTestId('coupon-apply').click();
  await expect(g.getByTestId('coupon-checking')).toBeVisible();
  await expect(g.getByTestId('discount-line')).toContainText('Code 1 €');
  await expect(g.getByTestId('cart-total')).toHaveText('5,50 €');
  expect(flashed).toBe(false);
  await g.getByTestId('coupon-input').fill('WRONG');
  await g.getByTestId('coupon-apply').click();
  await expect(g.getByTestId('coupon-error')).toHaveText('Este código não é válido.');
  await g.context().close();
});

test('BUG-09: name and phone survive closing and reopening the cart; cleared after the order', async ({ browser }) => {
  const g = await (await browser.newContext()).newPage();
  await cartWithHarira(g, `/r/${s.orgSlug}/order/pickup`);
  await g.getByLabel('O seu nome').fill('Guest Keeps Data');
  await g.getByLabel('Telefone').fill('+351 911 222 333');
  await g.getByRole('button', { name: 'Fechar' }).click();
  await g.getByTestId('view-cart').click();
  await expect(g.getByLabel('O seu nome')).toHaveValue('Guest Keeps Data');
  await expect(g.getByLabel('Telefone')).toHaveValue('+351 911 222 333');
  await g.reload(); // also after a reload in the same tab
  await g.getByTestId('view-cart').click();
  await expect(g.getByLabel('O seu nome')).toHaveValue('Guest Keeps Data');
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  await cartWithHarira(g, `/r/${s.orgSlug}/order/pickup`);
  await expect(g.getByLabel('O seu nome')).toHaveValue(''); // nothing personal kept after success
  await g.context().close();
});

test('BUG-10: answer lost after the server stored the order → clear message, safe retry after reload, one order', async ({ browser }) => {
  const before = await orders();
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await cartWithHarira(g, `/t/${s.qrToken}`);
  await g.route('**/api/public/orders/table', async (r) => {
    await r.fetch(); // reaches the server: order committed
    await r.abort('connectionreset'); // the phone never gets the answer
  });
  await g.getByTestId('submit-order').click();
  await expect(g.getByTestId('submit-error')).toContainText('Não conseguimos confirmar o envio', { timeout: 20_000 });
  await expect(g.getByTestId('submit-order')).toHaveText('Verificar e tentar de novo');
  expect(await orders()).toBe(before + 1); // stored once, despite 3 attempts
  await g.unroute('**/api/public/orders/table');
  await g.reload();
  await g.getByTestId('view-cart').click();
  await expect(g.getByTestId('submit-pending')).toBeVisible(); // the unconfirmed order is remembered
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  expect(await orders()).toBe(before + 1);
  await ctx.close();
});

test('BUG-10: fully offline → nothing stored, clear message; back online → checked automatically, one order', async ({ browser }) => {
  const before = await orders();
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await cartWithHarira(g, `/t/${s.qrToken}`);
  await ctx.setOffline(true);
  await g.getByTestId('submit-order').click();
  await expect(g.getByTestId('submit-error')).toContainText('Não conseguimos confirmar o envio', { timeout: 20_000 });
  expect(await orders()).toBe(before);
  await ctx.setOffline(false); // the 'online' event triggers one safe check
  await expect(g).toHaveURL(/\/o\//, { timeout: 15_000 });
  expect(await orders()).toBe(before + 1);
  await ctx.close();
});
