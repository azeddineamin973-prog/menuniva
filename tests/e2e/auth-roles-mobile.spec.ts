import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`arm${Date.now()}`);
});

test('M2-05: generic error for bad credentials, login, logout, disabled users blocked', async ({ page }) => {
  await page.goto('/login');
  const form = page.getByTestId('login-form');
  await form.locator('input[name=email]').fill(s.owner);
  await form.locator('input[name=password]').fill('wrong-password-123');
  await form.locator('button[type=submit]').click();
  const alert = form.getByRole('alert');
  await expect(alert).toBeVisible();
  const wrongPwText = await alert.innerText();
  await form.locator('input[name=email]').fill('nobody@test.menuniva.local');
  await form.locator('input[name=password]').fill('wrong-password-123');
  await form.locator('button[type=submit]').click();
  await expect(form.getByRole('alert')).toHaveText(wrongPwText); // same message: no account enumeration

  await login(page, s.owner, s.password);
  await expect(page).toHaveURL(new RegExp(`/dashboard/${s.orgSlug}`));
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto(`/dashboard/${s.orgSlug}`);
  await expect(page).toHaveURL(/\/login\?next=/);

  await sql(`UPDATE "User" SET "disabledAt" = now() WHERE email = $1`, [s.waiter]);
  await page.goto('/login');
  await form.locator('input[name=email]').fill(s.waiter);
  await form.locator('input[name=password]').fill(s.password);
  await form.locator('button[type=submit]').click();
  await expect(form.getByRole('alert')).toHaveText(wrongPwText);
  await sql(`UPDATE "User" SET "disabledAt" = NULL WHERE email = $1`, [s.waiter]);
});

test('M3-10: kitchen staff land on the kitchen display and cannot open management pages or APIs', async ({ page }) => {
  await login(page, s.cook, s.password);
  await page.goto(`/dashboard/${s.orgSlug}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/${s.orgSlug}/kitchen$`));
  const nav = page.locator('aside nav');
  await expect(nav.getByRole('link', { name: 'Kitchen Display' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Live Orders' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Subscription' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  await expect(page.getByText("You don't have access to this section")).toBeVisible();
  const api = await page.request.get(`/api/dashboard/${s.orgSlug}/orders/live?location=${s.locationId}`);
  expect(api.status()).toBe(403);
  const staffPage = await page.goto(`/dashboard/${s.orgSlug}/staff`);
  expect(staffPage?.url()).toContain('/forbidden');
});

test('M3-10: waiters see orders and table requests but not staff, settings or billing', async ({ page }) => {
  await login(page, s.waiter, s.password);
  await page.goto(`/dashboard/${s.orgSlug}`);
  const nav = page.locator('aside nav');
  await expect(nav.getByRole('link', { name: 'Live Orders' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Waiter requests' })).toBeVisible();
  for (const hidden of ['Staff', 'Restaurant Settings', 'Subscription', 'Analytics']) await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
});

test.describe('mobile (360 × 740)', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('M1-09: mobile navigation and persistent dark mode; M4-09: quick sold-out from a phone', async ({ page, browser }) => {
    await login(page, s.owner, s.password);
    await page.goto(`/dashboard/${s.orgSlug}`);
    await expect(page.locator('aside')).toBeHidden();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const mobileNav = page.locator('#mobile-nav');
    await expect(mobileNav.getByRole('link', { name: 'Live Orders' })).toBeVisible();
    await mobileNav.getByRole('button', { name: /Dark mode/ }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await mobileNav.getByRole('link', { name: 'Live Orders' }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.locator('#mobile-nav')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(360 + 1);

    await page.goto(`/dashboard/${s.orgSlug}/menu/quick`);
    const row = page.locator('li').filter({ hasText: 'Seed tajine' });
    await row.getByRole('button', { name: 'Sold out', exact: true }).click();
    await expect(row.getByText('Sold out', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Available', exact: true })).toBeVisible();

    const guest = await browser.newPage({ viewport: { width: 360, height: 740 } });
    await guest.goto(`/t/${s.qrToken}`);
    const sold = guest.getByTestId('customer-product').filter({ hasText: 'Seed tajine' });
    await expect(sold).toBeDisabled();
    await expect(sold).toContainText('Esgotado');
    await guest.close();

    await row.getByRole('button', { name: 'Available', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Sold out', exact: true })).toBeVisible();
    await page.locator('html').evaluate(() => (document.cookie = 'mn_theme=light; path=/'));
  });
});
