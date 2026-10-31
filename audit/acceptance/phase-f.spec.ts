import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, ORIGIN, PASSWORD, buildRestaurant, ensureSuperAdmin, evidence, fillWeekHours, login, runId, shot, sql } from './support';

/** PHASE F — other business flows in the browser on the DEMO database. Tests are independent. */
const ev = evidence('phase-f');
const FIX = path.resolve(__dirname, '../fixtures');

/** Each guest gets its own context and user agent (= a different phone). */
async function guest(browser: Browser) {
  const ctx = await browser.newContext({ userAgent: `AuditGuest/${runId()}${Math.random().toString(36).slice(2, 6)} Chrome` });
  return { ctx, page: await ctx.newPage() };
}
async function addToCart(p: Page, name: string, extra = 0) {
  await p.getByTestId('customer-product').filter({ hasText: name }).click();
  for (let i = 0; i < extra; i++) await p.getByRole('button', { name: '+' }).click();
  await p.getByTestId('add-to-cart').click();
}

/** Review step: every category without a station gets one (drinks → Café F, everything else → Cozinha F). */
async function chooseStations(page: Page) {
  const selects = page.getByTestId('import-station-select');
  for (let i = 0; i < (await selects.count()); i++) {
    const label = (await selects.nth(i).getAttribute('aria-label')) ?? '';
    await selects.nth(i).selectOption({ label: /bebida|drink/i.test(label) ? 'Café F' : 'Cozinha F' });
  }
  return selects.count();
}
const money = (s: string) => new RegExp(`^(€\\s?${s.replace(',', '[.,]')}|${s.replace(',', '[.,]')}\\s?€)$`);

test('TAKEAWAY: pickup time chosen, accepted, prepared on the KDS, ready, ticket printable, completed', async ({ page, browser }) => {
  const r = await buildRestaurant(page, { label: 'Takeaway', channels: ['Takeaway / pickup'], dishes: [{ cat: 0, name: 'Harira TK (audit)', dine: '6,50', takeaway: '6,00' }, { cat: 1, name: 'Chá TK (audit)', dine: '2,50', takeaway: '2,20' }] });
  await page.goto(`/dashboard/${r.slug}/takeaway`);
  const f = page.getByTestId('takeaway-settings-form');
  await f.getByLabel('Preparation lead time (min)').fill('20');
  await f.getByLabel('Minimum order (€)').fill('5,00');
  await f.getByLabel('Pickup point shown to guests').fill('Balcão da receção (audit)');
  await fillWeekHours(f, '00:05', '23:55');
  await f.getByRole('button', { name: 'Save' }).click();
  await expect(f.getByText('Saved')).toBeVisible();

  const g = await guest(browser);
  await g.page.goto(`/r/${r.slug}`);
  await g.page.getByRole('link', { name: 'Levantar no restaurante' }).click();
  await addToCart(g.page, 'Chá TK (audit)');
  await g.page.getByTestId('view-cart').click();
  await expect(g.page.getByTestId('cart-total')).toHaveText('2,20 €');
  await g.page.getByLabel('O seu nome').fill('Audit Pickup Guest');
  await g.page.getByLabel('Telefone').fill('+351 911 000 201');
  const minResp = g.page.waitForResponse((r) => r.url().endsWith('/api/public/orders/pickup'));
  await g.page.getByTestId('submit-order').click();
  const minR = await minResp;
  const minBody = await minR.json();
  await expect(g.page.getByTestId('cart-sheet').getByRole('alert')).toBeVisible(); // below the 5,00 € minimum
  const minMsg = { status: minR.status(), error: minBody.error, shown: await g.page.getByTestId('cart-sheet').getByRole('alert').innerText() };
  await g.page.keyboard.press('Escape');
  await addToCart(g.page, 'Harira TK (audit)');
  await g.page.getByTestId('view-cart').click();
  await expect(g.page.getByTestId('cart-total')).toHaveText('8,20 €');
  // Closing and reopening the cart empties name/phone. Submitting now shows which message the guest gets.
  const contactKept = await g.page.getByLabel('O seu nome').inputValue();
  const submitDisabledWithoutContact = await g.page.getByTestId('submit-order').isDisabled();
  const staleAlert = (await g.page.getByTestId('cart-sheet').getByRole('alert').allInnerTexts()).join(' | ');
  await g.page.getByLabel('O seu nome').fill('Audit Pickup Guest');
  await g.page.getByLabel('Telefone').fill('+351 911 000 201');
  const options = await g.page.getByTestId('pickup-select').locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent })));
  expect(options.length).toBeGreaterThan(1);
  const slot = options.find((o) => o.v !== 'asap')!;
  await g.page.getByTestId('pickup-select').selectOption(slot.v);
  await expect(g.page.getByTestId('checkout-pickup-point')).toContainText('Balcão da receção');
  await shot(g.page, 'f-takeaway-checkout');
  await g.page.getByTestId('submit-order').click();
  await expect(g.page).toHaveURL(/\/o\//);
  const [o] = await sql<{ id: string; channel: string; pickupAt: Date; totalCents: number; customerName: string }>(`SELECT id, channel, "pickupAt", "totalCents", "customerName" FROM "Order" WHERE "organizationId" = $1`, [r.orgId]);
  expect(o.channel).toBe('TAKEAWAY');
  expect(o.totalCents).toBe(820);

  await page.goto(`/dashboard/${r.slug}/orders`);
  const card = page.getByTestId('column-new').getByTestId('order-card');
  await expect(card).toContainText('Audit Pickup Guest');
  await card.getByTestId('action-ACCEPTED').click();
  for (const st of ['Cozinha F', 'Café F']) {
    await page.goto(`/dashboard/${r.slug}/kitchen`);
    await page.getByTestId('station-link').filter({ hasText: st }).click();
    if (st === 'Cozinha F') {
      const printHref = await page.getByTestId('kds-print').first().getAttribute('href');
      ev.add('takeaway-print-href', printHref);
    }
    await page.getByTestId('kds-ticket').getByTestId('kds-start').click();
    await page.getByTestId('kds-PREPARING').getByTestId('kds-ready').click();
    await expect(page.getByTestId('kds-READY').getByTestId('kds-ticket')).toHaveCount(1);
  }
  // PRINTER: browser print page + PDF for the kitchen ticket
  const [ticket] = await sql<{ id: string }>(`SELECT k.id FROM "KitchenTicket" k JOIN "KitchenStation" s ON s.id = k."stationId" WHERE k."orderId" = $1 AND s.name = 'Cozinha F'`, [o.id]);
  await page.goto(`/dashboard/${r.slug}/kitchen/tickets/${ticket.id}/print`);
  await expect(page.getByTestId('ticket')).toContainText('Harira TK (audit)');
  await expect(page.getByTestId('ticket')).not.toContainText('Chá TK');
  await shot(page, 'f-printer-ticket');
  const pdf = await page.request.get(`/api/dashboard/${r.slug}/kds/tickets/${ticket.id}/pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  await g.page.reload();
  await expect(g.page.getByTestId('order-status')).toHaveText('Pronto para levantamento');
  await shot(g.page, 'f-takeaway-ready');
  await page.goto(`/dashboard/${r.slug}/orders`);
  await page.getByTestId('column-ready').getByTestId('order-card').getByTestId('action-COMPLETED').click();
  await expect(page.getByTestId('column-done').getByTestId('order-card')).toHaveCount(1);
  const events = await sql<{ toStatus: string; actorType: string }>(`SELECT "toStatus", "actorType" FROM "OrderStatusEvent" WHERE "orderId" = $1 ORDER BY "createdAt"`, [o.id]);
  ev.add('takeaway', { minimumMessage: minMsg, contactKeptAfterReopen: contactKept, submitDisabledWithoutContact, alertShownAfterReopen: staleAlert, chosenSlot: slot, pickupAt: o.pickupAt, totalCents: o.totalCents, events, pdfBytes: (await pdf.body()).length });
  await g.ctx.close();
});

test('DELIVERY: postal-code zone and fee, unsupported address refused, driver invited, assigned, delivered with cash', async ({ page, browser }) => {
  const r = await buildRestaurant(page, { label: 'Delivery', channels: ['Restaurant delivery'], dishes: [{ cat: 0, name: 'Cuscuz DL (audit)', dine: '12,00', delivery: '13,50' }, { cat: 1, name: 'Chá DL (audit)', dine: '2,00', delivery: '2,40' }] });
  await page.goto(`/dashboard/${r.slug}/delivery`);
  const z = page.getByTestId('add-zone-form');
  await z.getByLabel('Zone name').fill('Braga centro (audit)');
  await z.getByLabel('Postal codes').fill('4700-*, 4710-*');
  await z.getByLabel('Fee (€)').fill('2,50');
  await z.getByLabel('Minimum (€)').fill('10,00');
  await z.getByRole('button', { name: 'Add zone' }).click();
  await expect(page.getByTestId('zone')).toHaveCount(1);

  // Driver joins through a real invitation link (no SMTP: the link is shown to the owner)
  await page.goto(`/dashboard/${r.slug}/staff`);
  const inv = page.getByTestId('invite-form');
  const driverEmail = `driver.${runId()}@audit.menuniva.invalid`;
  await inv.getByLabel('Email').fill(driverEmail);
  await inv.getByLabel('Role').selectOption('DELIVERY_STAFF');
  await inv.getByRole('button', { name: 'Create invitation' }).click();
  const link = (await page.getByTestId('generated-link').innerText()).trim();
  const dctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const driver = await dctx.newPage();
  await driver.goto(`/signup?next=${encodeURIComponent(new URL(link).pathname)}`);
  await driver.getByLabel(/Full name|Nome completo/).fill('Audit Driver');
  await driver.getByLabel('Email').fill(driverEmail);
  await driver.getByLabel(/^(Password|Palavra-passe)$/).fill(PASSWORD);
  await driver.getByRole('button', { name: /Create account|Criar conta/ }).click();
  await driver.waitForURL(/\/invite\/|\/onboarding|\/dashboard/);
  if (!/\/invite\//.test(driver.url())) await driver.goto(new URL(link).pathname);
  await driver.getByRole('button', { name: 'Accept invitation' }).click();
  await driver.waitForURL(/\/dashboard\//);

  const g = await guest(browser);
  await g.page.goto(`/r/${r.slug}/order/delivery`);
  await addToCart(g.page, 'Cuscuz DL (audit)');
  await g.page.getByTestId('view-cart').click();
  await g.page.getByLabel('Nome do destinatário').fill('Audit Delivery Guest');
  await g.page.getByLabel('Telefone').fill('+351 922 000 202');
  await g.page.getByLabel('Rua e número').fill('Rua da Entrega, 7');
  await g.page.getByLabel('Localidade').fill('Braga');
  await g.page.getByTestId('postal-input').fill('4900-001');
  await expect(g.page.getByTestId('outside-zone')).toBeVisible();
  await expect(g.page.getByTestId('submit-order')).toBeDisabled();
  await shot(g.page, 'f-delivery-outside-zone');
  // The server refuses it too (not only the button)
  const direct = await g.page.request.post('/api/public/orders/delivery', {
    headers: ORIGIN,
    data: { orgSlug: r.slug, locationSlug: (await sql<{ slug: string }>(`SELECT slug FROM "RestaurantLocation" WHERE id = $1`, [r.locationId]))[0].slug, idempotencyKey: crypto.randomUUID(), language: 'pt', items: [{ productId: (await sql<{ id: string }>(`SELECT p.id FROM "MenuProduct" p WHERE p."organizationId" = $1 ORDER BY p."createdAt" LIMIT 1`, [r.orgId]))[0].id, quantity: 1, modifiers: [] }], customerName: 'X', phone: '+351 922 000 203', address: 'Rua X, 1', postalCode: '4900-001', city: 'Viana', paymentMethod: 'CASH_ON_DELIVERY' },
  });
  const directBody = await direct.json();
  await g.page.getByTestId('postal-input').fill('4700-123');
  await expect(g.page.getByTestId('delivery-fee')).toHaveText('2,50 €');
  await expect(g.page.getByTestId('cart-total')).toHaveText('16,00 €'); // 13,50 delivery price + 2,50 fee
  await shot(g.page, 'f-delivery-fee');
  await g.page.getByTestId('submit-order').click();
  await expect(g.page).toHaveURL(/\/o\//);
  const [o] = await sql<{ id: string; totalCents: number; deliveryFeeCents: number; subtotalCents: number }>(`SELECT id, "totalCents", "deliveryFeeCents", "subtotalCents" FROM "Order" WHERE "organizationId" = $1`, [r.orgId]);
  expect(o).toMatchObject({ subtotalCents: 1350, deliveryFeeCents: 250, totalCents: 1600 });

  await page.goto(`/dashboard/${r.slug}/orders`);
  await page.getByTestId('column-new').getByTestId('order-card').getByTestId('action-ACCEPTED').click();
  await page.goto(`/dashboard/${r.slug}/kitchen`);
  await page.getByTestId('station-link').filter({ hasText: 'Cozinha F' }).click();
  await page.getByTestId('kds-ticket').getByTestId('kds-ready').click();
  await expect(page.getByTestId('kds-READY').getByTestId('kds-ticket')).toHaveCount(1);
  await page.goto(`/dashboard/${r.slug}/delivery`);
  const row = page.getByTestId('active-delivery').filter({ hasText: 'Rua da Entrega, 7' });
  await row.getByTestId('driver-select').selectOption({ label: 'Audit Driver (delivery staff)' });
  await row.getByRole('button', { name: 'Assign' }).click();
  await expect(row.getByText('Saved')).toBeVisible();
  await driver.goto(`/dashboard/${r.slug}`);
  await expect(driver).toHaveURL(/\/driver$/);
  const card = driver.getByTestId('driver-order');
  await expect(card).toContainText('Rua da Entrega, 7');
  await card.getByTestId('driver-out').getByRole('button').click();
  await card.getByTestId('driver-delivered').locator('input[name=cashCollected]').check();
  await card.getByTestId('driver-delivered').getByRole('button').click();
  await expect(card).toContainText('delivered');
  await shot(driver, 'f-driver-delivered');
  const [after] = await sql<{ status: string; paymentStatus: string; paidCents: number }>(`SELECT status, "paymentStatus", "paidCents" FROM "Order" WHERE id = $1`, [o.id]);
  expect(after).toEqual({ status: 'DELIVERED', paymentStatus: 'PAID', paidCents: 1600 });
  await g.page.reload();
  ev.add('delivery', { directOutsideZone: { status: direct.status(), body: directBody }, order: o, after, guestStatus: await g.page.getByTestId('order-status').innerText() });
  await dctx.close();
  await g.ctx.close();
});

test('PROMOTIONS: percentage, fixed, expired code, duplicate code, single-use code reused, 2×1', async ({ page, browser }) => {
  const r = await buildRestaurant(page, { label: 'Promo', channels: ['Order at table (QR codes)'], dishes: [{ cat: 0, name: 'Tajine PR (audit)', dine: '10,00' }, { cat: 1, name: 'Chá PR (audit)', dine: '2,00' }], tables: '1' });
  await page.goto(`/dashboard/${r.slug}/promotions`);
  const f = page.getByTestId('promotion-form');
  async function create(o: { name: string; type?: string; percent?: string; amount?: string; code: string; buy?: string; get?: string; cat?: string; starts?: string; ends?: string; codeUses?: string }) {
    await f.getByLabel('Name shown to guests').fill(o.name);
    await f.getByLabel('Type').selectOption(o.type ?? 'PERCENTAGE');
    if (o.percent) await f.getByLabel('% off').fill(o.percent);
    if (o.amount) await f.getByLabel('€ off').fill(o.amount);
    if (o.buy) await f.getByLabel('Buy X').fill(o.buy);
    if (o.get) await f.getByLabel('Get Y free').fill(o.get);
    if (o.cat) await f.getByRole('group', { name: /Categories/ }).getByLabel(o.cat, { exact: true }).check();
    if (o.starts) await f.getByLabel('Starts').fill(o.starts);
    if (o.ends) await f.getByLabel('Ends').fill(o.ends);
    if (o.codeUses) await f.getByLabel('Code uses').fill(o.codeUses);
    await f.getByLabel('Promo code').fill(o.code);
    await f.getByRole('button', { name: 'Create promotion' }).click();
    const result = f.getByRole('alert').or(page.getByTestId('promotion').filter({ hasText: o.name }));
    await expect(result.first()).toBeVisible();
    return (await f.getByRole('alert').count()) ? await f.getByRole('alert').first().innerText() : 'created';
  }
  const created: Record<string, string> = {};
  created.pct = await create({ name: 'Audit 10 %', percent: '10', code: 'AUDPCT' });
  created.fix = await create({ name: 'Audit 3 € off', type: 'FIXED_AMOUNT', amount: '3,00', code: 'AUDFIX' });
  created.expired = await create({ name: 'Audit expired', type: 'FIXED_AMOUNT', amount: '5,00', code: 'AUDOLD', starts: '2026-10-01T10:00', ends: '2026-10-15T10:00' });
  created.twoForOne = await create({ name: 'Audit chá 2×1', type: 'BUY_X_GET_Y', buy: '1', get: '1', cat: 'Bebidas', code: 'AUD2X1' });
  created.once = await create({ name: 'Audit single use', type: 'FIXED_AMOUNT', amount: '1,00', code: 'AUDONCE', codeUses: '1' });
  await page.reload();
  created.duplicate = await create({ name: 'Audit duplicate code', percent: '50', code: 'AUDPCT' });
  await shot(page, 'f-promotions-admin');
  const coupons = await sql<{ code: string; n: number }>(`SELECT code, count(*)::int AS n FROM "Coupon" WHERE "organizationId" = $1 GROUP BY code ORDER BY code`, [r.orgId]);
  expect(coupons.find((c) => c.code === 'AUDPCT')?.n).toBe(1);

  const results: Record<string, string> = {};
  const flashes: Record<string, boolean> = {};
  async function tryCode(code: string, submit = false) {
    const g = await guest(browser);
    await g.page.goto(r.tableHrefs[0]);
    await addToCart(g.page, 'Tajine PR (audit)');
    await addToCart(g.page, 'Chá PR (audit)', 1);
    await g.page.getByTestId('view-cart').click();
    await expect(g.page.getByTestId('cart-total')).toHaveText('14,00 €');
    await g.page.getByTestId('coupon-input').fill(code);
    // Wait for the server quote that carries the code: right after "Apply" the UI briefly shows
    // "invalid code" based on the previous quote (BUG found in run 3, see AUDIT_REPORT).
    const quoted = g.page.waitForResponse((r) => r.url().endsWith('/api/public/quote') && (r.request().postData() ?? '').includes(`"couponCode":"${code}"`));
    await g.page.getByTestId('coupon-apply').click();
    const flashedError = await g.page.getByTestId('coupon-error').isVisible();
    await quoted;
    await g.page.waitForTimeout(300);
    flashes[code] = flashedError;
    const out = ((await g.page.getByTestId('coupon-error').count()) ? `refused: ${await g.page.getByTestId('coupon-error').innerText()}` : `total ${await g.page.getByTestId('cart-total').innerText()}`).replace(/\u00a0/g, ' ');
    if (submit) {
      await g.page.getByTestId('submit-order').click();
      await expect(g.page).toHaveURL(/\/o\//);
    }
    await g.ctx.close();
    return out;
  }
  results.AUDPCT = await tryCode('AUDPCT');
  results.AUDFIX = await tryCode('AUDFIX');
  results.AUDOLD = await tryCode('AUDOLD');
  results.AUD2X1 = await tryCode('AUD2X1', true);
  results.AUDONCE_first = await tryCode('AUDONCE', true);
  results.AUDONCE_second = await tryCode('AUDONCE');
  expect(results.AUDPCT).toBe('total 12,60 €');
  expect(results.AUDFIX).toBe('total 11,00 €');
  expect(results.AUDOLD).toMatch(/^refused/);
  expect(results.AUD2X1).toBe('total 12,00 €');
  expect(results.AUDONCE_first).toBe('total 13,00 €');
  expect(results.AUDONCE_second).toMatch(/^refused/);
  const orders = await sql<{ subtotalCents: number; discountCents: number; totalCents: number; d: string }>(
    `SELECT o."subtotalCents", o."discountCents", o."totalCents", string_agg(d.description || ':' || d."amountCents", ',') AS d FROM "Order" o LEFT JOIN "OrderDiscount" d ON d."orderId" = o.id WHERE o."organizationId" = $1 GROUP BY o.id ORDER BY o.number`,
    [r.orgId],
  );
  expect(orders.map((o) => o.totalCents)).toEqual([1200, 1300]);
  const [tz] = await sql<{ endsAt: Date; tz: string }>(`SELECT p."endsAt", l."timeZone" AS tz FROM "Promotion" p JOIN "RestaurantLocation" l ON l."organizationId" = p."organizationId" WHERE p."organizationId" = $1 AND p.name = 'Audit expired'`, [r.orgId]);
  ev.add('promotions', { created, coupons, results, orders, invalidMessageFlashedBeforeQuote: flashes, expiredPromoEndsAtEnteredAs: '2026-10-15T10:00 (restaurant time)', storedEndsAtUtc: tz.endsAt, restaurantTimeZone: tz.tz });
});

test('RESERVATIONS: request, confirm with a table, conflicting booking refused, cancel', async ({ page, browser }) => {
  const r = await buildRestaurant(page, { label: 'Reserve', channels: ['Reservation requests'], dishes: [{ cat: 0, name: 'Prato RS (audit)', dine: '9,00' }], tables: '1-2' });
  await page.goto(`/dashboard/${r.slug}/reservations`);
  const s = page.getByTestId('reservation-settings-form');
  await fillWeekHours(s, '12:00', '22:00');
  await s.getByLabel('Max party size').fill('6');
  await s.getByLabel('Max guests at once').fill('4');
  await s.getByRole('button', { name: /Save/ }).click();
  await expect(s.getByText(/Saved/)).toBeVisible();
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
  const tokens: string[] = [];
  for (const name of ['Audit Res A', 'Audit Res B']) {
    const g = await guest(browser);
    await g.page.goto(`/r/${r.slug}`);
    await g.page.getByRole('link', { name: 'Reservar mesa' }).click();
    await g.page.getByTestId('reserve-date').fill(tomorrow);
    await g.page.getByTestId('reserve-party').selectOption('2');
    await g.page.getByTestId('reserve-slot').filter({ hasText: '20:00' }).click();
    await g.page.getByLabel('Nome').fill(name);
    await g.page.getByLabel('Telefone').fill('+351 933 000 204');
    await g.page.getByTestId('reserve-submit').click();
    await expect(g.page).toHaveURL(/\/reservation\//);
    await expect(g.page.getByTestId('reservation-status')).toHaveAttribute('data-status', 'REQUESTED');
    tokens.push(new URL(g.page.url()).pathname);
    await g.ctx.close();
  }
  await page.goto(`/dashboard/${r.slug}/reservations?date=${tomorrow}`);
  const rowA = page.getByTestId('reservation-row').filter({ hasText: 'Audit Res A' });
  await rowA.getByTestId('reservation-table').selectOption({ label: 'Table 01' });
  await rowA.getByRole('button', { name: 'Assign table' }).click();
  await expect(rowA.getByTestId('assigned-table')).toContainText('01');
  await rowA.getByTestId('res-CONFIRMED').click();
  await expect(rowA.getByText('confirmed')).toBeVisible();
  const rowB = page.getByTestId('reservation-row').filter({ hasText: 'Audit Res B' });
  await rowB.getByTestId('reservation-table').selectOption({ label: 'Table 01' }); // same table, overlapping time
  await rowB.getByRole('button', { name: 'Assign table' }).click();
  await expect(rowB.getByRole('alert')).toContainText('already booked');
  const conflictMsg = await rowB.getByRole('alert').innerText();
  await shot(page, 'f-reservations-conflict');
  // Capacity: 2 + 2 guests = 4 → 20:00 full for another party
  const g3 = await guest(browser);
  await g3.page.goto(`/r/${r.slug}/reserve`);
  await g3.page.getByTestId('reserve-date').fill(tomorrow);
  await g3.page.getByTestId('reserve-party').selectOption('2');
  await expect(g3.page.getByTestId('reserve-slot').filter({ hasText: '20:00' })).toBeDisabled();
  await g3.ctx.close();
  // Cancel A
  await rowA.getByTestId('res-CANCELLED').click();
  await expect(rowA.getByText('cancelled')).toBeVisible();
  const gA = await guest(browser);
  await gA.page.goto(tokens[0]);
  await expect(gA.page.getByTestId('reservation-status')).toHaveAttribute('data-status', 'CANCELLED');
  await gA.ctx.close();
  const rows = await sql<{ name: string; status: string; tables: number }>(`SELECT name, status, (SELECT count(*)::int FROM "ReservationTableAssignment" a WHERE a."reservationId" = r.id) AS tables FROM "Reservation" r WHERE "organizationId" = $1 ORDER BY name`, [r.orgId]);
  ev.add('reservations', { conflictMsg, rows });
});

test('MENU IMPORT: real CSV, XLSX and text PDF → review → publish; prices preserved', async ({ page, browser }) => {
  const r = await buildRestaurant(page, { label: 'Import', channels: ['Order at table (QR codes)'], dishes: [{ cat: 0, name: 'Prato existente (audit)', dine: '9,00' }], tables: '1' });
  await page.goto(`/dashboard/${r.slug}/import`);
  await page.getByTestId('new-import-form').getByRole('button', { name: 'Start a new import' }).click();
  await expect(page).toHaveURL(/\/import\/[a-z0-9]+$/);
  const form = page.getByTestId('add-source-form');
  const counts: Record<string, number> = {};
  for (const [type, file, mime] of [['CSV', 'menu.csv', 'text/csv'], ['XLSX', 'menu.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['PDF', 'menu.pdf', 'application/pdf']] as const) {
    await form.getByLabel('Source').selectOption(type);
    await form.locator('#file').setInputFiles({ name: file, mimeType: mime, buffer: readFileSync(path.join(FIX, file)) });
    await form.getByRole('button', { name: 'Read this source' }).click();
    await expect(page.getByTestId('import-source')).toHaveCount(Object.keys(counts).length + 1);
    counts[type] = await page.getByTestId('import-item').count();
  }
  const before = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "MenuProduct" WHERE "organizationId" = $1`, [r.orgId]);
  expect(before[0].n).toBe(1); // nothing is created before review + publish
  const items = await page.getByTestId('import-item').allInnerTexts();
  await shot(page, 'f-import-review');
  const publish = page.getByTestId('publish-import-form');
  const stationChoices = await chooseStations(page);
  await publish.getByLabel('Make dishes visible to guests now').check();
  await publish.getByLabel('I reviewed the items above.').check();
  await publish.getByRole('button', { name: /Publish \d+ new dishes/ }).click();
  await expect(page.getByTestId('publish-summary')).toBeVisible();
  const summary = await page.getByTestId('publish-summary').innerText();
  const prices = await sql<{ name: string; cents: number | null; status: string; station: string | null }>(
    `SELECT t.name, cp."amountCents" AS cents, p.status, coalesce(p."stationId", c."defaultStationId") AS station FROM "MenuProduct" p JOIN "ProductTranslation" t ON t."productId" = p.id JOIN "MenuCategory" c ON c.id = p."categoryId" LEFT JOIN "ChannelPrice" cp ON cp."productId" = p.id AND cp.channel = 'DINE_IN' WHERE p."organizationId" = $1 AND p.origin = 'IMPORTED' ORDER BY t.name`,
    [r.orgId],
  );
  const expected: Record<string, number> = { 'Harira CSV (audit)': 650, 'Cuscuz CSV (audit)': 1490, 'Chá CSV (audit)': 220, 'Briouats XLSX (audit)': 725, 'Pastilla XLSX (audit)': 1840, 'Zaalouk PDF (audit)': 580, 'Salada PDF (audit)': 490, 'Tajine PDF (audit)': 1560 };
  for (const [name, cents] of Object.entries(expected)) expect(prices.find((p) => p.name.startsWith(name.replace(' (audit)', '')))?.cents, name).toBe(cents);
  expect(prices.filter((p) => !p.station).map((p) => p.name)).toEqual([]); // GAP-01: every imported dish reaches a station
  const g = await guest(browser);
  await g.page.goto(r.tableHrefs[0]);
  await expect(g.page.getByTestId('customer-product').filter({ hasText: 'Pastilla XLSX' })).toContainText('18,40');
  await expect(g.page.getByTestId('customer-product').filter({ hasText: 'Tajine PDF' })).toContainText('15,60');
  await shot(g.page, 'f-import-guest-menu');
  await g.ctx.close();
  ev.add('import', { countsAfterEachSource: counts, items, summary, prices, stationChoices });
});

test('EXTERNAL IMPORT: Glovo / Uber Eats status, store link refused, merchant export kept as reference price', async ({ page }) => {
  const r = await buildRestaurant(page, { label: 'Glovo', channels: ['Order at table (QR codes)'], dishes: [{ cat: 0, name: 'Prato G (audit)', dine: '9,00' }] });
  await page.goto(`/dashboard/${r.slug}/import`);
  const status = { GLOVO: await page.getByTestId('adapter-GLOVO').innerText(), UBER_EATS: await page.getByTestId('adapter-UBER_EATS').innerText(), IMAGE: await page.getByTestId('adapter-IMAGE').innerText(), PDF: await page.getByTestId('adapter-PDF').innerText() };
  await shot(page, 'f-external-adapters');
  await page.getByTestId('new-import-form').getByRole('button', { name: 'Start a new import' }).click();
  const form = page.getByTestId('add-source-form');
  await form.getByLabel('Source').selectOption('GLOVO');
  await form.getByLabel('Store link (for reference)').fill('https://glovoapp.com/pt/en/braga/audit-demo/');
  await form.getByRole('button', { name: 'Read this source' }).click();
  const linkMsg = await form.getByRole('alert').innerText();
  await form.getByLabel('Source').selectOption('UBER_EATS');
  await form.getByLabel('Store link (for reference)').fill('https://www.ubereats.com/pt/store/audit-demo');
  await form.getByRole('button', { name: 'Read this source' }).click();
  const uberMsg = await form.getByRole('alert').innerText();
  await form.getByLabel('Source').selectOption('GLOVO');
  await form.getByLabel('Store link (for reference)').fill('');
  await form.locator('#file').setInputFiles({ name: 'glovo-export.csv', mimeType: 'text/csv', buffer: Buffer.from('Category,Name,Price\nGlovo pratos,Kefta Glovo (audit),11.90\n') });
  await form.getByRole('button', { name: 'Read this source' }).click();
  await expect(page.getByTestId('import-item')).toHaveCount(1);
  const publish = page.getByTestId('publish-import-form');
  await chooseStations(page);
  await publish.getByLabel('I reviewed the items above.').check();
  await publish.getByRole('button', { name: /Publish \d+ new dishes/ }).click();
  await expect(page.getByTestId('publish-summary')).toBeVisible();
  const [p] = await sql<{ status: string; inhouse: number | null; external: number | null; provider: string | null }>(
    `SELECT p.status, (SELECT "amountCents" FROM "ChannelPrice" WHERE "productId" = p.id AND channel = 'DINE_IN') AS inhouse, e."amountCents" AS external, e.provider FROM "MenuProduct" p LEFT JOIN "ExternalSourcePrice" e ON e."productId" = p.id WHERE p."organizationId" = $1 AND p.origin = 'IMPORTED'`,
    [r.orgId],
  );
  expect(p).toEqual({ status: 'DRAFT', inhouse: null, external: 1190, provider: 'GLOVO' });
  const conns = await sql(`SELECT provider, status FROM "IntegrationConnection" WHERE "organizationId" = $1`, [r.orgId]);
  ev.add('external-import', { adapterStatus: status, glovoLink: linkMsg, uberLink: uberMsg, publishedProduct: p, integrationConnections: conns });
});

test('TRANSLATION: which languages are human-approved and which need a provider', async ({ page }) => {
  const r = await buildRestaurant(page, { label: 'Translate', channels: ['Order at table (QR codes)'], dishes: [{ cat: 0, name: 'Sopa TR (audit)', dine: '5,00' }, { cat: 1, name: 'Sumo TR (audit)', dine: '3,00' }] });
  await page.goto(`/dashboard/${r.slug}/menu/translations`);
  const input = page.locator('[data-testid=tr-row][data-name="Sopa TR (audit)"]').getByTestId('tr-product-en');
  await input.fill('Soup TR (audit)');
  await input.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();
  await expect(input.locator('xpath=ancestor::form').getByText('Saved')).toBeVisible();
  await page.reload();
  const pageText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const bulk = await page.getByRole('button', { name: /translate/i }).allInnerTexts();
  await shot(page, 'f-translations');
  const rows = await sql<{ name: string; language: string; status: string }>(`SELECT t.name, t.language, t.status FROM "ProductTranslation" t JOIN "MenuProduct" p ON p.id = t."productId" WHERE p."organizationId" = $1 ORDER BY 1, 2`, [r.orgId]);
  ev.add('translation', { providerText: pageText.match(/(No translation provider[^.]*\.|provider[^.]{0,120}\.)/i)?.[0] ?? pageText.slice(0, 300), bulkButtons: bulk, rows, missingCount: await page.getByTestId('missing-count').innerText() });
});

test('SUBSCRIPTIONS: trial plan and limits, 31st table refused, upgrade requested, Super Admin approves, limit raised', async ({ page, browser }) => {
  const actx = await browser.newContext();
  const admin = await actx.newPage();
  await ensureSuperAdmin(admin);
  const r = await buildRestaurant(page, { label: 'Plan', channels: ['Order at table (QR codes)'], dishes: [{ cat: 0, name: 'Prato PL (audit)', dine: '8,00' }], tables: '1-30' });
  await page.goto(`/dashboard/${r.slug}/subscription`);
  const before = { plan: await page.getByTestId('sub-plan').innerText(), status: await page.getByTestId('sub-status').innerText(), tables: await page.getByTestId('limit-tables').innerText() };
  await page.goto(`/dashboard/${r.slug}/tables`);
  await page.getByTestId('create-tables-form').getByLabel('Table labels').fill('31');
  await page.getByTestId('create-tables-form').getByRole('button', { name: 'Create tables' }).click();
  const refused = await page.getByTestId('create-tables-form').getByRole('alert').innerText();
  expect(refused).toContain('30 tables');
  await page.goto(`/dashboard/${r.slug}/subscription`);
  const pf = page.getByTestId('plan-change-form');
  await pf.getByLabel('New plan').selectOption({ label: 'Growth' });
  await pf.getByRole('button', { name: 'Request plan change' }).click();
  await expect(page.getByTestId('pending-plan')).toContainText('Growth');
  await expect(page.getByTestId('sub-plan')).toHaveText('Starter');
  await shot(page, 'f-subscription-pending');
  await admin.goto(`/admin/tenants/${r.orgId}`);
  await expect(admin.getByTestId('admin-pending-plan')).toContainText('Growth');
  await shot(admin, 'f-admin-tenant-pending');
  await admin.getByTestId('apply-plan').click();
  await expect(admin.getByTestId('admin-pending-plan')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('sub-plan')).toHaveText('Growth');
  const after = { plan: await page.getByTestId('sub-plan').innerText(), tables: await page.getByTestId('limit-tables').innerText() };
  await page.goto(`/dashboard/${r.slug}/tables`);
  await page.getByTestId('create-tables-form').getByLabel('Table labels').fill('31');
  await page.getByTestId('create-tables-form').getByRole('button', { name: 'Create tables' }).click();
  await expect(page.getByTestId('table-card')).toHaveCount(31);
  const auditRows = await sql<{ action: string }>(`SELECT action FROM "AuditLog" WHERE "organizationId" = $1 AND action LIKE '%plan%' ORDER BY "createdAt"`, [r.orgId]);
  ev.add('subscriptions', { before, refused, after, auditRows, billing: 'manual only (no processor): no money is charged' });
  await actx.close();
});
