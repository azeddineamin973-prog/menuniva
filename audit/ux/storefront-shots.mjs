// Storefront redesign screenshots: menu, dish sheet, cart, ordering page, at device sizes.
//   node audit/ux/storefront-shots.mjs [run]   (audit server on :3300, seeded UX database)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const RUN = process.argv[2] ?? 'sf';
const BASE = 'http://localhost:3300';
const OUT = `audit/artifacts/ux/${RUN}`;
mkdirSync(OUT, { recursive: true });
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const browser = await chromium.launch({ channel: 'chrome' });
const report = [];
for (const [name, w, h] of [['320', 320, 640], ['375', 375, 812], ['390', 390, 844], ['768', 768, 1024], ['1024', 1024, 768], ['1440', 1440, 900]]) {
  const mobile = w < 800;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const check = async (label) => {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    report.push(`${name} ${label}: ${sw > w ? `OVERFLOW ${sw}` : 'ok'}`);
  };
  await page.goto(`${BASE}/r/${seed.slug}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}-menu.png` });
  await check('menu');
  await page.screenshot({ path: `${OUT}/${name}-menu-full.png`, fullPage: true });
  // Table QR page: ordering on, dish sheet and cart.
  await page.goto(`${BASE}/t/${seed.tables[0]}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}-table.png` });
  await check('table');
  const dish = page.getByTestId('customer-product').filter({ hasNotText: /Esgotado|Sold out/ }).first();
  await dish.click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}-dish.png` });
  await check('dish');
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').waitFor();
  await page.screenshot({ path: `${OUT}/${name}-cartbar.png` });
  await page.getByTestId('view-cart').click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}-cart.png` });
  await check('cart');
  await page.getByTestId('cart-close').click();
  // Pickup ordering page.
  await page.goto(`${BASE}/r/${seed.slug}/order/pickup`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}-pickup.png` });
  await check('pickup');
  await ctx.close();
}
await browser.close();
console.log(report.join('\n'));
