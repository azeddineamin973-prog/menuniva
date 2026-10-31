import { expect, test } from '@playwright/test';
import { login, PNG_1x1, seed, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`mb${Date.now()}`);
});

test('M6-08: required choice is enforced and size/extras change the server total', async ({ page }) => {
  await page.goto(`/t/${s.qrToken}`);
  await page.getByTestId('customer-product').filter({ hasText: 'Seed tajine' }).click();
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Acompanhamento'); // required group not chosen
  await page.getByLabel('Grande').check();
  await page.getByLabel('Arroz').check();
  await expect(page.getByTestId('add-to-cart')).toContainText('20,50');
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').click();
  await expect(page.getByTestId('cart-total')).toHaveText('20,50 €');
});

test('M4-11/M4-12/M4-13: translation editor, review step and language settings reach the guest menu', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/translations`);
  const missingBefore = Number(await page.getByTestId('missing-count').innerText());
  expect(missingBefore).toBeGreaterThan(0);
  const fr = page.locator('[data-testid=tr-row][data-name="Seed tajine"]').getByTestId('tr-product-fr');
  await fr.fill('Tajine maison (test)');
  await fr.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();
  await expect(fr.locator('xpath=ancestor::form').getByText('Saved')).toBeVisible();
  await page.reload();
  expect(Number(await page.getByTestId('missing-count').innerText())).toBe(missingBefore - 1);
  await page.getByRole('button', { name: 'Mark translations as reviewed' }).click();
  await expect(page.getByText('Recorded')).toBeVisible();

  const guest = await browser.newPage();
  await guest.goto(`/t/${s.qrToken}`);
  await guest.getByTestId('language-switcher').selectOption('fr');
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Tajine maison (test)' })).toHaveCount(1);
  await guest.getByTestId('language-switcher').selectOption('es');
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toHaveCount(1); // no Spanish yet → source text, nothing invented

  // Disable Arabic → guests can no longer choose it
  await page.goto(`/dashboard/${s.orgSlug}/settings`);
  const org = page.getByTestId('org-settings-form');
  await org.getByLabel('العربية').uncheck();
  await org.getByRole('button', { name: 'Save' }).click();
  await expect(org.getByText('Saved')).toBeVisible();
  await guest.reload();
  await expect(guest.getByTestId('language-switcher').locator('option[value=ar]')).toHaveCount(0);
  await expect(guest.getByTestId('language-switcher').locator('option[value=fr]')).toHaveCount(1);
  await guest.close();
});

test('M1-08/M3-04/M6-05: branding upload and colours appear on the SEO-ready storefront', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form = page.getByTestId('branding-form');
  await form.getByRole('radio', { name: /Moroccan/ }).click();
  await form.locator('#logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await form.locator('#tagline').fill('Cozinha de teste E2E');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();

  // An SVG disguised as PNG is refused
  await form.locator('#logo').setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Only PNG, JPEG or WebP images are accepted.')).toBeVisible();

  await page.goto(`/r/${s.orgSlug}`);
  const shell = page.getByTestId('storefront');
  await expect(shell).toHaveAttribute('style', /--sf-primary:\s*#1F5C4A/i);
  await expect(shell).toHaveClass(/sf-pattern/);
  const logo = shell.locator('header img').first();
  const src = await logo.getAttribute('src');
  expect(src).toMatch(/^\/media\/.+\.png$/);
  const media = await page.request.get(src!);
  expect(media.headers()['content-type']).toBe('image/png');
  expect(media.headers()['x-content-type-options']).toBe('nosniff');

  // SEO
  await expect(page).toHaveTitle(new RegExp(`E2E Seed .* — Braga`));
  await expect(page.locator('meta[name=description]')).toHaveAttribute('content', 'Cozinha de teste E2E');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', new RegExp(`/r/${s.orgSlug}$`));
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /E2E Seed/);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
  expect(ld['@type']).toBe('Restaurant');
  expect(ld.address.addressLocality).toBe('Braga');
  // Private pages are not indexable
  await page.goto(`/t/${s.qrToken}`);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
});

test('M6-04: QR PDF download and printable sheet', async ({ page }) => {
  await login(page, s.owner, s.password);
  const pdf = await page.request.get(`/api/dashboard/${s.orgSlug}/qr/sheet.pdf?location=${s.locationId}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  expect(body.length).toBeGreaterThan(2000);
  await page.goto(`/dashboard/${s.orgSlug}/tables/print`);
  await expect(page.getByText('Mesa 07')).toBeVisible();
  await expect(page.getByText('Mesa 07').locator('xpath=..').locator('svg')).toBeVisible();
  // Another user cannot download this tenant's QR codes
  const anon = await page.context().browser()!.newContext();
  const r = await anon.request.get(`http://localhost:3100/api/dashboard/${s.orgSlug}/qr/sheet.pdf?location=${s.locationId}`);
  expect(r.status()).toBe(401);
  await anon.close();
});
