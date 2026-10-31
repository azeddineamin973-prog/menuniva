import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

/**
 * Real user journeys for the UX audit, at phone, tablet and desktop sizes, against the isolated
 * audit server. Each journey fails on browser console errors or failed requests.
 */
const seed = JSON.parse(readFileSync(path.resolve(__dirname, 'out/seed.json'), 'utf8'));
const SHOTS = path.resolve(__dirname, '../artifacts/ux/journeys');
const PHONE: BrowserContextOptions = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const SMALL: BrowserContextOptions = { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true };
const TABLET: BrowserContextOptions = { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true };
const org = `/dashboard/${seed.slug}`;

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 160)}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${new URL(r.url()).pathname}`));
  return problems;
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}
async function staff(browser: Browser, email: string, opts: BrowserContextOptions = PHONE) {
  const ctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:3300' });
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto('/login');
  await page.getByTestId('login-form').locator('input[name=email]').fill(email);
  await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { page, problems, close: () => ctx.close() };
}
async function noSideScroll(page: Page, width: number, label: string) {
  const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));
  expect(w, `${label}: page is ${w - width}px wider than the ${width}px screen`).toBeLessThanOrEqual(width + 1);
}

test('guest at the table (375): sticky bars, category jump, search, dish with options, cart, order, call waiter', async ({ browser }) => {
  const ctx = await browser.newContext({ ...PHONE, baseURL: 'http://localhost:3300' });
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto(`/t/${seed.tables[1]}`);
  await noSideScroll(page, 375, 'table menu');

  // Jump to a category: the heading lands below the sticky table banner + chips, and its chip is active.
  await page.getByRole('navigation', { name: /menu/i }).getByRole('link', { name: 'Sobremesas' }).click();
  await page.waitForTimeout(600);
  const banner = await page.getByTestId('table-banner').boundingBox();
  const heading = await page.getByRole('heading', { name: 'Sobremesas' }).boundingBox();
  expect(heading!.y).toBeGreaterThan(banner!.y + banner!.height);
  await expect(page.getByRole('link', { name: 'Sobremesas' })).toHaveAttribute('aria-current', 'true');
  await shot(page, 'guest-table-jump');

  // Search with and without accents.
  await page.getByTestId('menu-search').fill('cha de menta');
  await expect(page.getByTestId('customer-product')).toHaveCount(1);
  await page.getByTestId('menu-search-clear').click();

  // Dish with a required side and extras; visible close button works; then add for real.
  await page.getByTestId('customer-product').filter({ hasText: 'Tajine de frango' }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('sheet-close')).toBeVisible();
  await sheet.getByTestId('sheet-close').click();
  await expect(sheet).toHaveCount(0);
  await page.getByTestId('customer-product').filter({ hasText: 'Tajine de frango' }).first().click();
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); // required side not chosen
  await page.getByRole('dialog').getByText('Cuscuz', { exact: true }).click();
  await page.getByRole('dialog').getByText('Harissa picante').click();
  await page.getByRole('dialog').getByRole('button', { name: '+' }).click();
  await shot(page, 'guest-dish-sheet');
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByTestId('view-cart')).toContainText('2');

  await page.getByTestId('view-cart').click();
  const cart = page.getByTestId('cart-sheet');
  await expect(cart.getByTestId('cart-line')).toHaveCount(1);
  await expect(page.getByTestId('cart-total')).not.toHaveText('…');
  await cart.getByRole('button', { name: '−' }).click();
  await noSideScroll(page, 375, 'cart');
  await shot(page, 'guest-cart');
  await page.getByTestId('submit-order').click();
  await expect(page).toHaveURL(/\/o\//);
  await expect(page.getByTestId('order-status')).toBeVisible();
  await noSideScroll(page, 375, 'order tracking');

  // Back on the menu: call the waiter.
  await page.goto(`/t/${seed.tables[1]}`);
  await page.getByTestId('call-waiter').click();
  await expect(page.getByRole('status').filter({ hasText: /notificado|notified/i })).toBeVisible();
  expect(problems).toEqual([]);
  await ctx.close();
});

test('guest at the table (320, Arabic): banner wraps without covering the category bar; name truncates correctly', async ({ browser }) => {
  const ctx = await browser.newContext({ ...SMALL, baseURL: 'http://localhost:3300' });
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto(`/t/${seed.tables[2]}?lang=ar`);
  await noSideScroll(page, 320, 'arabic menu');
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(400);
  const banner = await page.getByTestId('table-banner').boundingBox();
  const chips = await page.getByRole('navigation', { name: /القائمة|menu/i }).boundingBox();
  expect(chips!.y, 'category bar starts below the banner').toBeGreaterThanOrEqual(banner!.y + banner!.height - 1);
  const title = await page.locator('header h1').evaluate((h) => ({ dir: getComputedStyle(h).direction, text: h.textContent }));
  expect(title.dir).toBe('ltr'); // Latin name in an Arabic page keeps its start visible
  await shot(page, 'guest-arabic-320');
  expect(problems).toEqual([]);
  await ctx.close();
});

test('guest takeaway (390) and delivery (430): checkout fields, zones, totals from the server, tracking', async ({ browser }) => {
  for (const [mode, width] of [['pickup', 390], ['delivery', 430]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, baseURL: 'http://localhost:3300' });
    const page = await ctx.newPage();
    const problems = watch(page);
    await page.goto(`/r/${seed.slug}`);
    await page.getByRole('link', { name: mode === 'pickup' ? 'Levantar no restaurante' : 'Entrega pelo restaurante' }).click();
    await expect(page).toHaveURL(new RegExp(`/order/${mode}`));
    await page.getByTestId('customer-product').filter({ hasText: 'Kefta' }).first().click();
    await page.getByTestId('add-to-cart').click();
    await page.getByTestId('view-cart').click();
    const fields = page.getByTestId('checkout-fields');
    await fields.getByPlaceholder(/nome/i).fill('Cliente Auditoria');
    await fields.getByPlaceholder(/telefone|phone/i).fill('+351 912 000 999');
    if (mode === 'delivery') {
      await fields.getByLabel(/rua e número|address/i).fill('Rua do Souto 50');
      await page.getByTestId('postal-input').fill('4710-001'); // outside every zone
      await expect(page.getByTestId('outside-zone')).toBeVisible();
      await page.getByTestId('postal-input').fill('4700-320');
      await expect(page.getByTestId('delivery-zone')).toContainText('Centro');
      await fields.getByLabel(/localidade|city/i).fill('Braga');
      await expect(page.getByTestId('delivery-fee')).toHaveText(/2,00/);
    }
    await noSideScroll(page, width, `${mode} cart`);
    await shot(page, `guest-${mode}-cart`);
    await expect(page.getByTestId('submit-order')).toBeEnabled();
    await page.getByTestId('submit-order').click();
    await expect(page).toHaveURL(/\/o\//);
    expect(problems, mode).toEqual([]);
    await ctx.close();
  }
});

test('guest reservation and feedback (375)', async ({ browser }) => {
  const ctx = await browser.newContext({ ...PHONE, baseURL: 'http://localhost:3300' });
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto(`/r/${seed.slug}/reserve`);
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' });
  await page.locator('input[type=date]').fill(tomorrow);
  await page.getByRole('button', { name: '15:00' }).click();
  await page.getByPlaceholder('Nome').fill('Reserva Auditoria');
  await page.getByPlaceholder('Telefone').fill('+351 913 111 222');
  await page.getByRole('button', { name: 'Pedir reserva' }).click();
  await expect(page).toHaveURL(/\/reservation\//);
  await expect(page.getByTestId('reservation-status')).toBeVisible();

  await page.goto(`/r/${seed.slug}/feedback`);
  await page.getByRole('button', { name: /4/ }).first().click();
  await page.getByRole('button', { name: 'Serviço' }).click();
  await page.getByRole('button', { name: 'Enviar opinião' }).click();
  await expect(page.getByRole('status').or(page.getByText(/obrigad/i)).first()).toBeVisible();
  expect(problems).toEqual([]);
  await ctx.close();
});

test('owner on a phone (375): bottom bar, drawer, status tabs, accept and cancel with a reason', async ({ browser }) => {
  const s = await staff(browser, seed.owner);
  const { page } = s;
  await page.goto(org);
  const bottom = page.getByTestId('bottom-nav');
  await expect(bottom).toBeVisible();
  await bottom.getByRole('link', { name: 'Orders' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByTestId('status-tabs')).toBeVisible();
  await noSideScroll(page, 375, 'live orders');

  // Only one column on a phone; tabs switch it.
  await page.getByTestId('status-tab-new').click();
  await expect(page.getByTestId('column-new')).toBeVisible();
  await expect(page.getByTestId('column-ready')).toBeHidden();
  const card = page.getByTestId('column-new').getByTestId('order-card').first();
  const number = await card.getAttribute('data-order-number');
  await card.getByTestId('action-ACCEPTED').click();
  await page.getByTestId('status-tab-accepted').click();
  await expect(page.getByTestId('column-accepted').locator(`[data-order-number="${number}"]`)).toBeVisible();

  // Cancel needs a reason in a real dialog (no browser prompt).
  const target = page.getByTestId('column-accepted').locator(`[data-order-number="${number}"]`);
  await target.getByTestId('action-CANCELLED').click();
  const dialog = page.getByTestId('cancel-order-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('confirm-cancel')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await target.getByTestId('action-CANCELLED').click();
  await dialog.getByTestId('cancel-reason').fill('Prato esgotado (auditoria)');
  await shot(page, 'owner-cancel-dialog');
  await dialog.getByTestId('confirm-cancel').click();
  await page.getByTestId('status-tab-done').click();
  await expect(page.getByTestId('column-done').locator(`[data-order-number="${number}"]`)).toContainText('Prato esgotado');

  // "More" opens the full navigation; Escape closes it and focus returns.
  await bottom.getByTestId('bottom-nav-more').click();
  await expect(page.locator('#mobile-nav')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-nav')).toHaveCount(0);
  await expect(bottom.getByTestId('bottom-nav-more')).toBeFocused();
  expect(s.problems).toEqual([]);
  await s.close();
});

test('owner on a phone (375): sold out, edit a dish with the sticky save bar, persists after reload', async ({ browser }) => {
  const s = await staff(browser, seed.owner);
  const { page } = s;
  await page.goto(`${org}/menu`);
  await noSideScroll(page, 375, 'menu');
  const row = page.getByTestId('menu-product').filter({ hasText: 'Hummus com pão pita' });
  await row.getByTestId('toggle-sold-out').click();
  await expect(row.getByText('Sold out', { exact: true }).first()).toBeVisible();
  await row.getByTestId('toggle-sold-out').click();
  await expect(row.getByTestId('toggle-sold-out')).toHaveText('Sold out');

  await page.goto(`${org}/menu/products/${seed.productIds.harira}`);
  await noSideScroll(page, 375, 'dish editor');
  const save = page.getByTestId('sticky-submit');
  await expect(save).toBeInViewport();
  await page.getByTestId('product-name-pt').fill('Harira tradicional da casa');
  await page.getByTestId('price-DINE_IN').fill('5,75');
  await save.getByRole('button', { name: 'Save dish' }).click();
  await expect(save.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(page.getByTestId('product-name-pt')).toHaveValue('Harira tradicional da casa');
  await expect(page.getByTestId('price-DINE_IN')).toHaveValue(/5[.,]75/);
  // Back to the original name for the next runs.
  await page.getByTestId('product-name-pt').fill('Harira tradicional');
  await save.getByRole('button', { name: 'Save dish' }).click();
  await expect(save.getByRole('status')).toContainText('Saved');
  expect(s.problems).toEqual([]);
  await s.close();
});

test('owner: promotion form shows only the fields for the chosen type; hours editor explains inheritance', async ({ browser }) => {
  const s = await staff(browser, seed.owner, { viewport: { width: 1440, height: 900 } });
  const { page } = s;
  await page.goto(`${org}/promotions`);
  const f = page.getByTestId('promotion-form');
  await expect(f.getByLabel('% off')).toBeVisible();
  await expect(f.getByLabel('€ off')).toBeHidden();
  await f.getByLabel('Type').selectOption('BUY_X_GET_Y');
  await expect(f.getByLabel('Buy X')).toBeVisible();
  await expect(f.getByLabel('% off')).toBeHidden();
  await f.getByLabel('Name shown to guests').fill('Auditoria 2×1 sobremesas');
  await f.getByLabel('Buy X').fill('1');
  await f.getByLabel('Get Y free').fill('1');
  await f.getByRole('button', { name: 'Create promotion' }).click();
  await expect(page.getByTestId('promotion').filter({ hasText: 'Auditoria 2×1 sobremesas' })).toBeVisible();

  await page.goto(`${org}/delivery`);
  const hours = page.getByTestId('hours-deliveryHours');
  await expect(hours.getByTestId('hours-empty-note')).toContainText('Using your opening hours');
  await expect(hours).toContainText('As opening hours');
  await hours.getByRole('button', { name: '+ Add hours' }).first().click();
  await expect(hours.getByTestId('hours-copy-all')).toBeVisible();
  await hours.getByTestId('hours-reset').click();
  await expect(hours.getByTestId('hours-empty-note')).toBeVisible();
  expect(s.problems).toEqual([]);
  await s.close();
});

test('desktop 1440: live order columns never overlap; Kanban fits without sideways scrolling', async ({ browser }) => {
  for (const width of [1024, 1280, 1440, 1920]) {
    const s = await staff(browser, seed.owner, { viewport: { width, height: 900 } });
    await s.page.goto(`${org}/orders`);
    await expect(s.page.getByTestId('column-new')).toBeVisible();
    const boxes = await s.page.locator('[data-testid^="column-"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        expect(overlap, `${width}px: columns ${i} and ${j} overlap`).toBe(false);
      }
    await noSideScroll(s.page, width, `live orders ${width}`);
    if (width === 1440) await shot(s.page, 'owner-orders-1440');
    expect(s.problems).toEqual([]);
    await s.close();
  }
});

test('kitchen tablet (768): start and finish a ticket; station name rendered by the server', async ({ browser }) => {
  const s = await staff(browser, seed.staff.KITCHEN_STAFF, TABLET);
  const { page } = s;
  await page.goto(`${org}/kitchen/${seed.kitchenStationId}`);
  await expect(page.getByRole('heading', { name: 'Cozinha principal' })).toBeVisible();
  const todo = page.getByTestId('kds-PENDING').getByTestId('kds-ticket');
  await expect(todo.first()).toBeVisible();
  const before = await todo.count();
  await todo.first().getByTestId('kds-start').click();
  await expect(todo).toHaveCount(before - 1);
  const preparing = page.getByTestId('kds-PREPARING').getByTestId('kds-ticket').first();
  await preparing.getByTestId('kds-ready').click();
  await expect(page.getByTestId('kds-READY').getByTestId('kds-ticket').first()).toBeVisible();
  await noSideScroll(page, 768, 'kds');
  await shot(page, 'kitchen-768');
  expect(s.problems).toEqual([]);
  await s.close();
});

test('waiter on a phone (375): table request → on my way → done; bill payment by amount', async ({ browser }) => {
  const s = await staff(browser, seed.staff.WAITER);
  const { page } = s;
  await page.goto(`${org}/tasks`);
  const requests = page.getByTestId('table-requests');
  await expect(requests).toBeVisible();
  await noSideScroll(page, 375, 'waiter requests');
  const first = requests.locator('li').first();
  if (await first.getByTestId('task-ack').count()) await first.getByTestId('task-ack').click();
  await requests.locator('li').first().getByTestId('task-done').click();

  // The table with an open, partly paid bill (seeded).
  const ids = JSON.parse(readFileSync(path.resolve(__dirname, 'out/ids.json'), 'utf8'));
  await page.goto(`${org}/bills/${ids.sessionId}`);
  await expect(page.getByTestId('bill-totals')).toBeVisible();
  const before = await page.getByTestId('bill-balance').innerText();
  await page.getByTestId('payment-form').getByLabel('…or an amount (€)').fill('1,00');
  await page.getByTestId('payment-form').getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('bill-balance')).not.toHaveText(before);
  await noSideScroll(page, 375, 'bill');
  expect(s.problems).toEqual([]);
  await s.close();
});
