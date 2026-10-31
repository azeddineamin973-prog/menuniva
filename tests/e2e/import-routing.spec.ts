import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

/**
 * Audit GAP-01 (browser): imported food and drinks are assigned to Kitchen and Café during review,
 * published, ordered by a guest and shown on the right preparation screens only.
 */
let s: Seed;
test.beforeAll(() => {
  s = seed(`ir${Date.now()}`);
});

const CSV = 'Categoria;Nome;Preço\nPratos importados;Kefta importada;12,00\nBebidas importadas;Chá importado;2,00\n';

test('GAP-01: import → assign Kitchen/Café → publish → guest order → each station sees only its items', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/stations`);
  const f = page.getByTestId('add-station-form');
  await f.getByLabel('Name').fill('Seed Café');
  await f.getByLabel('Type').selectOption({ label: 'Café' });
  await f.getByRole('button', { name: 'Add station' }).click();
  await expect(page.getByRole('paragraph').filter({ hasText: 'Seed Café' })).toBeVisible();

  await page.goto(`/dashboard/${s.orgSlug}/import`);
  await page.getByTestId('advanced-import').locator('summary').click();
  const form = page.getByTestId('add-source-form');
  await form.locator('#file').setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await form.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('import-item')).toHaveCount(2);
  const publish = page.getByTestId('publish-import-form');
  await publish.getByLabel('Station for Pratos importados').selectOption({ label: 'Seed Kitchen' });
  await publish.getByLabel('Station for Bebidas importadas').selectOption({ label: 'Seed Café' });
  await publish.getByLabel('Show priced dishes to guests now').check();
  await publish.getByLabel('I reviewed the products').check();
  await publish.getByRole('button', { name: 'Import 2 products' }).click();
  await expect(page.getByTestId('publish-summary')).toContainText('2 products created');
  await expect(page.getByTestId('publish-unrouted')).toHaveCount(0);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${s.qrToken}`);
  for (const name of ['Kefta importada', 'Chá importado']) {
    await guest.getByTestId('customer-product').filter({ hasText: name }).click();
    await guest.getByTestId('add-to-cart').click();
  }
  await guest.getByTestId('view-cart').click();
  await expect(guest.getByTestId('cart-total')).toHaveText('14,00 €');
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);

  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  const card = page.getByTestId('column-new').getByTestId('order-card');
  await expect(card).toContainText('Kefta importada');
  await expect(card.getByTestId('item-no-station')).toHaveCount(0);
  await card.getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card')).toHaveCount(1);
  for (const [station, mine, other] of [['Seed Kitchen', 'Kefta importada', 'Chá importado'], ['Seed Café', 'Chá importado', 'Kefta importada']]) {
    await page.goto(`/dashboard/${s.orgSlug}/kitchen`);
    await page.getByTestId('station-link').filter({ hasText: station }).click();
    const t = page.getByTestId('kds-ticket');
    await expect(t).toHaveCount(1);
    await expect(t).toContainText(mine);
    await expect(t).not.toContainText(other);
  }
  const items = await sql<{ name: string; station: string | null }>(`SELECT i."nameSnapshot" AS name, st.name AS station FROM "OrderItem" i LEFT JOIN "KitchenStation" st ON st.id = i."stationId" WHERE i."organizationId" = $1 ORDER BY 1`, [s.orgId]);
  expect(items).toEqual([{ name: 'Chá importado', station: 'Seed Café' }, { name: 'Kefta importada', station: 'Seed Kitchen' }]);
  await guest.context().close();
});

test('GAP-01: dishes without a station are flagged on the menu and fixed with one click', async ({ page }) => {
  // A category without station, as older imports created them
  const [menu] = await sql<{ id: string }>(`SELECT id FROM "Menu" WHERE "organizationId" = $1 LIMIT 1`, [s.orgId]);
  await sql(`INSERT INTO "MenuCategory" (id, "organizationId", "menuId", "updatedAt") VALUES ('legacy' || $1, $1, $2, now())`, [s.orgId, menu.id]);
  await sql(`INSERT INTO "CategoryTranslation" (id, "categoryId", language, name, status, "updatedAt") VALUES ('legacyct' || $1, 'legacy' || $1, 'pt', 'Importação antiga', 'SOURCE', now())`, [s.orgId]);
  await sql(`INSERT INTO "MenuProduct" (id, "organizationId", "menuId", "categoryId", status, "updatedAt") VALUES ('legacyp' || $1, $1, $2, 'legacy' || $1, 'ACTIVE', now())`, [s.orgId, menu.id]);
  await sql(`INSERT INTO "ProductTranslation" (id, "productId", language, name, status, "updatedAt") VALUES ('legacypt' || $1, 'legacyp' || $1, 'pt', 'Prato antigo importado', 'SOURCE', now())`, [s.orgId]);
  await sql(`INSERT INTO "ChannelPrice" (id, "productId", channel, "amountCents", "updatedAt") VALUES ('legacycp' || $1, 'legacyp' || $1, 'DINE_IN', 900, now())`, [s.orgId]);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu`);
  const warn = page.getByTestId('unrouted-warning');
  await expect(warn).toContainText('Prato antigo importado');
  await warn.getByLabel('Station for Importação antiga').selectOption({ label: 'Seed Kitchen' });
  await warn.getByRole('button', { name: 'Set station' }).click();
  await expect(page.getByTestId('unrouted-warning')).toHaveCount(0);
  const [c] = await sql<{ station: string }>(`SELECT s.name AS station FROM "MenuCategory" c JOIN "KitchenStation" s ON s.id = c."defaultStationId" WHERE c.id = 'legacy' || $1`, [s.orgId]);
  expect(c.station).toBe('Seed Kitchen');
});
