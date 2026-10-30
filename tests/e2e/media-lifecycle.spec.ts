import { expect, test } from '@playwright/test';
import { login, PNG_1x1, seed, sql, type Seed } from './helpers';

/**
 * Restaurant images through the real UI: upload → shown to guests → replace → remove.
 * Runs on local files by default; on Supabase Storage with E2E_STORAGE_DRIVER=supabase.
 */
let s: Seed;
test.beforeAll(() => {
  s = seed(`ml${Date.now()}`);
});
// Distinct valid images (PNG with a different trailing chunk) so replacements are visible byte-wise.
const png = (tag: string) => Buffer.concat([PNG_1x1, Buffer.from(tag)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF e2e cover')]);
const brandingRow = async () => (await sql<{ logoUrl: string | null; coverUrl: string | null }>(`SELECT "logoUrl", "coverUrl" FROM "RestaurantBranding" WHERE "organizationId" = $1`, [s.orgId]))[0];

test('logo and cover: upload, display on the guest menu, replace, remove', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form = page.getByTestId('branding-form');
  await form.locator('#logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png('logo-1') });
  await form.locator('#cover').setInputFiles({ name: 'cover.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  const first = await brandingRow();
  expect(first.logoUrl).toMatch(new RegExp(`^/media/${s.orgId}/branding/[A-Za-z0-9_-]{22}\\.png$`));
  expect(first.coverUrl).toMatch(/\.jpg$/);

  // Guests see both images, served by the app
  await page.goto(`/r/${s.orgSlug}`);
  const header = page.getByTestId('storefront').locator('header');
  await expect(header.locator(`img[src="${first.logoUrl}"]`)).toBeVisible();
  await expect(header.locator(`img[src="${first.coverUrl}"]`)).toHaveCount(1);
  const shown = await page.request.get(first.logoUrl!);
  expect(shown.status()).toBe(200);
  expect(shown.headers()['content-type']).toBe('image/png');
  expect(Buffer.from(await shown.body())).toEqual(png('logo-1'));

  // Replace the logo: the guest menu shows the new file, the old one is gone
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  await form.locator('#logo').setInputFiles({ name: 'logo2.png', mimeType: 'image/png', buffer: png('logo-2') });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  const second = await brandingRow();
  expect(second.logoUrl).not.toBe(first.logoUrl);
  expect(second.coverUrl).toBe(first.coverUrl);
  expect((await page.request.get(first.logoUrl!)).status()).toBe(404);
  expect(Buffer.from(await (await page.request.get(second.logoUrl!)).body())).toEqual(png('logo-2'));
  await page.goto(`/r/${s.orgSlug}`);
  await expect(header.locator(`img[src="${second.logoUrl}"]`)).toBeVisible();

  // Remove logo and cover
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  await form.getByLabel('Remove the current logo').check();
  await form.getByLabel('Remove the current cover photo').check();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  expect(await brandingRow()).toMatchObject({ logoUrl: null, coverUrl: null });
  expect((await page.request.get(second.logoUrl!)).status()).toBe(404);
  expect((await page.request.get(first.coverUrl!)).status()).toBe(404);
  await page.goto(`/r/${s.orgSlug}`);
  await expect(header.locator('img')).toHaveCount(0);
});

test('dish photo: upload, display to guests, remove', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/products/${s.dishId}`);
  const input = page.locator('#image');
  const form = input.locator('xpath=ancestor::form');
  await input.setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: png('dish-1') });
  await form.getByLabel('I have the right to publish this photo.').check();
  await form.getByRole('button', { name: 'Upload photo' }).click();
  const photoUrls = async () => (await sql<{ url: string }>(`SELECT url FROM "ProductImage" WHERE "productId" = $1`, [s.dishId])).map((r) => r.url);
  await expect.poll(photoUrls).toHaveLength(1);
  const [url] = await photoUrls();
  expect(url).toMatch(new RegExp(`^/media/${s.orgId}/products/[A-Za-z0-9_-]{22}\\.png$`));
  const tile = page.locator(`img[src="${url}"]`).locator('xpath=..');
  await expect(tile.locator('img')).toBeVisible(); // shown in the dashboard

  const guest = await page.context().browser()!.newPage();
  await guest.goto(`${new URL(page.url()).origin}/t/${s.qrToken}`);
  await expect(guest.locator(`img[src="${url}"]`).first()).toBeVisible();
  await guest.close();
  expect(Buffer.from(await (await page.request.get(url)).body())).toEqual(png('dish-1'));

  await tile.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator(`img[src="${url}"]`)).toHaveCount(0);
  await expect.poll(photoUrls).toHaveLength(0);
  expect((await page.request.get(url)).status()).toBe(404);
});
