import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { login, seed, sql, type Seed } from './helpers';

/**
 * Responsive photos in a real browser: guests download a right-sized AVIF copy instead of the
 * uploaded photo, the dashboard thumbnails do the same, and a removed photo is gone at every size.
 */
let s: Seed;
let photo: Buffer;
test.beforeAll(async () => {
  s = seed(`mv${Date.now()}`);
  // A realistic dish photo: 1200 × 900 JPEG of photo-like texture (about 300 KB).
  const raw = Buffer.alloc(1200 * 900 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  photo = await sharp(raw, { raw: { width: 1200, height: 900, channels: 3 } }).blur(1.2).jpeg({ quality: 88 }).toBuffer();
});

const imageInfo = (page: Page, url: string) =>
  page.locator(`img[src="${url}"]`).first().evaluate(async (img: HTMLImageElement) => {
    if (!img.complete) await new Promise((r) => img.addEventListener('load', r, { once: true }));
    return { currentSrc: img.currentSrc, naturalWidth: img.naturalWidth, inPicture: img.parentElement?.tagName === 'PICTURE' };
  });

test('guests on a phone and on a laptop get right-sized AVIF copies; a removed photo is gone at every size', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/products/${s.dishId}`);
  const input = page.locator('#image');
  const form = input.locator('xpath=ancestor::form');
  await input.setInputFiles({ name: 'dish.jpg', mimeType: 'image/jpeg', buffer: photo });
  await form.getByLabel('I have the right to publish this photo.').check();
  await form.getByRole('button', { name: /^(Add|Upload) photo$/ }).click();
  const urls = async () => (await sql<{ url: string }>(`SELECT url FROM "ProductImage" WHERE "productId" = $1`, [s.dishId])).map((r) => r.url);
  await expect.poll(urls).toHaveLength(1);
  const [url] = await urls();

  // Phone (3× screen): the tile is half the screen (195 px). Phones are offered copies up to
  // 480 px (2.5×), so the 480 px copy is chosen rather than the 640 px one a 585 px need would pick.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const guest = await phone.newPage();
  await guest.goto(`/t/${s.qrToken}`);
  const onPhone = await imageInfo(guest, url);
  expect(onPhone.inPicture).toBe(true);
  expect(onPhone.currentSrc).toMatch(/\?w=480&f=avif$/);
  // naturalWidth of a srcset image is density-corrected: the 480 px copy fills the 195 px slot.
  expect(Math.abs(onPhone.naturalWidth - 195)).toBeLessThanOrEqual(1); // browsers round differently
  const variant = await guest.request.get(onPhone.currentSrc);
  expect(variant.headers()['content-type']).toBe('image/avif');
  expect(variant.headers()['cache-control']).toContain('immutable');
  const variantBody = await variant.body();
  expect((await sharp(variantBody).metadata()).width).toBe(480);
  expect(variantBody.length).toBeLessThan(photo.length / 4);
  // The uploaded photo itself is unchanged and still served at its own address.
  expect(Buffer.from(await (await guest.request.get(url)).body()).equals(photo)).toBe(true);
  await phone.close();

  // Laptop (1×): the tile is about 300 px wide in the four-column grid.
  const laptop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await laptop.newPage();
  await desk.goto(`/t/${s.qrToken}`);
  expect((await imageInfo(desk, url)).currentSrc).toMatch(/\?w=320&f=avif$/);
  await laptop.close();

  // Dashboard menu thumbnail (44 px): the 160 px copy.
  await page.goto(`/dashboard/${s.orgSlug}/menu`);
  expect((await imageInfo(page, url)).currentSrc).toMatch(/\?w=160&f=(avif|webp)$/);

  // Removing the photo removes the original and its copies.
  await page.goto(`/dashboard/${s.orgSlug}/menu/products/${s.dishId}`);
  const tile = page.getByTestId('managed-photo').filter({ has: page.locator(`img[src="${url}"]`) });
  await tile.getByRole('button', { name: 'Remove' }).click();
  await page.getByTestId('confirm-dialog').getByTestId('confirm-action').click();
  await expect.poll(urls).toHaveLength(0);
  expect((await page.request.get(url)).status()).toBe(404);
  expect((await page.request.get(onPhone.currentSrc)).status()).toBe(404);
});
