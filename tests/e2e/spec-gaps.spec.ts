import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

/** Browser checks for the items closed after the final spec review (Parts 9, 19, 21, 22, 25). */
let s: Seed;
test.beforeAll(() => {
  s = seed(`gp${Date.now()}`);
});

test('Part 22: storefront shows the configured opening hours in the guest language', async ({ page }) => {
  const all = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '00:00', close: '00:00' }]]))); // open 24 h: independent of the clock
  await sql(`UPDATE "RestaurantLocation" SET "openingHours" = $2::jsonb WHERE id = $1`, [s.locationId, all]);
  await page.goto(`/r/${s.orgSlug}?lang=en`);
  await expect(page.getByTestId('open-now')).toHaveText('Open now');
  await page.getByTestId('storefront-hours').locator('summary').click();
  await expect(page.getByTestId('storefront-hours')).toContainText('Monday');
  await page.goto(`/r/${s.orgSlug}?lang=pt`);
  await page.getByTestId('storefront-hours').locator('summary').click();
  await expect(page.getByTestId('storefront-hours')).toContainText('segunda-feira');
});

test('Part 9: staff mark an order as priority; the kitchen display shows it first with a badge', async ({ page, browser }) => {
  const g = await browser.newPage();
  for (let i = 0; i < 2; i++) {
    await g.goto(`/t/${s.qrToken}`);
    await g.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
    await g.getByTestId('add-to-cart').click();
    await g.getByTestId('view-cart').click();
    await g.getByTestId('submit-order').click();
    await expect(g).toHaveURL(/\/o\//);
    await g.evaluate(() => sessionStorage.clear()); // new idempotency key for the second, separate order
  }
  await g.close();
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  const cards = page.getByTestId('column-new').getByTestId('order-card');
  await expect(cards).toHaveCount(2);
  for (const n of ['1', '2']) await page.locator(`[data-testid=order-card][data-order-number="${n}"]`).getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card')).toHaveCount(2);
  const second = page.locator('[data-testid=order-card][data-order-number="2"]');
  await second.getByTestId('toggle-priority').click();
  await expect(second.getByTestId('priority-badge')).toBeVisible();
  await page.goto(`/dashboard/${s.orgSlug}/kitchen`);
  await page.getByTestId('station-link').first().click();
  const first = page.getByTestId('kds-ticket').first();
  await expect(first).toContainText('#2');
  await expect(first.getByTestId('kds-priority')).toBeVisible();
});

test('Parts 19 + 21: owner sends a support request and a plan change request; Super Admin applies it', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/support`);
  const f = page.getByTestId('support-form');
  await f.getByLabel('Subject').fill('E2E help with QR codes');
  await f.getByLabel('What do you need?').fill('How do I print the QR sheet for the terrace tables?');
  await f.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('support-request').filter({ hasText: 'E2E help with QR codes' })).toBeVisible();

  await page.goto(`/dashboard/${s.orgSlug}/subscription`);
  const pf = page.getByTestId('plan-change-form');
  await pf.getByLabel('New plan').selectOption({ label: 'Growth' });
  await pf.getByRole('button', { name: 'Request plan change' }).click();
  await expect(page.getByTestId('pending-plan')).toContainText('Growth');
  await expect(page.getByTestId('sub-plan')).toHaveText('Starter'); // nothing changed yet

  await sql(`UPDATE "User" SET "platformRole" = 'PLATFORM_SUPER_ADMIN' WHERE email = $1`, [s.cook]);
  try {
    const admin = await browser.newPage();
    await login(admin, s.cook, s.password);
    await admin.goto('/admin/support');
    await expect(admin.getByText('E2E help with QR codes')).toBeVisible();
    await expect(admin.getByText('Plan upgrade request: Starter → Growth')).toBeVisible();
    await admin.goto(`/admin/tenants/${s.orgId}`);
    await expect(admin.getByTestId('admin-pending-plan')).toContainText('Growth');
    await admin.getByTestId('apply-plan').click();
    await expect(admin.getByTestId('admin-pending-plan')).toHaveCount(0);
    await admin.close();
  } finally {
    await sql(`UPDATE "User" SET "platformRole" = 'USER' WHERE email = $1`, [s.cook]);
  }
  await page.reload();
  await expect(page.getByTestId('sub-plan')).toHaveText('Growth');
});

test('Part 25: a staff member edits their profile, downloads their data and deletes their account', async ({ page }) => {
  await login(page, s.waiter, s.password);
  await page.goto(`/dashboard/${s.orgSlug}`);
  await page.getByTestId('my-account-link').first().click();
  await expect(page).toHaveURL(/\/account$/);
  const pf = page.getByTestId('profile-form');
  await pf.getByLabel('Name').fill('E2E Waiter Renamed');
  await pf.getByRole('button', { name: 'Save' }).click();
  await expect(pf.getByText('Saved')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('account-export').click();
  const file = await (await download).path();
  const data = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  expect(data.user).toMatchObject({ name: 'E2E Waiter Renamed', email: s.waiter });
  const del = page.getByTestId('delete-account-form');
  await del.getByLabel('Password').fill(s.password);
  await del.getByLabel('Type DELETE to confirm').fill('DELETE');
  await del.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByTestId('login-form').locator('input[name=email]').fill(s.waiter);
  await page.getByTestId('login-form').locator('input[name=password]').fill(s.password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await expect(page.getByTestId('login-form').getByRole('alert')).toBeVisible();
});
