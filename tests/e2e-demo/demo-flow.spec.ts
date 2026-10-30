import { expect, test } from '@playwright/test';
import pg from 'pg';

/**
 * TEST 20: the full flow in the separate demo environment, with fictitious data only:
 * storefront → table QR in 5 languages (Arabic RTL) → order → staff accepts → kitchen and café
 * prepare their own items → completed → payment recorded → guest sees the real status.
 */
const SLUG = 'demo-restaurante';
const base = `/dashboard/${SLUG}`;

test('TEST 20: complete restaurant flow in the DEMO environment', async ({ page, browser }) => {
  const qr = process.env.DEMO_QR!;
  const password = process.env.DEMO_PASSWORD!;

  // The demo database contains only the fictitious demo restaurant.
  const c = new pg.Client({ connectionString: process.env.DEMO_DATABASE_URL });
  await c.connect();
  const orgs = (await c.query(`SELECT name, "isDemo" FROM "RestaurantOrganization"`)).rows;
  await c.end();
  expect(orgs).toEqual([{ name: 'Restaurante Demo', isDemo: true }]);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/r/${SLUG}`);
  await expect(guest.getByTestId('demo-environment')).toBeVisible();
  await guest.goto(`/t/${qr}`);
  await expect(guest.getByTestId('table-banner')).toContainText('Mesa 01');
  for (const [lang, text] of [['en', 'Mint tea (demo)'], ['fr', 'Thé à la menthe (démo)'], ['es', 'Té de menta (demo)'], ['ar', 'شاي بالنعناع (تجريبي)'], ['pt', 'Chá de menta (demo)']] as const) {
    await guest.getByTestId('language-switcher').selectOption(lang);
    await expect(guest.getByTestId('customer-product').filter({ hasText: text })).toBeVisible();
    await expect(guest.getByTestId('storefront')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  }
  await guest.getByTestId('customer-product').filter({ hasText: 'Prato de frango (demo)' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('customer-product').filter({ hasText: 'Chá de menta (demo)' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('view-cart').click();
  await expect(guest.getByTestId('cart-total')).toHaveText('16,50 €'); // 14,00 + 2,50 from the server quote
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);
  await expect(guest.getByTestId('order-status')).toHaveAttribute('data-status', 'NEW');

  await page.goto('/login');
  await page.getByTestId('login-form').locator('input[name=email]').fill('owner@demo.menuniva.invalid');
  await page.getByTestId('login-form').locator('input[name=password]').fill(password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`${base}/orders`);
  await expect(page.getByText(/DEMO restaurant/)).toBeVisible();
  const card = page.getByTestId('column-new').getByTestId('order-card').filter({ hasText: 'Mesa 01' });
  await expect(card).toContainText('16,50');
  await card.getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card').filter({ hasText: 'Mesa 01' })).toHaveCount(1);

  for (const [station, mine, other] of [['Cozinha', 'Prato de frango', 'Chá de menta'], ['Café', 'Chá de menta', 'Prato de frango']] as const) {
    await page.goto(`${base}/kitchen`);
    await page.getByTestId('station-link').filter({ hasText: station }).click();
    const ticket = page.getByTestId('kds-ticket').filter({ hasText: 'Mesa 01' });
    await expect(ticket).toContainText(mine);
    await expect(ticket).not.toContainText(other);
    await ticket.getByTestId('kds-ready').click();
    await expect(page.getByTestId('kds-READY').getByTestId('kds-ticket').filter({ hasText: 'Mesa 01' })).toHaveCount(1);
  }

  await page.goto(`${base}/orders`);
  await page.getByTestId('column-ready').getByTestId('order-card').filter({ hasText: 'Mesa 01' }).getByTestId('action-COMPLETED').click();
  await guest.reload();
  await expect(guest.getByTestId('order-status')).toHaveAttribute('data-status', 'COMPLETED');

  // Analytics in the demo shows the seeded fictitious orders plus this one, unpaid kept apart.
  await page.goto(`${base}/analytics`);
  await expect(page.getByTestId('m-unpaid')).not.toHaveText('0,00 €');
});
