// Real-data UX sandbox only (port 3400): the Delivery → Zones tab on desktop and phone, with an
// address check. Reads only; adds or changes no zone.
//   node audit/ux/zones-shots.mjs <out-dir>
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'audit/ux/out/zones';
const base = 'http://localhost:3400';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
for (const size of [
  { name: 'desktop', viewport: { width: 1440, height: 1100 } },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]) {
  const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  const f = page.getByTestId('login-form');
  await f.locator('input[name=email]').fill('elatmhanianiq@gmail.com');
  await f.locator('input[name=password]').fill('sandbox-password-123');
  await f.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${base}/dashboard/huihugiy/delivery?tab=zones`);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  const t = page.getByTestId('zone-tester');
  await t.getByLabel('Postal code').fill('4715-050');
  await t.getByLabel('Town').fill('Braga');
  await t.getByRole('button', { name: 'Check' }).click();
  await page.getByTestId('zone-test-result').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${size.name}-zones.png`, fullPage: true });
  console.log('  ✓', size.name);
  await ctx.close();
}
await browser.close();
