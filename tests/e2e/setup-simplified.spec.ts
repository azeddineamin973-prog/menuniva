import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

let s: Seed;
test.beforeAll(async () => {
  s = seed(`setup${Date.now()}`);
  // Put the restaurant back into setup so the wizard is live, and leave real gaps to fix.
  await sql(`UPDATE "RestaurantOrganization" SET status = 'ONBOARDING', "onboardingData" = '{}'::jsonb WHERE id = $1`, [s.orgId]);
  await sql(`UPDATE "RestaurantLocation" SET "postalCode" = NULL, "isPublished" = false WHERE id = $1`, [s.locationId]);
});

test('every setup step page offers the way back and the way on, and the wizard lists only what is missing', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/setup`);

  // The wizard says what is actually missing rather than repeating each step's description.
  const todo = page.getByTestId('setup-todo');
  await expect(todo).toBeVisible();
  await expect(todo).toContainText('Postal code is missing');
  await expect(page.getByTestId('setup-missing-details')).toContainText('Postal code is missing');
  await screenshot(page, 'setup-wizard-todo');

  // Walk from the checklist into a step, then straight on to the next one.
  await page.getByTestId('setup-step-translations').click();
  await expect(page).toHaveURL(/\/menu\/translations/);
  const nav = page.getByTestId('setup-nav');
  await expect(nav).toHaveAttribute('data-step', 'translations');
  await expect(nav).toContainText('Step 4 of 10');
  await expect(page.getByTestId('setup-nav-missing')).toContainText('translations are missing');

  await page.getByTestId('setup-nav-next').click();
  await expect(page).toHaveURL(/\/menu\/quick/); // step 5: prices
  await expect(page.getByTestId('setup-nav')).toHaveAttribute('data-step', 'prices');

  await page.getByTestId('setup-nav-back').click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${s.orgSlug}/setup$`));
});

test('the wizard bar appears on each step page and disappears once setup is finished', async ({ page }) => {
  await login(page, s.owner, s.password);
  for (const [path, step] of [
    ['/settings', 'details'],
    ['/settings/branding', 'branding'],
    ['/menu', 'import'],
    ['/menu/translations', 'translations'],
    ['/menu/quick', 'prices'],
    ['/tables', 'tables'],
    ['/settings/channels', 'channels'],
    ['/stations', 'kitchen'],
    ['/setup/preview', 'preview'],
    ['/setup/publish', 'publish'],
  ] as const) {
    await page.goto(`/dashboard/${s.orgSlug}${path}`);
    await expect(page.getByTestId('setup-nav'), path).toHaveAttribute('data-step', step);
  }

  // With every step satisfied the bar is gone: a running restaurant is not told it is being set up.
  const finished = seed(`done${Date.now()}`);
  await sql(
    `UPDATE "RestaurantOrganization" SET "onboardingData" = '{"brandingSaved":true,"channelsSaved":true,"previewedAt":"2026-01-01","translationsReviewedAt":"2026-01-01"}'::jsonb,
       "enabledLanguages" = ARRAY['pt']::"LanguageCode"[], "sourceLanguage" = 'pt', "defaultLanguage" = 'pt' WHERE id = $1`,
    [finished.orgId],
  );
  await sql(`UPDATE "RestaurantLocation" SET "postalCode" = '4710-311', "isPublished" = true, "takeawayEnabled" = true, "openingHours" = '{"mon":[{"open":"12:00","close":"23:00"}]}'::jsonb WHERE id = $1`, [
    finished.locationId,
  ]);
  await sql(`INSERT INTO "RestaurantBranding" (id, "organizationId", "logoUrl") VALUES ($1, $2, '/media/x') ON CONFLICT ("organizationId") DO UPDATE SET "logoUrl" = '/media/x'`, [
    `b${Date.now()}`,
    finished.orgId,
  ]);
  // Sign out of the first restaurant before signing into the second one.
  await page.context().clearCookies();
  await login(page, finished.owner, finished.password);
  await page.goto(`/dashboard/${finished.orgSlug}/menu`);
  await expect(page.getByTestId('setup-nav')).toHaveCount(0);
});
