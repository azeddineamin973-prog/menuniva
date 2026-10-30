import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, seed, type Seed } from './helpers';

/**
 * M13-08 mobile usability pass at 360 × 740 (small Android phone):
 * - no page scrolls sideways (content wider than the screen);
 * - every visible button on guest screens is at least 24 × 24 px (WCAG 2.2 target size, AA).
 */
test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

let s: Seed;
test.beforeAll(() => {
  s = seed(`mb${Date.now()}`);
});

async function noSideScroll(page: Page, label: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(extra, `${label} is ${extra}px wider than the screen`).toBeLessThanOrEqual(1);
}
async function tapTargets(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role=button], input[type=checkbox], select')]
      // A checkbox wrapped in its <label> is tapped through the whole label.
      .map((el) => ({ el, r: (el.closest('label') ?? el).getBoundingClientRect() }))
      .filter(({ r, el }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter(({ r }) => r.width < 24 || r.height < 24)
      .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small, `${label}: small tap targets`).toEqual([]);
}

test('M13-08: guest screens fit a 360 px phone with usable tap targets', async ({ page }) => {
  await page.goto(`/t/${s.qrToken}`);
  await noSideScroll(page, 'table menu');
  await tapTargets(page, 'table menu');
  await page.getByTestId('customer-product').filter({ hasText: 'Seed tajine' }).click();
  await noSideScroll(page, 'dish sheet');
  await tapTargets(page, 'dish sheet');
  await page.keyboard.press('Escape');
  await page.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').click();
  await noSideScroll(page, 'cart');
  await tapTargets(page, 'cart');
  await page.getByTestId('submit-order').click();
  await expect(page).toHaveURL(/\/o\//);
  await noSideScroll(page, 'order tracking');
  await tapTargets(page, 'order tracking');
  await page.goto(`/r/${s.orgSlug}`);
  await noSideScroll(page, 'storefront');
  await page.goto(`/r/${s.orgSlug}/feedback`);
  await noSideScroll(page, 'feedback');
  await tapTargets(page, 'feedback');
  await page.goto(`/t/${s.qrToken}?lang=ar`);
  await noSideScroll(page, 'Arabic (RTL) menu');
});

test('M13-08: every staff screen fits a 360 px phone', async ({ page }) => {
  const DIR = path.resolve(__dirname, '../../src/app/dashboard/[org]');
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
  const pages = walk(DIR)
    .filter((f) => f.endsWith('page.tsx') && !/\[/.test(path.relative(DIR, f)))
    .map((f) => path.relative(DIR, path.dirname(f)).split(path.sep).join('/'));
  expect(pages.length).toBeGreaterThan(25);
  await login(page, s.owner, s.password);
  for (const p of pages) {
    await page.goto(`/dashboard/${s.orgSlug}${p ? `/${p}` : ''}`);
    await noSideScroll(page, `/dashboard/…/${p}`);
  }
});
