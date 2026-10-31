import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

/**
 * Phase 3: "Preview my restaurant" and "Your restaurant link".
 * The owner previews the real guest menu (draft or live) in a device frame, in any language,
 * and opens / copies / downloads the QR of the public link. Guests never see a draft.
 */
let s: Seed;
test.beforeAll(async () => {
  s = seed(`pv${Date.now()}`);
  await sql(`UPDATE "RestaurantOrganization" SET "enabledLanguages" = ARRAY['pt','en','ar']::"LanguageCode"[] WHERE id = $1`, [s.orgId]);
  await sql(`UPDATE "RestaurantLocation" SET "isPublished" = false, "takeawayEnabled" = true WHERE id = $1`, [s.locationId]);
});

const frame = (page: Page) => page.frameLocator('[data-testid=preview-frame]');

test('draft: guests, the public link and the QR never reveal an unpublished menu', async ({ browser }) => {
  const guest = await browser.newPage();
  for (const path of [`/r/${s.orgSlug}`, `/r/${s.orgSlug}?preview=1`]) {
    await guest.goto(path);
    await expect(guest.getByTestId('not-published')).toBeVisible();
    await expect(guest.getByTestId('customer-product')).toHaveCount(0);
    await expect(guest.locator('body')).not.toContainText('Seed tajine');
    await expect(guest.getByTestId('preview-banner')).toHaveCount(0);
  }
  // The ordering pages of a draft stay closed to guests, preview flag or not.
  expect((await guest.request.get(`/r/${s.orgSlug}/order/pickup?preview=1`)).status()).toBe(404);
  // The QR endpoint is staff-only.
  const qr = await guest.request.get(`/api/dashboard/${s.orgSlug}/restaurant-qr`, { maxRedirects: 0 });
  expect(qr.status()).not.toBe(200);
  await guest.close();
});

test('owner: Preview my restaurant shows the real draft menu in a phone, tablet and desktop frame, in every language', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}`);
  await page.getByTestId('preview-restaurant-button').click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${s.orgSlug}/preview$`));

  // The real customer menu, marked as a draft preview.
  const f = frame(page);
  await expect(f.getByTestId('preview-banner')).toBeVisible();
  await expect(f.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toBeVisible();
  await expect(f.getByTestId('storefront')).toHaveAttribute('lang', /^pt/);

  // Languages are switched from the toolbar (URL parameter, the owner's cookie is untouched).
  await page.getByTestId('preview-language').selectOption('ar');
  await expect(f.getByTestId('storefront')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('preview-language').selectOption('en');
  await expect(f.getByTestId('storefront')).toHaveAttribute('dir', 'ltr');
  await expect(f.getByTestId('storefront')).toHaveAttribute('lang', /^en/);
  expect((await context.cookies()).find((c) => c.name === 'mn_lang')).toBeUndefined();
  // …and from the menu's own switcher, which then keeps the toolbar in step.
  await f.getByTestId('language-switcher').selectOption('ar');
  await expect(f.getByTestId('storefront')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('preview-language')).toHaveValue('ar');
  await page.getByTestId('preview-language').selectOption('en');

  // Device sizes: the page inside really is phone / tablet / desktop wide.
  const width = () => f.locator('body').evaluate(() => window.innerWidth);
  await expect.poll(width).toBe(390);
  await screenshot(page, 'preview-phone');
  await page.getByTestId('preview-device-tablet').click();
  await expect(page.getByTestId('restaurant-preview')).toHaveAttribute('data-device', 'tablet');
  await expect.poll(width).toBe(820);
  await page.getByTestId('preview-device-desktop').click();
  await expect.poll(width).toBe(1280);
  await screenshot(page, 'preview-desktop');
  await page.getByTestId('preview-device-phone').click();
  await expect.poll(width).toBe(390);

  // Ordering options are previewable too, with ordering switched off.
  await page.getByTestId('preview-page').selectOption('pickup');
  await expect(f.getByTestId('preview-banner')).toBeVisible();
  await expect(f.getByTestId('order-mode')).toBeVisible();
  await expect(f.getByText('Nothing you do here creates a real order.')).toBeVisible();
  await expect(f.getByTestId('customer-product').filter({ hasText: 'Seed harira' })).toBeVisible();

  // Your restaurant link: draft status, the real public address, and what remains.
  const card = page.getByTestId('restaurant-link-card');
  await expect(card).toHaveAttribute('data-status', 'draft');
  await expect(card.getByTestId('link-status')).toHaveText('Draft · not public');
  const url = (await card.getByTestId('restaurant-url').getAttribute('data-url'))!;
  expect(url).toBe(`http://localhost:3100/r/${s.orgSlug}`); // APP_BASE_URL of the test server + tenant slug
  await expect(card.getByTestId('link-local-warning')).toBeVisible(); // localhost is labelled, not presented as shareable
  await expect(card.getByTestId('open-restaurant')).toHaveAttribute('aria-disabled', 'true');
  await expect(card.getByTestId('publish-remaining')).toBeVisible();

  await card.getByTestId('copy-restaurant-link').click();
  await expect(card.getByTestId('copy-restaurant-link')).toHaveAttribute('data-state', 'copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  const qrHref = (await card.getByTestId('download-restaurant-qr').getAttribute('href'))!;
  const png = await page.request.get(qrHref);
  expect(png.status()).toBe(200);
  expect(png.headers()['content-type']).toBe('image/png');
  // The test server runs on localhost: the file and the buttons say it is a test QR, not a shareable one.
  expect(png.headers()['content-disposition']).toMatch(/attachment; filename=".+-menu-qr-local-test\.png"/);
  expect(png.headers()['x-restaurant-url-public']).toBe('no');
  await expect(card.getByTestId('download-restaurant-qr')).toHaveText('Download test QR code');
  await expect(card.getByTestId('copy-restaurant-link')).toContainText(/Copied|Copy test link/);
  expect(png.headers()['x-restaurant-url']).toBe(url);
  expect((await png.body()).subarray(1, 4).toString()).toBe('PNG');

  // Nothing was published by previewing.
  const [{ isPublished }] = await sql<{ isPublished: boolean }>(`SELECT "isPublished" FROM "RestaurantLocation" WHERE id = $1`, [s.locationId]);
  expect(isPublished).toBe(false);
});

test('published: the link card opens the live menu, and the preview shows it without the draft banner', async ({ page, browser }) => {
  await sql(`UPDATE "RestaurantLocation" SET "isPublished" = true, "publishedAt" = now() WHERE id = $1`, [s.locationId]);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/preview`);
  const card = page.getByTestId('restaurant-link-card');
  await expect(card).toHaveAttribute('data-status', 'published');
  await expect(card.getByTestId('link-status')).toHaveText('Published');
  await expect(card.getByTestId('publish-remaining')).toHaveCount(0);
  await expect(frame(page).getByTestId('customer-product').first()).toBeVisible();
  await expect(frame(page).getByTestId('preview-banner')).toHaveCount(0);

  const open = card.getByTestId('open-restaurant');
  await expect(open).toHaveAttribute('href', `/r/${s.orgSlug}`);
  const [popup] = await Promise.all([page.waitForEvent('popup'), open.click()]);
  await expect(popup.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toBeVisible();
  await popup.close();

  // The overview carries the same card.
  await page.goto(`/dashboard/${s.orgSlug}`);
  await expect(page.getByTestId('restaurant-link-card')).toHaveAttribute('data-status', 'published');

  // Guests: a shared ?lang= link keeps working with the menu's own language switcher.
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await guest.goto(`/r/${s.orgSlug}?lang=en`);
  await expect(guest.getByTestId('storefront')).toHaveAttribute('lang', /^en/);
  await guest.getByTestId('language-switcher').selectOption('ar');
  await expect(guest).toHaveURL(/lang=ar/);
  await expect(guest.getByTestId('storefront')).toHaveAttribute('dir', 'rtl');
  await guest.close();
});

test('the preview page fits a 360 px phone even before its script has measured the screen', async ({ browser }) => {
  // Reproduces the intermittent "10 px wider" failure: on a slow phone the first paint happens
  // before the device frame is scaled. With scripts off, that first paint is what we see.
  const js = await browser.newContext();
  const signin = await js.newPage();
  await login(signin, s.owner, s.password);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, javaScriptEnabled: false });
  await ctx.addCookies(await js.cookies());
  await js.close();
  const page = await ctx.newPage();
  await page.goto(`/dashboard/${s.orgSlug}/preview`);
  await expect(page.getByTestId('restaurant-preview')).toBeVisible();
  const wider = await page.evaluate(() => document.documentElement.scrollWidth - 360);
  expect(wider, `preview is ${wider}px wider than the screen`).toBeLessThanOrEqual(1);
  await ctx.close();
});
