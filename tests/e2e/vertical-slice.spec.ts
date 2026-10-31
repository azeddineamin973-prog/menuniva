import { expect, test, type Page } from '@playwright/test';

/**
 * Vertical slice in a real browser against a real PostgreSQL test database:
 * owner registers → builds menu → stations → tables/QR → publishes →
 * guest scans QR, switches languages (Arabic RTL), orders food + tea →
 * staff accepts → kitchen & café prepare → order ready → completed → guest sees real status.
 *
 * All data is fictitious ("E2E Test Restaurant") and lives only in menuniva_test.
 */

const owner = { name: 'E2E Owner', email: `owner.${Date.now()}@test.menuniva.local`, password: 'e2e-password-123' };

async function addCategory(page: Page, name: string, station: string) {
  const form = page.getByTestId('add-category-form');
  await form.getByLabel(/New category name/).fill(name);
  await form.getByLabel('Default station').selectOption({ label: station });
  await form.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByTestId('menu-category').filter({ hasText: name })).toBeVisible();
}

async function addDish(page: Page, base: string, categoryIndex: number, name: string, price: string) {
  await page.goto(`${base}/menu`);
  await page.getByTestId(`add-dish-${categoryIndex}`).click();
  await page.getByTestId('product-name-pt').fill(name);
  await page.getByTestId('price-DINE_IN').fill(price);
  await page.getByTestId('product-status').selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Create dish' }).click();
  await expect(page).toHaveURL(/\/menu\/products\/[a-z0-9]+$/);
}

test('restaurant setup → QR table order → kitchen & café → completed', async ({ page, browser }) => {
  // 1. Owner signs up and registers the restaurant
  await page.goto('/signup');
  // The interface is English unless the visitor picks another language.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('Full name').fill(owner.name);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding\/new/);
  await page.getByLabel('Restaurant name').fill('E2E Test Restaurant');
  await page.getByLabel('City').fill('Braga');
  await page.getByRole('button', { name: 'Create restaurant' }).click();
  await expect(page).toHaveURL(/\/dashboard\/e2e-test-restaurant\/setup/);
  const base = '/dashboard/e2e-test-restaurant';

  // 2. Restaurant details
  await page.goto(`${base}/settings`);
  const loc = page.getByTestId('location-settings-form');
  await loc.getByLabel('Street address').fill('Rua de Teste, 1');
  await loc.getByLabel('Postal code').fill('4700123');
  await loc.getByLabel('City').fill('Braga');
  await loc.getByLabel('Telephone').fill('+351 900 000 000');
  await loc.getByRole('button', { name: 'Save' }).click();
  await expect(loc.getByText('Saved')).toBeVisible();

  // 3. Stations
  await page.goto(`${base}/stations`);
  for (const [name, type] of [['Test Cozinha', 'Kitchen'], ['Test Café', 'Café']] as const) {
    const f = page.getByTestId('add-station-form');
    await f.getByLabel('Name').fill(name);
    await f.getByLabel('Type').selectOption({ label: type });
    await f.getByRole('button', { name: 'Add station' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // 4. Menu: categories routed to stations, two dishes
  await page.goto(`${base}/menu`);
  await addCategory(page, 'Pratos de teste', 'Test Cozinha');
  await addCategory(page, 'Bebidas de teste', 'Test Café');
  await addDish(page, base, 0, 'Prato de teste', '16,90');
  await addDish(page, base, 1, 'Chá de teste', '2,50');
  await page.goto(`${base}/menu`);
  await expect(page.getByTestId('menu-product')).toHaveCount(2);
  await expect(page.getByText('16,90 €')).toBeVisible();

  // 5. Channels: table ordering on
  await page.goto(`${base}/settings/channels`);
  await page.getByLabel('Order at table (QR codes)').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // 6. Tables + QR codes
  await page.goto(`${base}/tables`);
  await page.getByTestId('create-tables-form').getByLabel('Table labels').fill('1-3');
  await page.getByTestId('create-tables-form').getByRole('button', { name: 'Create tables' }).click();
  await expect(page.getByTestId('table-card')).toHaveCount(3);
  const qrImg = page.getByTestId('table-card').first().locator('img');
  await expect(qrImg).toHaveJSProperty('complete', true);
  const tableHref = await page.getByTestId('open-table-link').first().getAttribute('href');
  expect(tableHref).toMatch(/^\/t\/[A-Za-z0-9_-]{22}$/);

  // 7. Publish
  await page.goto(`${base}/setup/publish`);
  await page.getByTestId('publish-form').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  // 8. Guest scans the QR code (separate browser context: no staff session)
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(tableHref!);
  await expect(guest.getByTestId('table-banner')).toContainText('Mesa 01');
  await expect(guest.getByTestId('customer-product')).toHaveCount(2);

  // TEST 3: five languages incl. Arabic RTL
  for (const [lang, label] of [['en', 'Table 01'], ['fr', 'Table 01'], ['es', 'Mesa 01'], ['ar', 'طاولة 01'], ['pt', 'Mesa 01']] as const) {
    await guest.getByTestId('language-switcher').selectOption(lang);
    await expect(guest.getByTestId('table-banner')).toContainText(label);
    await expect(guest.getByTestId('storefront')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  }

  await guest.getByTestId('customer-product').filter({ hasText: 'Prato de teste' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('customer-product').filter({ hasText: 'Chá de teste' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('view-cart').click();
  await expect(guest.getByTestId('cart-total')).toHaveText('19,40 €'); // from the server quote
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\/[A-Za-z0-9_-]{32}$/);
  await expect(guest.getByTestId('order-status')).toHaveAttribute('data-status', 'NEW');

  // 9. Staff receives the order and accepts it
  await page.goto(`${base}/orders`);
  const card = page.getByTestId('column-new').getByTestId('order-card');
  await expect(card).toHaveCount(1);
  // Staff screens follow the owner's own language, English by default; guests above see the
  // restaurant's language. Menu content (dish names) is never translated automatically.
  await expect(card).toContainText('Table 01');
  await expect(card).toContainText('Prato de teste');
  await expect(card).toContainText('19.40');
  await expect(page.getByTestId('unread-count')).toBeVisible();
  await card.getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card')).toHaveCount(1);

  // 10. Kitchen sees only the food; café sees only the tea
  await page.goto(`${base}/kitchen`);
  await page.getByTestId('station-link').filter({ hasText: 'Test Cozinha' }).click();
  const kTicket = page.getByTestId('kds-ticket');
  await expect(kTicket).toHaveCount(1);
  await expect(kTicket).toContainText('Prato de teste');
  await expect(kTicket).not.toContainText('Chá de teste');
  await kTicket.getByTestId('kds-ready').click();
  await expect(page.getByTestId('kds-READY').getByTestId('kds-ticket')).toHaveCount(1);

  await page.goto(`${base}/kitchen`);
  await page.getByTestId('station-link').filter({ hasText: 'Test Café' }).click();
  const cTicket = page.getByTestId('kds-ticket');
  await expect(cTicket).toContainText('Chá de teste');
  await expect(cTicket).not.toContainText('Prato de teste');
  await cTicket.getByTestId('kds-start').click();
  await expect(page.getByTestId('kds-PREPARING').getByTestId('kds-ticket')).toHaveCount(1);
  // Guest sees PREPARING while the café works
  await guest.reload();
  await expect(guest.getByTestId('order-status')).toHaveAttribute('data-status', 'PREPARING');
  await page.getByTestId('kds-PREPARING').getByTestId('kds-ready').click();
  await expect(page.getByTestId('kds-READY').getByTestId('kds-ticket')).toHaveCount(1);

  // 11. Order is READY only now; staff completes it
  await page.goto(`${base}/orders`);
  const ready = page.getByTestId('column-ready').getByTestId('order-card');
  await expect(ready).toHaveCount(1);
  await ready.getByTestId('action-COMPLETED').click();
  await expect(page.getByTestId('column-done').getByTestId('order-card')).toHaveCount(1);

  // 12. Guest sees the real final status (polling)
  await expect(guest.getByTestId('order-status')).toHaveAttribute('data-status', 'COMPLETED', { timeout: 20_000 });
  await guestContext.close();
});
