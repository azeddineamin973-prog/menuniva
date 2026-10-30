import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`an${Date.now()}`);
});

test('M12 TEST 18 (browser): order value, collected and unpaid shown separately; CSV export', async ({ page, browser }) => {
  const g = await browser.newPage();
  await g.goto(`/t/${s.qrToken}`);
  await g.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await g.getByRole('button', { name: '+' }).click();
  await g.getByTestId('add-to-cart').click();
  await g.getByTestId('view-cart').click();
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  await g.close();

  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/analytics`);
  await expect(page.getByTestId('m-order-value')).toHaveText('13,00 €');
  await expect(page.getByTestId('m-collected')).toHaveText('0,00 €');
  await expect(page.getByTestId('m-unpaid')).toHaveText('13,00 €');
  await expect(page.getByTestId('top-items')).toContainText('Seed harira');

  // A 5,00 € payment recorded by staff changes "collected" and "unpaid", never "order value".
  const [o] = await sql<{ id: string }>(`SELECT id FROM "Order" WHERE "organizationId" = $1`, [s.orgId]);
  await sql(`INSERT INTO "PaymentRecord" (id, "organizationId", "orderId", "amountCents", method) VALUES ('e2epay' || $1, $2, $1, 500, 'CASH')`, [o.id, s.orgId]);
  await sql(`UPDATE "Order" SET "paidCents" = 500, "paymentStatus" = 'PARTIALLY_PAID' WHERE id = $1`, [o.id]);
  await page.reload();
  await expect(page.getByTestId('m-order-value')).toHaveText('13,00 €');
  await expect(page.getByTestId('m-collected')).toHaveText('5,00 €');
  await expect(page.getByTestId('m-unpaid')).toHaveText('8,00 €');

  await page.getByTestId('range-7d').click();
  await expect(page).toHaveURL(/p=7d/);
  await expect(page.getByTestId('m-order-value')).toHaveText('13,00 €');

  const download = page.waitForEvent('download');
  await page.getByTestId('export-csv').click();
  const file = await (await download).path();
  const csv = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toContain('order_value_eur,paid_eur,unpaid_eur');
  expect(lines[1]).toMatch(/,TABLE,07,NEW,PARTIALLY_PAID,13\.00,0\.00,0\.00,13\.00,5\.00,8\.00$/);
});

test('M12 TEST 16 (browser): Super Admin switches a module off, records billing; owner sees plan, limits and history', async ({ page, browser }) => {
  // Temporarily promote a seeded user (the first-admin bootstrap test needs no admin to exist).
  await sql(`UPDATE "User" SET "platformRole" = 'PLATFORM_SUPER_ADMIN' WHERE email = $1`, [s.cook]);
  try {
    const admin = await browser.newPage();
    await login(admin, s.cook, s.password);
    await admin.goto(`/admin/tenants/${s.orgId}`);
    await admin.getByTestId('module-promotions').uncheck();
    await admin.getByRole('button', { name: 'Save modules' }).click();
    await expect(admin.getByText('Saved').first()).toBeVisible();
    const bf = admin.getByTestId('billing-form');
    await bf.getByLabel('Amount (€)').fill('49,00');
    await bf.getByLabel('Period from').fill('2026-11-01');
    await bf.getByLabel('Period to').fill('2026-11-30');
    await bf.getByRole('button', { name: 'Record payment received' }).click();
    await expect(admin.getByTestId('billing-record')).toContainText('49,00');

    await login(page, s.owner, s.password);
    await page.goto(`/dashboard/${s.orgSlug}`);
    await expect(page.getByRole('link', { name: 'Promotions' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reservations' }).first()).toBeVisible(); // other modules untouched
    await page.goto(`/dashboard/${s.orgSlug}/promotions`);
    await expect(page).toHaveURL(/\/unavailable\?m=promotions/);
    await expect(page.getByTestId('module-unavailable')).toBeVisible();

    await page.goto(`/dashboard/${s.orgSlug}/subscription`);
    await expect(page.getByTestId('sub-plan')).toHaveText('Starter');
    await expect(page.getByTestId('sub-status')).toHaveText('trialing');
    await expect(page.getByTestId('feature-promotions')).toHaveAttribute('data-on', 'false');
    await expect(page.getByTestId('feature-loyalty')).toHaveAttribute('data-on', 'true'); // trial includes every module
    await expect(page.getByTestId('limit-menuItems')).toContainText('2 / 250');
    await expect(page.getByTestId('billing-row')).toContainText('49,00');

    // Waiters cannot see the subscription page.
    const waiter = await browser.newPage();
    await login(waiter, s.waiter, s.password);
    await waiter.goto(`/dashboard/${s.orgSlug}/subscription`);
    await expect(waiter).toHaveURL(/\/forbidden/);
    await waiter.close();

    // Platform settings: pausing self-registration is enforced (restored afterwards).
    try {
      await admin.goto('/admin/settings');
      const cf = admin.getByTestId('platform-config-form');
      await cf.getByLabel('Restaurants can register themselves').uncheck();
      await cf.getByRole('button', { name: 'Save' }).click();
      await expect(cf.getByText('Saved')).toBeVisible();
      await page.goto('/onboarding/new');
      await expect(page.getByTestId('signups-closed')).toBeVisible();
    } finally {
      await sql(`DELETE FROM "PlatformConfig"`);
    }
    await admin.close();
  } finally {
    await sql(`UPDATE "User" SET "platformRole" = 'USER' WHERE email = $1`, [s.cook]);
  }
});
