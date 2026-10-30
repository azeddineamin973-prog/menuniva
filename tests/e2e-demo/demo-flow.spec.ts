import { expect, test } from '@playwright/test';
import pg from 'pg';

/**
 * TEST 20: the complete Casa de Marrocos flow in the separate demo environment. The demo tenant
 * has the real layout (areas, downstairs kitchen, café, reception counter) but fictitious dishes:
 * storefront → table QR in 5 languages (Arabic RTL) → order → staff accepts → kitchen and café
 * prepare their own items → completed → payment recorded → guest sees the real status.
 */
const SLUG = 'casa-de-marrocos-demo';
const base = `/dashboard/${SLUG}`;

test('TEST 20: complete Casa de Marrocos demo flow in the DEMO environment', async ({ page, browser }) => {
  const qr = process.env.DEMO_CASA_QR!;
  const password = process.env.DEMO_PASSWORD!;

  // The demo database contains only the fictitious demo restaurant.
  const c = new pg.Client({ connectionString: process.env.DEMO_DATABASE_URL });
  await c.connect();
  const orgs = (await c.query(`SELECT name, "isDemo" FROM "RestaurantOrganization" ORDER BY name`)).rows;
  const areas = (await c.query(`SELECT a.name FROM "DiningArea" a JOIN "RestaurantOrganization" o ON o.id = a."organizationId" WHERE o.slug = $1 ORDER BY a."sortOrder"`, [SLUG])).rows.map((r) => r.name);
  await c.end();
  expect(orgs).toEqual([{ name: 'Casa de Marrocos (DEMO)', isDemo: true }, { name: 'Restaurante Demo', isDemo: true }]);
  expect(areas).toEqual(['Sala principal', 'Zona de assentos marroquinos', 'Terraço interior', 'Tenda marroquina (café)']);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/r/${SLUG}`);
  await expect(guest.getByTestId('demo-environment')).toBeVisible();
  await expect(guest.getByText('pratos e preços fictícios')).toBeVisible();
  await guest.goto(`/t/${qr}`);
  await expect(guest.getByTestId('table-banner')).toContainText('Mesa 01');
  for (const [lang, text] of [['en', 'Moroccan tea (demo)'], ['fr', 'Thé marocain (démo)'], ['es', 'Té marroquí (demo)'], ['ar', 'شاي مغربي (تجريبي)'], ['pt', 'Chá marroquino (demo)']] as const) {
    await guest.getByTestId('language-switcher').selectOption(lang);
    await expect(guest.getByTestId('customer-product').filter({ hasText: text })).toBeVisible();
    await expect(guest.getByTestId('storefront')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  }
  await guest.getByTestId('customer-product').filter({ hasText: 'Tajine de frango (demo)' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('customer-product').filter({ hasText: 'Chá marroquino (demo)' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('view-cart').click();
  await expect(guest.getByTestId('cart-total')).toHaveText('19,00 €'); // 16,00 + 3,00 from the server quote
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);
  await expect(guest.getByTestId('order-status')).toHaveAttribute('data-status', 'NEW');

  await page.goto('/login');
  await page.getByTestId('login-form').locator('input[name=email]').fill('casa.owner@demo.menuniva.invalid');
  await page.getByTestId('login-form').locator('input[name=password]').fill(password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`${base}/orders`);
  await expect(page.getByText(/DEMO restaurant/)).toBeVisible();
  const card = page.getByTestId('column-new').getByTestId('order-card').filter({ hasText: 'Mesa 01' });
  await expect(card).toContainText('19,00');
  await card.getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card').filter({ hasText: 'Mesa 01' })).toHaveCount(1);

  for (const [station, mine, other] of [['Cozinha (piso inferior)', 'Tajine de frango', 'Chá marroquino'], ['Café / Chá', 'Chá marroquino', 'Tajine de frango']] as const) {
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

  // Takeaway guests see where to collect: the reception counter.
  await guest.goto(`/r/${SLUG}/order/pickup`);
  await guest.getByTestId('customer-product').filter({ hasText: 'Chá marroquino (demo)' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('view-cart').click();
  await expect(guest.getByTestId('checkout-pickup-point')).toContainText('Balcão de receção');

  // Analytics in the demo shows the seeded fictitious orders plus this one, unpaid kept apart.
  await page.goto(`${base}/analytics`);
  await expect(page.getByTestId('m-unpaid')).not.toHaveText('0,00 €');
});
