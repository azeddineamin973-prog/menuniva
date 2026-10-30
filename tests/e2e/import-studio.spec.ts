import { expect, test } from '@playwright/test';
import { login, seed, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`imp${Date.now()}`);
});

const CSV = 'Categoria;Nome;Descrição;Preço\nEntradas importadas;Harira importada;Sopa de teste;6,50\nPratos importados;Seed tajine;duplicado do menu;15,00\n';

test('TEST 2 (browser): CSV upload → review → publish → guest menu; TEST 19: failed sources publish nothing', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/import`);
  await expect(page.getByTestId('adapter-GLOVO')).toContainText('Not connected');
  await expect(page.getByTestId('adapter-IMAGE')).toContainText('Not connected');
  await page.getByTestId('new-import-form').getByRole('button', { name: 'Start a new import' }).click();
  await expect(page).toHaveURL(/\/import\/[a-z0-9]+$/);

  const form = page.getByTestId('add-source-form');
  // A broken file is reported and creates nothing
  await form.locator('#file').setInputFiles({ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('foo,bar\n1,2') });
  await form.getByRole('button', { name: 'Read this source' }).click();
  await expect(form.getByRole('alert')).toContainText('No “name” column');
  // A Glovo store link is not scraped
  await form.getByLabel('Source').selectOption('GLOVO');
  await form.getByLabel('Store link (for reference)').fill('https://glovoapp.com/pt/en/braga/test-restaurant/');
  await form.getByRole('button', { name: 'Read this source' }).click();
  await expect(form.getByRole('alert')).toContainText('does not copy menus');
  await expect(page.getByTestId('job-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('publish-import-form')).toHaveCount(0);

  // The real CSV
  await form.getByLabel('Source').selectOption('CSV');
  await form.locator('#file').setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await form.getByRole('button', { name: 'Read this source' }).click();
  await expect(page.getByTestId('import-item')).toHaveCount(2);
  await expect(page.getByTestId('import-source')).toHaveCount(3);
  const existing = page.getByTestId('import-item').filter({ hasText: 'duplicado do menu' });
  await expect(existing).toContainText('Similar to an existing dish'); // never overwritten silently
  await expect(page.getByTestId('before-after')).toContainText('Translation required');

  const publish = page.getByTestId('publish-import-form');
  await publish.getByLabel('I reviewed the items above.').check();
  await publish.getByRole('button', { name: /Publish 1 new dishes/ }).click();
  await expect(publish.getByRole('alert')).toContainText('Choose a preparation station'); // GAP-01: no silent "no station"
  await publish.getByLabel('Station for Entradas importadas').selectOption({ label: 'Seed Kitchen' });
  await publish.getByLabel('Make dishes visible to guests now').check();
  await publish.getByLabel('I reviewed the items above.').check();
  await publish.getByRole('button', { name: /Publish 1 new dishes/ }).click();
  await expect(page.getByTestId('publish-summary')).toContainText('1 dishes created (1 visible');

  const guest = await browser.newPage();
  await guest.goto(`/t/${s.qrToken}`);
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Harira importada' })).toContainText('6,50');
  await expect(guest.getByRole('link', { name: 'Entradas importadas' })).toBeVisible();
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toContainText('15,00'); // original price kept
  await guest.close();
});
