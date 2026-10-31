import { expect, test, type Page } from '@playwright/test';
import { buildGlovoStorePage } from '../support/glovo-page';
import { login, seed, type Seed } from './helpers';
import { addNetFixture, routeGlovoImages, screenshot, solidPng } from './net-fixtures';

/**
 * Changing dish photos in a real browser: in the import Edit dialog, and on the menu.
 * The Glovo page and photos are local fixtures; the restaurant is fictitious (TEST database).
 */

let s: Seed;
test.beforeAll(() => {
  s = seed(`pho${Date.now()}`);
});

const STORE = 'https://glovoapp.com/pt/pt/braga/stores/e2e-foto-teste-brg';
const GLOVO_PNG = solidPng(96, 96, [206, 150, 58]);
const MY_PNG = solidPng(200, 200, [40, 120, 200]);
const MY_PNG_2 = solidPng(200, 200, [180, 40, 90]);
const loaded = (el: HTMLImageElement) => el.complete && el.naturalWidth > 0;
const row = (page: Page, name: string) => page.getByTestId('import-item').filter({ has: page.getByTestId('item-name').getByText(name, { exact: true }) });

test('import review: change a product photo, restore the Glovo one, save with my photo', async ({ page }) => {
  addNetFixture(STORE, {
    contentType: 'text/html; charset=utf-8',
    body: buildGlovoStorePage([{ title: 'Tacos foto e2e', products: [{ name: 'Menu tacos foto e2e', price: 10.99, imageId: 'dh:menus-glovo/products/tacos' }, { name: 'Tacos simples foto e2e', price: 8.5 }] }]),
  });
  await routeGlovoImages(page, new Map([['tacos', GLOVO_PNG]]));
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/import`);
  await page.getByTestId('glovo-url-input').fill(STORE);
  await page.getByTestId('import-menu-button').click();
  await expect(page).toHaveURL(/\/import\/[a-z0-9]+$/, { timeout: 30_000 });

  // Open the product, as in the screenshot, and change its photo.
  await row(page, 'Menu tacos foto e2e').getByTestId('edit-item').click();
  const dialog = page.getByTestId('edit-item-dialog');
  const panel = dialog.getByTestId('photo-panel');
  await expect(panel.getByTestId('photo-origin')).toHaveText('Photo from Glovo');
  await expect(panel.getByTestId('change-photo')).toHaveText('Change photo');

  // Without the rights confirmation nothing is uploaded.
  await panel.getByTestId('photo-file').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: MY_PNG });
  await expect(panel.getByTestId('photo-error')).toContainText('confirm you may use this photo');

  await panel.getByTestId('photo-rights').check();
  await panel.getByTestId('photo-file').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: MY_PNG });
  await expect(panel.getByTestId('photo-origin')).toHaveText('Your photo');
  const mine = panel.getByTestId('product-thumb');
  await expect(mine).toHaveAttribute('src', /^\/media\//);
  await expect.poll(() => mine.evaluate(loaded)).toBe(true);
  await screenshot(page, 'import-photo-changed');

  // Back to the Glovo photo, then to mine again.
  await panel.getByTestId('restore-photo').click();
  await expect(panel.getByTestId('photo-origin')).toHaveText('Photo from Glovo');
  await panel.getByTestId('photo-file').setInputFiles({ name: 'mine2.png', mimeType: 'image/png', buffer: MY_PNG_2 });
  await expect(panel.getByTestId('photo-origin')).toHaveText('Your photo');

  // Closing the dialog: the table shows the new photo.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row(page, 'Menu tacos foto e2e').getByTestId('product-thumb')).toHaveAttribute('src', /^\/media\//);

  // A product without a photo can get one.
  await row(page, 'Tacos simples foto e2e').getByTestId('edit-item').click();
  await expect(dialog.getByTestId('change-photo')).toHaveText('Add photo');
  await expect(dialog.getByTestId('restore-photo')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Saving: my photo needs no platform-photo checkbox.
  await page.getByTestId('go-finish').click();
  const publish = page.getByTestId('publish-import-form');
  await expect(publish.getByTestId('own-photos-note')).toHaveText('1 photo you uploaded will be added automatically.');
  await expect(publish.getByTestId('image-rights')).toHaveCount(0);
  await publish.getByTestId('station-all').selectOption({ label: 'Seed Kitchen' });
  await publish.getByTestId('confirm-review').check();
  await publish.getByRole('button', { name: 'Save 2 products as drafts' }).click();
  await expect(page.getByTestId('publish-summary')).toContainText('1 uploaded photo added.');

  await page.goto(`/dashboard/${s.orgSlug}/menu`);
  const thumb = page.getByTestId('menu-product').filter({ hasText: 'Menu tacos foto e2e' }).locator('img');
  await expect(thumb).toHaveAttribute('src', /^\/media\//);
  await expect.poll(() => thumb.evaluate(loaded)).toBe(true);
});

test('menu: change the main photo, reorder and remove', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu`);
  // The thumbnail opens the dish's photos.
  await page.getByTestId('menu-product').filter({ hasText: 'Seed tajine' }).getByTestId('menu-photo-link').click();
  await expect(page).toHaveURL(/\/menu\/products\/[a-z0-9]+#photos$/);
  const manager = page.getByTestId('photo-manager');
  await expect(manager.getByTestId('no-photos')).toBeVisible();

  const upload = async (buffer: Buffer, placement?: 'main' | 'extra') => {
    const form = manager.getByTestId('upload-photo-form');
    await form.locator('#image').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer });
    if (placement) await form.locator(`input[name=placement][value=${placement}]`).check();
    await form.getByLabel('I have the right to publish this photo.').check();
    const before = await manager.getByTestId('managed-photo').count();
    await form.locator('button[type=submit]').click();
    await expect(manager.getByTestId('managed-photo')).toHaveCount(before + 1);
  };
  await upload(MY_PNG);
  await expect(manager.getByTestId('managed-photo')).toHaveCount(1);
  const first = await manager.getByTestId('managed-photo').first().locator('img').getAttribute('src');

  // A second upload replaces the main photo by default.
  await upload(MY_PNG_2, 'main');
  await expect(manager.getByTestId('managed-photo')).toHaveCount(2);
  await expect(manager.getByTestId('managed-photo').first().locator('img')).not.toHaveAttribute('src', first!);
  await expect(manager.getByTestId('managed-photo').first().getByTestId('main-photo-badge')).toBeVisible();
  await screenshot(page, 'menu-photo-manager');

  // Make the older one the main photo again.
  await manager.getByTestId('managed-photo').nth(1).getByTestId('make-main').click();
  await expect(manager.getByTestId('managed-photo').first().locator('img')).toHaveAttribute('src', first!);

  // Remove the main photo: the other one takes over.
  await manager.getByTestId('managed-photo').first().getByTestId('remove-photo').click();
  await page.getByTestId('confirm-dialog').getByTestId('confirm-action').click();
  await expect(manager.getByTestId('managed-photo')).toHaveCount(1);
  await expect(manager.getByTestId('managed-photo').first().locator('img')).not.toHaveAttribute('src', first!);
  await expect(manager.getByTestId('managed-photo').first().getByTestId('main-photo-badge')).toBeVisible();
});
