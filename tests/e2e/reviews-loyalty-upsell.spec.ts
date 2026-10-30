import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

let s: Seed;
const GOOGLE = 'https://g.page/r/e2e-test-review/review';
test.beforeAll(() => {
  s = seed(`rl${Date.now()}`);
});

test('M11 TEST 13 + 14 (browser): 1★ and 5★ get the same Google link; low rating alerts the manager; inbox workflow', async ({ page, browser }) => {
  await sql(`INSERT INTO "ReviewSettings" (id, "locationId", "googleReviewUrl") VALUES ('rs_' || $1, $1, $2) ON CONFLICT ("locationId") DO UPDATE SET "googleReviewUrl" = $2`, [s.locationId, GOOGLE]);
  const hrefs: (string | null)[] = [];
  for (const stars of [1, 5]) {
    const g = await browser.newPage();
    await g.goto(`/r/${s.orgSlug}/feedback?lang=en`);
    // The Google link is visible before rating and does not change afterwards.
    hrefs.push(await g.getByTestId('google-review-link').getAttribute('href'));
    await g.getByTestId(`star-${stars}`).click();
    if (stars === 1) {
      await g.getByRole('button', { name: 'Waiting time' }).click();
      await g.getByLabel('Tell us more').fill('E2E: food arrived cold');
      await g.getByTestId('follow-up').check();
      await g.getByLabel('Phone or email').fill('+351 900 000 013');
    }
    await g.getByTestId('feedback-submit').click();
    await expect(g.getByTestId('feedback-thanks')).toBeVisible();
    hrefs.push(await g.getByTestId('google-review-link').getAttribute('href'));
    await g.close();
  }
  expect(new Set(hrefs)).toEqual(new Set([GOOGLE]));

  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/reviews`);
  await expect(page.getByTestId('low-rating-alert')).toContainText('1 low-rating alert');
  await expect(page.getByTestId('feedback-row')).toHaveCount(2);
  const low = page.getByTestId('feedback-row').filter({ hasText: 'E2E: food arrived cold' });
  await expect(low.getByTestId('feedback-contact')).toContainText('+351 900 000 013');
  await low.getByTestId('feedback-note-input').fill('Called the guest and apologised.');
  await low.getByRole('button', { name: 'Add note' }).click();
  await expect(low.getByTestId('feedback-note')).toContainText('Called the guest');
  await low.getByTestId('fb-RESOLVED').click();
  await expect(low.getByTestId('feedback-status')).toHaveText('resolved');
  await expect(page.getByTestId('low-rating-alert')).toHaveCount(0);
  await expect(page.getByTestId('issues')).toContainText('Waiting time');
});

test('M11-09/10 (browser): a cart suggestion is shown politely, never auto-added, and counted', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/upsell`);
  const f = page.getByTestId('upsell-form');
  await f.getByTestId('upsell-trigger').selectOption({ label: 'Seed harira (Seed pratos)' });
  await f.getByTestId('upsell-suggested').selectOption({ label: 'Seed tajine (Seed pratos)' });
  await f.getByRole('button', { name: 'Add suggestion' }).click();
  await expect(page.getByTestId('upsell-rule')).toContainText('Seed harira → Seed tajine');

  const g = await browser.newPage();
  await g.goto(`/t/${s.qrToken}`);
  await g.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await g.getByTestId('add-to-cart').click();
  await g.getByTestId('view-cart').click();
  const box = g.getByTestId('upsell');
  await expect(box.getByTestId('upsell-item')).toContainText('Seed tajine');
  await expect(g.getByTestId('cart-line')).toHaveCount(1); // shown, not added
  await box.getByTestId('upsell-add').click();
  // Tajine has a required choice: the guest gets the dish sheet and decides; still nothing added.
  await expect(g.getByTestId('add-to-cart')).toBeVisible();
  await g.keyboard.press('Escape');
  await g.getByTestId('view-cart').click();
  await expect(g.getByTestId('cart-line')).toHaveCount(1);
  await g.getByTestId('upsell-dismiss').click();
  await expect(g.getByTestId('upsell')).toHaveCount(0);
  await expect
    .poll(async () => (await sql<{ eventType: string; n: number }>(`SELECT "eventType", count(*)::int AS n FROM "UpsellEvent" WHERE "organizationId" = $1 GROUP BY 1 ORDER BY 1`, [s.orgId])).map((r) => `${r.eventType}:${r.n}`).join(','))
    .toMatch(/^ACCEPTED:1,SHOWN:[12]$/);
  await g.close();
});

test('M11-06..08 (browser): owner sets up loyalty, guest joins voluntarily with consent, member listed and deletable', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/loyalty`);
  const f = page.getByTestId('loyalty-settings-form');
  await f.getByLabel('Loyalty programme on').check();
  await f.getByLabel('Needed for a reward').fill('5');
  await f.getByLabel('Reward', { exact: true }).fill('E2E free mint tea');
  await f.getByRole('button', { name: /Save/ }).click();
  await expect(f.getByText(/Saved/i)).toBeVisible();

  const g = await browser.newPage();
  await g.goto(`/t/${s.qrToken}`);
  await g.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await g.getByTestId('add-to-cart').click();
  await g.getByTestId('view-cart').click();
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  const card = g.getByTestId('loyalty-card');
  await expect(card).toHaveAttribute('data-joined', 'false');
  await expect(card).toContainText('E2E free mint tea');
  await expect(g.getByTestId('loyalty-consent')).not.toBeChecked();
  await expect(g.getByTestId('loyalty-marketing')).not.toBeChecked();
  await g.getByTestId('loyalty-phone').fill('+351 900 000 088');
  await g.getByTestId('loyalty-join').click();
  await expect(card.getByRole('alert')).toBeVisible(); // consent is required
  await g.getByTestId('loyalty-consent').check();
  await g.getByTestId('loyalty-join').click();
  await expect(card).toHaveAttribute('data-joined', 'true');
  await expect(g.getByTestId('loyalty-progress')).toContainText('0');
  await g.close();

  await page.reload();
  const row = page.getByTestId('member-row').filter({ hasText: '+351900000088' });
  await expect(row.getByTestId('member-balance')).toContainText('0 / 5');
  await expect(row).not.toContainText('marketing opt-in');
  page.once('dialog', (d) => d.accept());
  await row.getByTestId('member-delete').click();
  await expect(page.getByTestId('member-row')).toHaveCount(0);
  const [acc] = await sql<{ phone: string; deletedAt: Date | null }>(`SELECT phone, "deletedAt" FROM "LoyaltyAccount" WHERE "organizationId" = $1`, [s.orgId]);
  expect(acc.phone).not.toContain('900000088');
  expect(acc.deletedAt).not.toBeNull();
});
