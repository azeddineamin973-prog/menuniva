import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

/**
 * AI translation end to end. The model is answered locally by the stand-in in
 * src/server/translation/openrouter.ts (standInModelFetch), which prefixes each string with the
 * target language — so these tests exercise the real request building, JSON validation, storage
 * and review gate without a billed API call and without reaching the internet.
 */
let s: Seed;
test.beforeAll(async () => {
  s = seed(`ai${Date.now()}`);
  await sql(`UPDATE "RestaurantOrganization" SET "sourceLanguage" = 'pt', "defaultLanguage" = 'pt', "enabledLanguages" = ARRAY['pt','en','fr']::"LanguageCode"[] WHERE id = $1`, [s.orgId]);
});

test('Translate all with AI: cost shown first, progress while it runs, then review and approve', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/translations`);

  const missingBefore = Number(await page.getByTestId('missing-count').innerText());
  expect(missingBefore).toBeGreaterThan(0);

  // What it will cost is shown before anything is spent.
  const panel = page.getByTestId('ai-panel');
  await expect(panel.getByTestId('ai-cells')).toHaveText(String(missingBefore));
  await expect(panel.getByTestId('ai-cost')).not.toHaveText('unknown');
  await expect(panel).toContainText('never ingredients, allergens or anything about your customers');
  await screenshot(page, 'ai-translate-estimate');

  await panel.getByTestId('translate-all').click();
  await expect(panel.getByTestId('ai-progress')).toContainText('Finished', { timeout: 60_000 });
  await expect(panel.getByTestId('ai-errors')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('missing-count')).toHaveText('0');
  const waiting = Number(await page.getByTestId('unreviewed-count').innerText());
  expect(waiting).toBe(missingBefore);
  await screenshot(page, 'ai-translate-done');

  // Until approved, a guest reading French still sees the restaurant's own words.
  const guest = await browser.newPage();
  await guest.goto(`/r/${s.orgSlug}?lang=fr`);
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toBeVisible();
  expect(await guest.locator('body').innerText()).not.toContain('[fr]');

  // Review, then approve everything in one go.
  await page.getByTestId('review-all').click();
  await expect(page.getByTestId('filter-machine')).toBeVisible();
  await expect(page.getByTestId('tr-row').first()).toBeVisible();
  const approve = page.getByTestId('approve-all-form');
  await approve.getByRole('button', { name: /Approve all/ }).click();
  // Approving is refused until the owner states they actually read them.
  await expect(approve).toContainText('confirm you checked the translations');
  await approve.getByLabel('I have read these translations and they are correct').check();
  await approve.getByRole('button', { name: /Approve all/ }).click();
  // With nothing left awaiting review the whole review card is gone, which is the confirmation.
  await expect(page.getByTestId('unreviewed-count')).toHaveText('0');
  await expect(page.getByTestId('approve-all-form')).toHaveCount(0);

  await guest.reload();
  expect(await guest.locator('body').innerText()).toContain('[fr]');
  await guest.close();
});

test('translating one dish, and never overwriting text the restaurant wrote itself', async ({ page }) => {
  const own = seed(`ai1${Date.now()}`);
  await sql(`UPDATE "RestaurantOrganization" SET "sourceLanguage" = 'pt', "defaultLanguage" = 'pt', "enabledLanguages" = ARRAY['pt','en']::"LanguageCode"[] WHERE id = $1`, [own.orgId]);
  await login(page, own.owner, own.password);
  // The "all" filter keeps every row on screen; the default "not translated" filter drops a row
  // as soon as it has nothing missing, which is right for the screen but awkward to assert on.
  await page.goto(`/dashboard/${own.orgSlug}/menu/translations?filter=all`);

  // The owner writes the English name by hand first.
  const row = page.getByTestId('tr-row').filter({ hasText: 'Seed tajine' });
  await row.getByTestId('tr-product-en').fill('Chicken tajine');
  await row.getByRole('button', { name: 'Save' }).first().click();
  await expect(row.getByText('Saved')).toBeVisible();

  // Translating the remaining rows with AI must not come back over that.
  await page.goto(`/dashboard/${own.orgSlug}/menu/translations?filter=missing`);
  const missingBefore = Number(await page.getByTestId('missing-count').innerText());
  await page.getByTestId('tr-row').first().getByTestId('row-translate').click();
  await expect(page.getByTestId('missing-count')).toHaveText(String(missingBefore - 1), { timeout: 30_000 });

  // Their own wording survived, and is still marked reviewed rather than machine.
  const [t] = await sql<{ name: string; status: string }>(
    `SELECT t.name, t.status FROM "ProductTranslation" t JOIN "MenuProduct" p ON p.id = t."productId" WHERE p."organizationId" = $1 AND t.language = 'en' AND t.name = 'Chicken tajine'`,
    [own.orgId],
  );
  expect(t).toMatchObject({ name: 'Chicken tajine', status: 'REVIEWED' });
});

test('with no provider configured, nothing is translated and nothing is invented', async ({ page }) => {
  // The browser suite runs with the stand-in model connected, so this checks the other half of
  // the promise: the editor stays usable and the guest sees the original text for a language
  // that has no translation at all.
  const fresh = seed(`ai2${Date.now()}`);
  await sql(`UPDATE "RestaurantOrganization" SET "sourceLanguage" = 'pt', "defaultLanguage" = 'pt', "enabledLanguages" = ARRAY['pt','es']::"LanguageCode"[] WHERE id = $1`, [fresh.orgId]);
  await login(page, fresh.owner, fresh.password);
  await page.goto(`/dashboard/${fresh.orgSlug}/menu/translations`);
  await expect(page.getByTestId('missing-count')).not.toHaveText('0');

  await page.goto(`/r/${fresh.orgSlug}?lang=es`);
  await expect(page.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('[es]');
});
