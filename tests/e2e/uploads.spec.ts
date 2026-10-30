import { expect, test } from '@playwright/test';
import { login, PNG_1x1, seed, sql, type Seed } from './helpers';

/** Audit BUG-06: oversized, invalid and valid images never produce a crash screen. */
let s: Seed;
test.beforeAll(() => {
  s = seed(`up${Date.now()}`);
});
const big = (mb: number) => Buffer.concat([PNG_1x1, Buffer.alloc(Math.round(mb * 1024 * 1024))]);

test('branding logo: 7 MB refused in the browser with a clear message, nothing is sent', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form = page.getByTestId('branding-form');
  let actionPosts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/settings/branding')) actionPosts++;
  });
  await form.locator('#logo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: big(7) });
  await expect(form.getByTestId('file-error')).toHaveText('Image too large. Maximum allowed size is 5 MB.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByTestId('file-error')).toBeVisible();
  expect(actionPosts).toBe(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('product photo: even if the browser check is bypassed, a 7 MB upload ends in a form message, not a crash', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/products/${s.dishId}`);
  const input = page.locator('#image');
  await input.evaluate((el) => el.setAttribute('data-max-bytes', String(100 * 1024 * 1024))); // simulate an old/modified client
  await input.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: big(7) });
  const form = input.locator('xpath=ancestor::form');
  await form.locator('input[type=checkbox]').check().catch(() => undefined); // image rights, if asked
  await form.getByRole('button').last().click();
  await expect(form.getByRole('alert')).toContainText('Image too large. Maximum allowed size is 5 MB.');
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('server limit, invalid type, valid image; message follows the staff language (Portuguese)', async ({ page }) => {
  await sql(`UPDATE "User" SET "preferredLanguage" = 'pt' WHERE email = $1`, [s.owner]);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form = page.getByTestId('branding-form');
  // 5.5 MB: refused before upload (PT)
  await form.locator('#logo').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: big(5.5) });
  await expect(form.getByTestId('file-error')).toHaveText('Imagem demasiado grande. O tamanho máximo permitido é 5 MB.');
  // 5.5 MB with the browser check bypassed: the server refuses it with the same message
  await form.locator('#logo').evaluate((el) => el.setAttribute('data-max-bytes', String(100 * 1024 * 1024)));
  await form.locator('#logo').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: big(5.5) });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toContainText('Imagem demasiado grande. O tamanho máximo permitido é 5 MB.');
  // HTML disguised as PNG
  await page.reload();
  await form.locator('#logo').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('<!doctype html><script>alert(1)</script>') });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toContainText('Só são aceites imagens PNG, JPEG ou WebP.');
  // valid
  await page.reload();
  await form.locator('#logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  await sql(`UPDATE "User" SET "preferredLanguage" = 'en' WHERE email = $1`, [s.owner]);
});
