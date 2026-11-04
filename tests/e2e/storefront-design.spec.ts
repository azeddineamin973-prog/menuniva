import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

/**
 * Storefront redesign: one ordering switcher with only the enabled channels, phone layouts
 * without sideways scrolling, the dish sheet and cart controls, and restaurant themes.
 */
let s: Seed;
test.beforeAll(async () => {
  s = seed(`sfd${Date.now()}`);
  await sql(
    `UPDATE "RestaurantLocation" SET "takeawayEnabled" = true, "reservationsEnabled" = true, "glovoUrl" = 'https://glovoapp.com/pt/en/braga/e2e-design/',
       "openingHours" = '{"mon":[{"open":"00:00","close":"23:59"}],"tue":[{"open":"00:00","close":"23:59"}],"wed":[{"open":"00:00","close":"23:59"}],"thu":[{"open":"00:00","close":"23:59"}],"fri":[{"open":"00:00","close":"23:59"}],"sat":[{"open":"00:00","close":"23:59"}],"sun":[{"open":"00:00","close":"23:59"}]}'::jsonb
     WHERE id = $1`,
    [s.locationId],
  );
});

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const width of [320, 390]) {
  test(`phone ${width}: ordering switcher, open status and menu fit the screen`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });
    await page.goto(`/r/${s.orgSlug}`);
    const modes = page.getByTestId('order-choice');
    await expect(modes.getByRole('link', { name: /Recolha no restaurante/ })).toBeVisible();
    await expect(page.getByTestId('other-modes').getByRole('link', { name: 'Reservar mesa' })).toBeVisible();
    // Delivery is off, so it is not offered; the external platform is a separate link, not a mode.
    await expect(modes.getByRole('link', { name: /entrega/i })).toHaveCount(0);
    await expect(modes.getByRole('link', { name: /Glovo/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Pedir na Glovo/ })).toHaveAttribute('href', 'https://glovoapp.com/pt/en/braga/e2e-design/');
    await expect(page.getByTestId('hero-open-status')).toHaveAttribute('data-open', 'true');
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);

    // The pickup page highlights its own channel and keeps the way back to the menu.
    await modes.getByRole('link', { name: /Recolha no restaurante/ }).click();
    await expect(page).toHaveURL(/\/order\/pickup/);
    await expect(page.getByTestId('order-mode')).toContainText('Recolha no restaurante');
    await expect(page.getByTestId('back-to-menu')).toHaveAttribute('href', new RegExp(`/r/${s.orgSlug}`));
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.close();
  });
}

test('dish sheet and cart: quantity controls, line photo or placeholder, totals', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/t/${s.qrToken}`);
  await page.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  const add = page.getByTestId('add-to-cart');
  await page.getByRole('button', { name: '+' }).click();
  await expect(add).toContainText('13,00'); // 2 × 6,50 €
  await add.click();
  await expect(page.getByTestId('view-cart')).toContainText('13,00');
  await page.getByTestId('view-cart').click();
  const line = page.getByTestId('cart-line');
  await expect(line).toHaveCount(1);
  await expect(line.locator('img, [data-testid=no-photo]')).toHaveCount(1);
  await expect(page.getByTestId('cart-total')).toHaveText('13,00 €');
  await screenshot(page, 'storefront-cart-390');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('themes: the owner picks a preset, the guest menu uses it with readable colours', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form = page.getByTestId('branding-form');
  await form.getByRole('radio', { name: /Midnight/ }).click();
  await expect(form.getByRole('radio', { name: /Midnight/ })).toHaveAttribute('aria-checked', 'true');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  const guest = await browser.newPage();
  await guest.goto(`/r/${s.orgSlug}`);
  const shell = guest.getByTestId('storefront');
  await expect(shell).toHaveAttribute('data-palette', 'dark');
  await expect(shell).toHaveAttribute('style', /--sf-card:\s*#181b20/i);
  await guest.close();

  // Changing one colour turns the theme into "Custom".
  await page.reload();
  await form.locator('input[name=primaryColor]').fill('#c2410c');
  await expect(form.getByRole('radio', { name: /Custom/ })).toHaveAttribute('aria-checked', 'true');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  const [row] = await sql<{ themePreset: string; primaryColor: string }>(`SELECT "themePreset", "primaryColor" FROM "RestaurantBranding" WHERE "organizationId" = $1`, [s.orgId]);
  expect(row.themePreset).toBe('custom');
  expect(row.primaryColor.toLowerCase()).toBe('#c2410c');
});
