// Screenshots of the Phase 3 preview & sharing screens and the guest storefront on device sizes.
//   node audit/ux/preview-shots.mjs [run]   (audit server on :3300, seeded UX database)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const RUN = process.argv[2] ?? 'p3';
const BASE = 'http://localhost:3300';
const OUT = `audit/artifacts/ux/${RUN}/preview`;
mkdirSync(OUT, { recursive: true });
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const org = `/dashboard/${seed.slug}`;

const browser = await chromium.launch({ channel: 'chrome' });
async function signedIn(width, height, dark = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 800 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-form').locator('input[name=email]').fill(seed.owner);
  await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (dark) await ctx.addCookies([{ name: 'mn_theme', value: 'dark', url: BASE }]);
  return { ctx, page };
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const f = page.frameLocator('[data-testid=preview-frame]');
  await f.locator('[data-testid=storefront]').waitFor({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(600);
};
const report = [];

// Owner: preview page on desktop in all three device modes, Arabic, and on a phone.
{
  const { ctx, page } = await signedIn(1440, 1000);
  await page.goto(`${BASE}${org}/preview`);
  await settle(page);
  await page.screenshot({ path: `${OUT}/owner-preview-1440-phone.png` });
  for (const d of ['tablet', 'desktop']) {
    await page.getByTestId(`preview-device-${d}`).click();
    await settle(page);
    await page.screenshot({ path: `${OUT}/owner-preview-1440-${d}.png` });
  }
  await page.getByTestId('preview-device-phone').click();
  if (await page.getByTestId('preview-language').count()) {
    await page.getByTestId('preview-language').selectOption('ar');
    await settle(page);
    await page.screenshot({ path: `${OUT}/owner-preview-1440-ar.png` });
  }
  await page.goto(`${BASE}${org}`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('restaurant-link-card').scrollIntoViewIfNeeded();
  await page.getByTestId('restaurant-link-card').screenshot({ path: `${OUT}/owner-overview-link-card.png` });
  report.push(['owner overview link card', await page.getByTestId('restaurant-link-card').getAttribute('data-status')]);
  await ctx.close();
}
for (const [w, h] of [[375, 812], [768, 1024]]) {
  const { ctx, page } = await signedIn(w, h);
  await page.goto(`${BASE}${org}/preview`);
  await settle(page);
  await page.screenshot({ path: `${OUT}/owner-preview-${w}.png`, fullPage: true });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  report.push([`owner preview ${w}`, sw > w ? `OVERFLOW ${sw}` : 'ok']);
  await ctx.close();
}
{
  const { ctx, page } = await signedIn(1440, 1000, true);
  await page.goto(`${BASE}${org}/preview`);
  await settle(page);
  await page.screenshot({ path: `${OUT}/owner-preview-1440-dark.png` });
  await ctx.close();
}
// Draft restaurant (second tenant, unpublished) as its owner, and as a guest.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-form').locator('input[name=email]').fill(seed.newOwner);
  await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${BASE}/dashboard/${seed.secondSlug}/preview`);
  await settle(page);
  await page.screenshot({ path: `${OUT}/draft-owner-preview-1440.png` });
  await ctx.close();
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await guest.goto(`${BASE}/r/${seed.secondSlug}`);
  await guest.screenshot({ path: `${OUT}/draft-guest-390.png` });
  report.push(['draft guest sees not-published', (await guest.getByTestId('not-published').count()) === 1 ? 'ok' : 'FAIL']);
  await guest.close();
}
// Guest storefront on device sizes (iPhone SE/13, Android, tablet, desktop).
for (const [name, w, h] of [['iphone-se', 320, 568], ['iphone', 390, 844], ['android', 412, 915], ['ipad', 768, 1024], ['desktop', 1440, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 800 });
  await page.goto(`${BASE}/r/${seed.slug}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/guest-${name}-${w}.png` });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  // Open a dish (sheet) on phones.
  if (w < 800) {
    await page.getByTestId('customer-product').first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/guest-${name}-${w}-dish.png` });
  }
  report.push([`guest ${name} ${w}`, sw > w ? `OVERFLOW ${sw}` : 'ok']);
  await page.close();
}
await browser.close();
for (const r of report) console.log(r.join(' · '));
