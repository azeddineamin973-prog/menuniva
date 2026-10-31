import { expect, test } from '@playwright/test';
import { issueSetupToken, seed, sql } from './helpers';

/** M2-12 / TEST 16: Super Admin bootstraps securely, creates a tenant, the new owner joins; suspension is enforced and audited. */
test('Super Admin creates a tenant, owner joins via invitation, suspension blocks access', async ({ page, browser }) => {
  const admin = { email: `admin.${Date.now()}@test.menuniva.local`, password: 'admin-password-123' };
  const token = await issueSetupToken();

  // Invalid token is refused
  await page.goto('/setup?token=not-a-valid-token-value-xxxxxxxx');
  await expect(page.getByText('This setup link is not valid')).toBeVisible();

  await page.goto(`/setup?token=${token}`);
  await page.getByLabel('Full name').fill('E2E Founder');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Restaurants' })).toBeVisible();

  // The token cannot be reused
  await page.goto(`/setup?token=${token}`);
  await expect(page.getByText('This setup link is not valid')).toBeVisible();

  // Create a tenant for a new owner
  const ownerEmail = `newowner.${Date.now()}@test.menuniva.local`;
  await page.goto('/admin/tenants/new');
  const f = page.getByTestId('create-tenant-form');
  await f.getByLabel('Restaurant name').fill('E2E Admin Tenant');
  await f.getByLabel('City').fill('Porto');
  await f.getByLabel('Owner email').fill(ownerEmail);
  await f.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByTestId('tenant-created')).toBeVisible();
  const inviteLink = (await page.getByTestId('invite-link').innerText()).trim();
  expect(inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

  // Owner accepts the invitation
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await owner.goto(new URL(inviteLink).pathname);
  await owner.getByRole('link', { name: 'Create account' }).click();
  await owner.getByLabel('Full name').fill('E2E New Owner');
  await owner.getByLabel('Email').fill(ownerEmail);
  await owner.getByLabel('Password').fill('owner-password-123');
  await owner.getByRole('button', { name: 'Create account' }).click();
  await expect(owner).toHaveURL(/\/invite\//);
  await owner.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(owner).toHaveURL(/\/dashboard\/e2e-admin-tenant/);
  await expect(owner.getByTestId('current-org')).toHaveText('E2E Admin Tenant');

  // Owner (not an admin) cannot see /admin
  const res = await owner.goto('/admin');
  expect(res?.status()).toBe(404);

  // Admin suspends the tenant (reason required)
  await page.goto('/admin');
  await page.getByTestId('tenants-table').getByRole('link', { name: 'E2E Admin Tenant' }).click();
  await page.locator('#status').selectOption('SUSPENDED');
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect(page.getByText(/reason for suspending/)).toBeVisible();
  await page.locator('#reason').fill('E2E test suspension');
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();

  await owner.goto('/dashboard/e2e-admin-tenant');
  await expect(owner).toHaveURL(/\/suspended$/);

  // Every Super Admin action is audited
  const rows = await sql<{ action: string }>(`SELECT action FROM "AuditLog" WHERE action LIKE 'platform.%'`);
  const actions = rows.map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(['platform.admin_bootstrapped', 'platform.tenant_created', 'platform.tenant_status_changed']));

  // Admin has no implicit access to a tenant dashboard (privacy)
  const s = seed(`adm${Date.now()}`);
  const forbidden = await page.goto(`/dashboard/${s.orgSlug}`);
  expect(forbidden?.status()).toBe(404);
  await ownerCtx.close();
});
