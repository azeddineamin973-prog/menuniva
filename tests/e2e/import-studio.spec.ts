import { expect, test } from '@playwright/test';
import { login, seed, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`imp${Date.now()}`);
});

const CSV = 'Categoria;Nome;Descrição;Preço\nEntradas importadas;Harira importada;Sopa de teste;6,50\nPratos importados;Seed tajine;duplicado do menu;15,00\n';

test('TEST 2 (browser): CSV upload → review → save → guest menu; TEST 19: failed sources create nothing', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/import`);

  // Other sources live under "Advanced import options", with an honest status.
  await page.getByTestId('advanced-import').locator('summary').click();
  await expect(page.getByTestId('adapter-GLOVO')).toContainText('Limited');
  await expect(page.getByTestId('adapter-IMAGE')).toContainText('Not connected');
  const form = page.getByTestId('add-source-form');
  await expect(form.getByLabel('CSV file')).toBeChecked();

  // A broken file is reported and creates nothing.
  await form.locator('#file').setInputFiles({ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('foo,bar\n1,2') });
  await form.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('No “name” column');
  // A Glovo address that is not a store page is refused before any request is made.
  await page.getByTestId('glovo-url-input').fill('https://glovoapp.com/embedded-web-views/not-a-store');
  await page.getByTestId('import-menu-button').click();
  await expect(page.getByTestId('glovo-import-error')).toContainText('not a store page');
  await page.reload();
  await expect(page.getByTestId('no-imports')).toBeVisible(); // no empty imports were left behind

  // The real CSV.
  await page.getByTestId('advanced-import').locator('summary').click();
  await form.locator('#file').setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await form.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page).toHaveURL(/\/import\/[a-z0-9]+$/);
  await expect(page.getByTestId('import-item')).toHaveCount(2);
  await expect(page.getByTestId('import-source')).toHaveCount(1);
  const existing = page.getByTestId('import-item').filter({ hasText: 'duplicado do menu' });
  await expect(existing.getByTestId('item-status')).toHaveText('Skip'); // never overwritten silently
  await expect(existing).toContainText('Matches “Seed tajine” on your menu');
  await expect(page.getByTestId('before-after')).toContainText('Translation required');

  const publish = page.getByTestId('publish-import-form');
  await publish.getByLabel('I reviewed the products').check();
  await publish.getByRole('button', { name: 'Save 1 product as drafts' }).click();
  await expect(publish.getByRole('alert')).toContainText('Choose a preparation station'); // GAP-01: no silent "no station"
  await publish.getByLabel('Station for Entradas importadas').selectOption({ label: 'Seed Kitchen' });
  await publish.getByLabel('Show priced dishes to guests now').check();
  await publish.getByLabel('I reviewed the products').check();
  await publish.getByRole('button', { name: 'Import 1 product' }).click();
  await expect(page.getByTestId('publish-summary')).toContainText('1 product created: 0 drafts, 1 visible.');

  const guest = await browser.newPage();
  await guest.goto(`/t/${s.qrToken}`);
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Harira importada' })).toContainText('6,50');
  await expect(guest.getByRole('link', { name: 'Entradas importadas' })).toBeVisible();
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toContainText('15,00'); // original price kept
  await guest.close();
});
