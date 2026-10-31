import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

/**
 * M13-08 mobile usability pass (small Android phone, 360 × 740) plus the 2026-10-31 UX audit:
 * - no page scrolls sideways or makes the phone zoom out. Measured against the SCREEN width:
 *   on a mobile browser a page wider than the screen enlarges `innerWidth` (the page is zoomed
 *   out), so comparing with `innerWidth` alone missed the dish editor and tax pages;
 * - every visible control on guest screens is at least 24 × 24 px (WCAG 2.2 target size, AA),
 *   and staff screens too (dashboard controls are 40 px+ on touch screens);
 * - guest form fields use 16 px text, so iOS Safari does not zoom into them on focus.
 */
const W = 360;
test.use({ viewport: { width: W, height: 740 }, isMobile: true, hasTouch: true });

let s: Seed;
test.beforeAll(() => {
  s = seed(`mb${Date.now()}`);
});

async function noSideScroll(page: Page, label: string) {
  const widest = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));
  expect(widest - W, `${label} is ${widest - W}px wider than the ${W}px screen`).toBeLessThanOrEqual(1);
}
async function tapTargets(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('a[href], button, [role=button], input:not([type=hidden]), select, textarea, summary')]
      // A checkbox wrapped in its <label> is tapped through the whole label.
      .map((el) => ({ el, r: (el.closest('label') && ['checkbox', 'radio'].includes((el as HTMLInputElement).type) ? el.closest('label')! : el).getBoundingClientRect() }))
      .filter(({ r, el }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.classList.contains('sr-only'))
      // Links inside a sentence are exempt (WCAG 2.5.8 inline exception).
      .filter(({ el }) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline' && (el.parentElement?.textContent?.trim().length ?? 0) > (el.textContent?.trim().length ?? 0) + 3))
      .filter(({ r }) => r.width < 24 || r.height < 24)
      .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small, `${label}: small tap targets`).toEqual([]);
}
async function noZoomingFields(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')]
      .filter((el) => (el as HTMLElement).offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute('name') ?? el.getAttribute('aria-label') ?? ''}] ${getComputedStyle(el).fontSize}`),
  );
  expect(small, `${label}: fields under 16 px make iOS zoom in`).toEqual([]);
}

test('M13-08: guest screens fit a 360 px phone with usable tap targets', async ({ page }) => {
  await page.goto(`/t/${s.qrToken}`);
  await noSideScroll(page, 'table menu');
  await tapTargets(page, 'table menu');
  await noZoomingFields(page, 'table menu');
  await page.getByTestId('customer-product').filter({ hasText: 'Seed tajine' }).click();
  await noSideScroll(page, 'dish sheet');
  await tapTargets(page, 'dish sheet');
  await noZoomingFields(page, 'dish sheet');
  await page.keyboard.press('Escape');
  await page.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').click();
  await noSideScroll(page, 'cart');
  await tapTargets(page, 'cart');
  await noZoomingFields(page, 'cart');
  await page.getByTestId('submit-order').click();
  await expect(page).toHaveURL(/\/o\//);
  await noSideScroll(page, 'order tracking');
  await tapTargets(page, 'order tracking');
  await page.goto(`/r/${s.orgSlug}`);
  await noSideScroll(page, 'storefront');
  await tapTargets(page, 'storefront');
  await page.goto(`/r/${s.orgSlug}/feedback`);
  await noSideScroll(page, 'feedback');
  await tapTargets(page, 'feedback');
  await noZoomingFields(page, 'feedback');
  await page.goto(`/t/${s.qrToken}?lang=ar`);
  await noSideScroll(page, 'Arabic (RTL) menu');
});

test('UX audit: the table banner may wrap, but the sticky category bar always sits below it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/t/${s.qrToken}?lang=fr`); // longest button labels
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  const banner = (await page.getByTestId('table-banner').boundingBox())!;
  const chips = (await page.getByRole('navigation', { name: /menu/i }).boundingBox())!;
  expect(chips.y).toBeGreaterThanOrEqual(banner.y + banner.height - 1);
});

/** Every page.tsx under dashboard/[org], with real IDs for the dynamic ones. */
async function staffPages(): Promise<string[]> {
  const DIR = path.resolve(__dirname, '../../src/app/dashboard/[org]');
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
  const [session] = await sql<{ id: string }>(`SELECT id FROM "TableSession" WHERE "organizationId" = $1 LIMIT 1`, [s.orgId]);
  const [station] = await sql<{ id: string }>(`SELECT id FROM "KitchenStation" WHERE "organizationId" = $1 LIMIT 1`, [s.orgId]);
  const [category] = await sql<{ id: string }>(`SELECT id FROM "MenuCategory" WHERE "organizationId" = $1 LIMIT 1`, [s.orgId]);
  const [ticket] = await sql<{ id: string }>(`SELECT t.id FROM "KitchenTicket" t JOIN "Order" o ON o.id = t."orderId" WHERE o."organizationId" = $1 LIMIT 1`, [s.orgId]);
  const ids: Record<string, string | undefined> = { id: undefined, sessionId: session?.id, stationId: station?.id, ticketId: ticket?.id, jobId: undefined };
  return walk(DIR)
    .filter((f) => f.endsWith('page.tsx'))
    .map((f) => path.relative(DIR, path.dirname(f)).split(path.sep).join('/'))
    .map((p) =>
      p
        .replace('products/[id]', `products/${s.dishId}`)
        .replace('categories/[id]', `categories/${category?.id}`)
        .replace(/\[(\w+)\]/g, (_, k) => ids[k] ?? '[missing]'),
    )
    .filter((p) => !p.includes('[missing]') && !p.includes('undefined'));
}

test('M13-08 + UX audit: every staff screen fits a 360 px phone without zooming out', async ({ page }) => {
  // The table order above leaves a session and a kitchen ticket for the bill and ticket pages.
  await page.goto(`/t/${s.qrToken}`);
  await page.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').click();
  await page.getByTestId('submit-order').click();
  await expect(page).toHaveURL(/\/o\//);
  const pages = await staffPages();
  expect(pages.length).toBeGreaterThan(30);
  await login(page, s.owner, s.password);
  for (const p of pages) {
    await page.goto(`/dashboard/${s.orgSlug}${p ? `/${p}` : ''}`);
    await noSideScroll(page, `/dashboard/…/${p}`);
    await tapTargets(page, `/dashboard/…/${p}`);
  }
});
