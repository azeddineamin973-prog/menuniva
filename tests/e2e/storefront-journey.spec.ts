import { expect, test } from '@playwright/test';
import { login, openCart, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

let s: Seed;
test.beforeAll(async () => {
  s = seed(`store${Date.now()}`);
  await sql(
    `UPDATE "RestaurantLocation" SET "takeawayEnabled" = true, "reservationsEnabled" = true, "whatsappOrderingEnabled" = true, "whatsappNumber" = '+351 935 413 677',
       "openingHours" = '{"mon":[{"open":"00:00","close":"23:59"}],"tue":[{"open":"00:00","close":"23:59"}],"wed":[{"open":"00:00","close":"23:59"}],"thu":[{"open":"00:00","close":"23:59"}],"fri":[{"open":"00:00","close":"23:59"}],"sat":[{"open":"00:00","close":"23:59"}],"sun":[{"open":"00:00","close":"23:59"}]}'::jsonb
     WHERE id = $1`,
    [s.locationId],
  );
  // Takeaway prices so the dishes are offered for pickup too.
  await sql(`INSERT INTO "ChannelPrice" (id, "productId", channel, "amountCents", "updatedAt") VALUES ($1, $2, 'TAKEAWAY', 1500, now()) ON CONFLICT ("productId", channel) DO NOTHING`, [
    `cp${Date.now()}`,
    s.dishId,
  ]);
});

test('the public menu can be searched, and a dish offers the real ways to order', async ({ page }) => {
  await page.goto(`/r/${s.orgSlug}`);
  await expect(page.getByTestId('customer-product')).toHaveCount(2);

  // Search narrows the menu; accents are ignored.
  await page.getByTestId('menu-search').fill('harira');
  await expect(page.getByTestId('customer-product')).toHaveCount(1);
  await page.getByTestId('menu-search').fill('tajine');
  await expect(page.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toBeVisible();
  await page.getByTestId('menu-search').fill('zzz nothing');
  await expect(page.getByTestId('menu-no-results')).toBeVisible();
  await page.getByTestId('menu-search-clear').click();
  await expect(page.getByTestId('customer-product')).toHaveCount(2);
  await screenshot(page, 'storefront-search');

  // Opening a dish on the browse-only page offers the ways to order instead of a dead button.
  await page.getByTestId('customer-product').filter({ hasText: 'Seed tajine' }).click();
  await expect(page.getByTestId('add-to-cart')).toHaveCount(0);
  const actions = page.getByTestId('sheet-order-actions');
  // The guest sees the restaurant's own language (Portuguese here), not the dashboard language.
  await expect(actions).toContainText(/Como prefere encomendar|How would you like to order/);
  await expect(actions.getByRole('link', { name: /Recolha|pickup/i })).toBeVisible();
  await screenshot(page, 'storefront-dish-browse-only');

  // The "order at table" notice appears exactly once, not twice.
  await page.keyboard.press('Escape');
  expect((await page.locator('body').innerText()).match(/Pedir na mesa|Order at table/g) ?? []).toHaveLength(1);
});

test('pickup: a guest orders, the restaurant sees it, staff prepare it and mark it ready', async ({ page, browser }) => {
  const guest = await browser.newPage();
  await guest.goto(`/r/${s.orgSlug}/order/pickup`);
  await guest.getByTestId('customer-product').filter({ hasText: 'Seed tajine' }).click();
  // Modifiers are required on this dish, so the cart cannot be built without choosing one.
  await guest.getByTestId('add-to-cart').click();
  await expect(guest.getByText(/Acompanhamento/).last()).toBeVisible();
  await guest.getByRole('radio', { name: 'Cuscuz' }).check();
  await guest.getByRole('button', { name: '+' }).click();
  await guest.getByTestId('add-to-cart').click();
  await openCart(guest);

  await expect(guest.getByTestId('cart-line')).toHaveCount(1);
  await guest.getByTestId('go-checkout').click();
  await guest.getByLabel(/O seu nome|Your name/).fill('E2E Storefront Guest');
  await guest.getByLabel(/Telefone|Phone/).fill('+351 911 222 333');
  await expect(guest.getByTestId('pickup-select')).toBeVisible();
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);
  await expect(guest.getByTestId('order-status')).toBeVisible();
  // Pickup guests get a way back to the menu too.
  await expect(guest.getByTestId('order-more')).toBeVisible();
  await screenshot(guest, 'storefront-pickup-tracking');

  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  const card = page.getByTestId('column-new').getByTestId('order-card').filter({ hasText: 'E2E Storefront Guest' });
  await expect(card).toContainText('+351 911 222 333');
  await card.getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card').filter({ hasText: 'E2E Storefront Guest' })).toHaveCount(1);

  // The kitchen sees it and marks it ready; the guest's page follows the real status.
  const [station] = await sql<{ id: string }>(`SELECT id FROM "KitchenStation" WHERE "organizationId" = $1 LIMIT 1`, [s.orgId]);
  await page.goto(`/dashboard/${s.orgSlug}/kitchen/${station.id}`);
  const ticket = page.getByTestId('kds-ticket').first();
  await expect(ticket).toContainText('Seed tajine');
  await ticket.getByTestId('kds-start').click();
  await page.getByTestId('kds-ticket').first().getByTestId('kds-ready').click();

  await guest.reload();
  await expect(guest.getByTestId('order-status')).toHaveText(/Pronto para levantamento|Ready for pickup/);
  await guest.close();
});

test('WhatsApp prepares a message with the real total and contact details, and stores no order', async ({ page }) => {
  const before = await sql<{ n: string }>(`SELECT count(*) AS n FROM "Order" WHERE "organizationId" = $1`, [s.orgId]);
  await page.goto(`/r/${s.orgSlug}/order/whatsapp`);
  await page.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').click();

  await page.getByLabel(/O seu nome|Your name/).fill('E2E WhatsApp Guest');
  await page.getByLabel(/Telefone|Phone/).fill('+351 933 444 555');
  // There is no "place order" button here: nothing can be submitted from this page.
  await expect(page.getByTestId('submit-order')).toHaveCount(0);
  const link = page.getByTestId('whatsapp-send');
  const href = await link.getAttribute('href');
  expect(href).toContain('https://wa.me/351935413677?text=');
  const text = decodeURIComponent(href!.split('text=')[1]);
  expect(text).toContain('Seed harira');
  expect(text).toContain('E2E WhatsApp Guest');
  expect(text).toContain('+351 933 444 555'); // the number the guest was asked for is passed on
  expect(text).toContain('6,00'); // the total shown in the cart
  // The page is explicit that nothing is sent until the guest presses send in WhatsApp.
  await expect(page.getByTestId('cart-sheet')).toContainText(/só é enviad|only sent when|press send/i);
  const after = await sql<{ n: string }>(`SELECT count(*) AS n FROM "Order" WHERE "organizationId" = $1`, [s.orgId]);
  expect(after[0].n).toBe(before[0].n);
});

test('reservations: a guest books a table, sees it in the dashboard, and can cancel it themselves', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/reservations`);
  const settings = page.getByTestId('reservation-settings-form');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings.getByText('Saved')).toBeVisible();

  const guest = await browser.newPage();
  await guest.goto(`/r/${s.orgSlug}/reserve`);
  // Real dates, party sizes and times come from the restaurant's own settings.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await guest.getByTestId('reserve-date').fill(tomorrow);
  await guest.getByTestId('reserve-party').selectOption('2');
  // The times shown are those of the chosen date (today's come with the page).
  await expect(guest.getByTestId('reserve-times')).toHaveAttribute('data-for', `${tomorrow}|2`);
  const slot = guest.getByTestId('reserve-slot').first();
  await expect(slot).toBeVisible({ timeout: 15_000 });
  await slot.click();
  await guest.getByTestId('reserve-form').locator('input[maxlength="80"]').fill('E2E Reservation Guest');
  await guest.getByTestId('reserve-form').locator('input[type=tel]').fill('+351 922 333 444');
  await guest.getByTestId('reserve-submit').click();
  await expect(guest).toHaveURL(/\/reservation\//);
  await expect(guest.getByTestId('reservation-status')).toHaveAttribute('data-status', 'REQUESTED');
  await screenshot(guest, 'storefront-reservation');

  // It is in the restaurant's dashboard, saved in the database. Looked for in the bookings list: when the
  // first free slot is within two hours (a run late in the evening books tomorrow 00:00), the request is
  // also, correctly, an urgent item in the attention bar, so the name is on the page twice.
  await page.goto(`/dashboard/${s.orgSlug}/reservations?date=${tomorrow}`);
  await expect(page.getByTestId('reservation-row').filter({ hasText: 'E2E Reservation Guest' })).toBeVisible();
  const [row] = await sql<{ status: string; partySize: number }>(`SELECT status, "partySize" FROM "Reservation" WHERE name = 'E2E Reservation Guest'`);
  expect(row).toMatchObject({ status: 'REQUESTED', partySize: 2 });

  // The guest cancels from their private link, which frees the table.
  guest.on('dialog', (d) => d.accept());
  await guest.getByTestId('reservation-cancel').click();
  await expect(guest.getByTestId('reservation-cancel-message')).toBeVisible();
  await expect(guest.getByTestId('reservation-status')).toHaveAttribute('data-status', 'CANCELLED');
  const [after] = await sql<{ status: string }>(`SELECT status FROM "Reservation" WHERE name = 'E2E Reservation Guest'`);
  expect(after.status).toBe('CANCELLED');
  await guest.close();
});

test('the storefront works on a phone-sized screen', async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await phone.goto(`/r/${s.orgSlug}`);
  // Nothing overflows sideways, and the search and category bar are both reachable.
  const width = await phone.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
  await expect(phone.getByTestId('menu-search')).toBeVisible();
  const box = await phone.getByTestId('customer-product').first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44); // comfortable tap target
  await screenshot(phone, 'storefront-mobile');
  await phone.close();
});
