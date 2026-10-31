import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

/**
 * Regression tests for the 2026-10-31 responsive / UX audit (audit/ux/UX_AUDIT_REPORT.md):
 * - Live Orders columns overlapped each other on 1280–1440 px laptops;
 * - phones: one status column at a time, bottom navigation, cancel reason in a real dialog;
 * - guest dish sheet: visible close button, Escape, focus back on the dish;
 * - promotion form shows only the fields of the chosen type;
 * - the dish editor's save bar stays reachable on a phone and changes persist.
 */
let s: Seed;
test.beforeAll(() => {
  s = seed(`ux${Date.now()}`);
});
const ORIGIN = { Origin: 'http://localhost:3100' };
async function guestOrder(request: APIRequestContext) {
  const r = await request.post('/api/public/orders/table', {
    headers: ORIGIN,
    data: { qrToken: s.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: s.plainDishId, quantity: 1, modifiers: [] }] },
  });
  expect(r.status()).toBe(201);
  return (await r.json()) as { orderNumber: number; trackingToken: string };
}
async function columnsOverlap(page: Page) {
  return page.locator('[data-testid^="column-"]').evaluateAll((els) => {
    const r = els.map((e) => e.getBoundingClientRect());
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right - 1 && r[j].left < r[i].right - 1 && r[i].top < r[j].bottom - 1 && r[j].top < r[i].bottom - 1) return `${i}/${j}`;
    return null;
  });
}

test('Live Orders: columns never overlap on laptop and desktop widths', async ({ page, request }) => {
  await guestOrder(request);
  await login(page, s.owner, s.password);
  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/dashboard/${s.orgSlug}/orders`);
    await expect(page.getByTestId('column-new').getByTestId('order-card').first()).toBeVisible();
    expect(await columnsOverlap(page), `${width}px`).toBeNull();
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(extra, `${width}px sideways scroll`).toBeLessThanOrEqual(1);
  }
});

test.describe('phone (375 × 812)', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('status tabs, bottom navigation and cancelling with a reason in a dialog', async ({ page, request, browser }) => {
    const order = await guestOrder(request);
    await login(page, s.owner, s.password);
    await page.goto(`/dashboard/${s.orgSlug}`);
    await page.getByTestId('bottom-nav').getByRole('link', { name: 'Orders' }).click();
    await expect(page).toHaveURL(/\/orders$/);

    await page.getByTestId('status-tab-new').click();
    await expect(page.getByTestId('column-new')).toBeVisible();
    await expect(page.getByTestId('column-done')).toBeHidden();
    const card = page.getByTestId('column-new').locator(`[data-order-number="${order.orderNumber}"]`);
    await card.getByTestId('action-CANCELLED').click();
    const dialog = page.getByTestId('cancel-order-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('cancel-reason')).toBeFocused();
    await expect(dialog.getByTestId('confirm-cancel')).toBeDisabled(); // a reason is required
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeVisible(); // nothing changed

    await card.getByTestId('action-CANCELLED').click();
    await dialog.getByTestId('cancel-reason').fill('Kitchen closed early');
    await dialog.getByTestId('confirm-cancel').click();
    await page.getByTestId('status-tab-done').click();
    await expect(page.getByTestId('column-done').locator(`[data-order-number="${order.orderNumber}"]`)).toContainText('Kitchen closed early');
    const [row] = await sql<{ status: string; cancelReason: string }>(`SELECT status, "cancelReason" FROM "Order" WHERE "organizationId" = $1 AND number = $2`, [s.orgId, order.orderNumber]);
    expect(row).toEqual({ status: 'CANCELLED', cancelReason: 'Kitchen closed early' });

    // The guest sees the reason on their tracking page.
    const guest = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await guest.goto(`/o/${order.trackingToken}`);
    await expect(guest.getByTestId('order-status')).toHaveAttribute('data-status', 'CANCELLED');
    await expect(guest.getByText('Kitchen closed early')).toBeVisible();
    await guest.close();

    // "More" opens the full navigation as a dialog; Escape closes it and focus returns.
    await page.getByTestId('bottom-nav-more').click();
    await expect(page.locator('#mobile-nav')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-nav')).toHaveCount(0);
    await expect(page.getByTestId('bottom-nav-more')).toBeFocused();
  });

  test('guest dish sheet has a visible close button; Escape closes it and focus returns to the dish', async ({ page }) => {
    await page.goto(`/t/${s.qrToken}`);
    const dish = page.getByTestId('customer-product').filter({ hasText: 'Seed tajine' });
    await dish.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByTestId('sheet-close')).toBeVisible();
    await sheet.getByTestId('sheet-close').click();
    await expect(sheet).toHaveCount(0);
    await expect(dish).toBeFocused();
    await dish.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('dish editor fits the phone, the save bar stays on screen, and the change persists', async ({ page }) => {
    await login(page, s.owner, s.password);
    await page.goto(`/dashboard/${s.orgSlug}/menu/products/${s.plainDishId}`);
    const widest = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));
    expect(widest).toBeLessThanOrEqual(376); // the language tabs once zoomed this page out to 532 px
    const bar = page.getByTestId('sticky-submit');
    await expect(bar).toBeInViewport();
    await page.getByTestId('price-TAKEAWAY').fill('6,40');
    await bar.getByRole('button', { name: 'Save dish' }).click();
    await expect(bar.getByRole('status')).toContainText('Saved');
    await page.reload();
    await expect(page.getByTestId('price-TAKEAWAY')).toHaveValue(/6[.,]40/);
  });
});

test('promotion form shows only the amount fields of the chosen type', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/promotions`);
  const f = page.getByTestId('promotion-form');
  await expect(f.getByLabel('% off')).toBeVisible();
  for (const hidden of ['€ off', 'Buy X', 'Get Y free', 'Combo €']) await expect(f.getByLabel(hidden)).toBeHidden();
  await f.getByLabel('Type').selectOption('BUY_X_GET_Y');
  await expect(f.getByLabel('Buy X')).toBeVisible();
  await expect(f.getByLabel('Get Y free')).toBeVisible();
  await expect(f.getByLabel('% off')).toBeHidden();
  await f.getByLabel('Type').selectOption('FIXED_AMOUNT');
  await expect(f.getByLabel('€ off')).toBeVisible();
  await expect(f.getByLabel('Buy X')).toBeHidden();
});
