// Real-data UX sandbox only (audit/ux/real-sandbox.mjs, port 3400). Uploads a cover photo
// through the dashboard's Branding page as the owner would, then captures the branding page, the
// restaurant page, the delivery menu and the footer on phone, tablet and desktop.
//   node audit/ux/cover-shots.mjs <out-dir> <image-file> [base-url]
//   node audit/ux/cover-shots.mjs <out-dir> --keep      (screenshots only, cover already set)
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'audit/ux/out/cover';
const image = process.argv[3];
const base = process.argv[4] ?? 'http://localhost:3400';
if (!base.includes('localhost:3400')) throw new Error('sandbox only');
const ORG = 'huihugiy';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const shot = async (page, name, full = false) => {
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log('  ✓', name);
};

// 1 — The owner sets the cover on Settings → Branding.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  const f = page.getByTestId('login-form');
  await f.locator('input[name=email]').fill('elatmhanianiq@gmail.com');
  await f.locator('input[name=password]').fill('sandbox-password-123');
  await f.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${base}/dashboard/${ORG}/settings/branding`);
  if (image && image !== '--keep') {
    await page.locator('#cover').setInputFiles(image);
    await shot(page, 'dashboard-branding-chosen');
    await page.getByTestId('branding-form').getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('branding-form').getByText('Saved').waitFor();
    await page.reload();
  }
  await shot(page, 'dashboard-branding');
  await ctx.close();
}

// 2 — What guests see.
const SIZES = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
];
for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, locale: 'pt-PT' });
  const page = await ctx.newPage();
  await page.goto(`${base}/r/${ORG}?lang=pt`);
  await shot(page, `${size.name}-home`);
  await page.getByTestId('storefront-footer').scrollIntoViewIfNeeded();
  await shot(page, `${size.name}-home-footer`);
  await page.goto(`${base}/r/${ORG}/order/delivery?lang=pt`);
  await shot(page, `${size.name}-order`);
  await page.getByTestId('storefront-footer').scrollIntoViewIfNeeded();
  await shot(page, `${size.name}-order-footer`);
  await ctx.close();
}
await browser.close();
