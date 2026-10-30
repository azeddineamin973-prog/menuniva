import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

let s: Seed;
test.beforeAll(async () => {
  s = seed(`td${Date.now()}`);
  await sql(
    `UPDATE "RestaurantLocation" SET "takeawayEnabled" = true, "deliveryEnabled" = true, "whatsappOrderingEnabled" = true, "whatsappNumber" = '+351 900 000 001',
       "glovoUrl" = 'https://glovoapp.com/pt/en/braga/e2e-seed/', "uberEatsUrl" = 'https://www.ubereats.com/pt/store/e2e-seed', "instagramUrl" = 'https://www.instagram.com/e2e.seed' WHERE id = $1`,
    [s.locationId],
  );
});

async function addHarira(page: Page) {
  await page.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').click();
}

test('M9-01/03 + TEST 8 (browser): owner configures takeaway; guest orders for pickup; READY shows "ready for pickup"', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/takeaway`);
  const f = page.getByTestId('takeaway-settings-form');
  await f.getByLabel('Preparation lead time (min)').fill('15');
  await f.getByLabel('Minimum order (€)').fill('5,00');
  await f.getByRole('button', { name: 'Save' }).click();
  await expect(f.getByText('Saved')).toBeVisible();

  const guest = await browser.newPage();
  await guest.goto(`/r/${s.orgSlug}`);
  await guest.getByRole('link', { name: 'Levantar no restaurante' }).click();
  await expect(guest).toHaveURL(/\/order\/pickup/);
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Seed harira' })).toContainText('6,00'); // takeaway price
  await expect(guest.getByTestId('customer-product').filter({ hasText: 'Seed tajine' })).toHaveCount(0); // no takeaway price → not offered
  await addHarira(guest);
  await expect(guest.getByTestId('cart-total')).toHaveText('6,00 €');
  await guest.getByLabel('O seu nome').fill('E2E Pickup Guest');
  await guest.getByLabel('Telefone').fill('+351 911 111 111');
  await expect(guest.getByTestId('pickup-select')).toHaveValue('asap');
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);

  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  const card = page.getByTestId('column-new').getByTestId('order-card').filter({ hasText: 'E2E Pickup Guest' });
  await expect(card).toContainText('Takeaway');
  await expect(card).toContainText('+351 911 111 111');
  await card.getByTestId('action-ACCEPTED').click();
  await expect(page.getByTestId('column-accepted').getByTestId('order-card').filter({ hasText: 'E2E Pickup Guest' })).toHaveCount(1);
  const [o] = await sql<{ id: string }>(`SELECT id FROM "Order" WHERE "customerName" = 'E2E Pickup Guest'`);
  await sql(`UPDATE "KitchenTicket" SET status = 'READY' WHERE "orderId" = $1`, [o.id]);
  const ready = await page.request.post(`/api/dashboard/${s.orgSlug}/orders/${o.id}/status`, { headers: { Origin: 'http://localhost:3100' }, data: { to: 'READY', expectedFrom: 'ACCEPTED' } });
  expect(ready.status()).toBe(200);
  await guest.reload();
  await expect(guest.getByTestId('order-status')).toHaveText('Pronto para levantamento');
  await guest.close();
});

test('M9-04/06 + TEST 9/10 (browser): zone with fee; outside zone refused with pickup offered; delivery order placed', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/delivery`);
  const z = page.getByTestId('add-zone-form');
  await z.getByLabel('Zone name').fill('E2E centro');
  await z.getByLabel('Postal codes').fill('47000');
  await z.getByLabel('Fee (€)').fill('2,00');
  await z.getByRole('button', { name: 'Add zone' }).click();
  await expect(z.getByRole('alert')).toContainText('not a valid Portuguese');
  await z.getByLabel('Postal codes').fill('4700-*');
  await z.getByLabel('Free from (€)').fill('30,00');
  await z.getByRole('button', { name: 'Add zone' }).click();
  await expect(page.getByTestId('zone')).toHaveCount(1);

  const guest = await browser.newPage();
  await guest.goto(`/r/${s.orgSlug}/order/delivery`);
  await addHarira(guest);
  await guest.getByLabel('Nome do destinatário').fill('E2E Delivery Guest');
  await guest.getByLabel('Telefone').fill('+351 922 222 222');
  await guest.getByLabel('Rua e número').fill('Rua de Teste, 99');
  await guest.getByLabel('Localidade').fill('Braga');
  await guest.getByTestId('postal-input').fill('4900-001');
  await expect(guest.getByTestId('outside-zone')).toContainText('não entregamos');
  await expect(guest.getByTestId('outside-zone').getByRole('link', { name: 'Optar por levantamento' })).toHaveAttribute('href', /\/order\/pickup/);
  await expect(guest.getByTestId('submit-order')).toBeDisabled();
  await guest.getByTestId('postal-input').fill('4700123');
  await expect(guest.getByTestId('delivery-fee')).toHaveText('2,00 €');
  await expect(guest.getByTestId('cart-total')).toHaveText('9,00 €'); // 7,00 delivery price + 2,00 fee, from the server
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);
  const [o] = await sql<{ totalCents: number; deliveryFeeCents: number; postalCode: string }>(
    `SELECT o."totalCents", o."deliveryFeeCents", d."postalCode" FROM "Order" o JOIN "DeliveryOrderDetails" d ON d."orderId" = o.id WHERE o."customerName" = 'E2E Delivery Guest'`,
  );
  expect(o).toEqual({ totalCents: 900, deliveryFeeCents: 200, postalCode: '4700-123' });
  await guest.close();
});

test('M9-07/08/11: owner assigns the driver; driver takes it out and delivers with cash collected', async ({ page, browser }) => {
  const [o] = await sql<{ id: string }>(`SELECT id FROM "Order" WHERE "customerName" = 'E2E Delivery Guest'`);
  await login(page, s.owner, s.password);
  const acc = await page.request.post(`/api/dashboard/${s.orgSlug}/orders/${o.id}/status`, { headers: { Origin: 'http://localhost:3100' }, data: { to: 'ACCEPTED', expectedFrom: 'NEW' } });
  expect(acc.status()).toBe(200);
  await sql(`UPDATE "KitchenTicket" SET status = 'READY' WHERE "orderId" = $1`, [o.id]);
  await page.request.post(`/api/dashboard/${s.orgSlug}/orders/${o.id}/status`, { headers: { Origin: 'http://localhost:3100' }, data: { to: 'READY', expectedFrom: 'ACCEPTED' } });
  await page.goto(`/dashboard/${s.orgSlug}/delivery`);
  const row = page.getByTestId('active-delivery').filter({ hasText: 'Rua de Teste, 99' });
  await row.getByTestId('driver-select').selectOption({ label: 'E2E driver (delivery staff)' });
  await row.getByRole('button', { name: 'Assign' }).click();
  await expect(row.getByText('Saved')).toBeVisible();

  const driverCtx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const driver = await driverCtx.newPage();
  await login(driver, s.driver, s.password);
  await driver.goto(`/dashboard/${s.orgSlug}`);
  await expect(driver).toHaveURL(/\/driver$/);
  const card = driver.getByTestId('driver-order');
  await expect(card).toContainText('Rua de Teste, 99');
  await expect(card.getByRole('link', { name: /Open in maps/ })).toHaveAttribute('href', /google\.com\/maps\/search/);
  await card.getByTestId('driver-out').getByRole('button').click();
  await expect(card.getByTestId('driver-delivered')).toBeVisible();
  await card.getByTestId('driver-delivered').getByLabel(/Cash collected/).check();
  await card.getByTestId('driver-delivered').getByRole('button').click();
  await expect(card).toContainText('delivered');
  const [after] = await sql<{ status: string; paymentStatus: string }>(`SELECT status, "paymentStatus" FROM "Order" WHERE id = $1`, [o.id]);
  expect(after).toEqual({ status: 'DELIVERED', paymentStatus: 'PAID' });
  // The driver cannot open management screens
  await driver.goto(`/dashboard/${s.orgSlug}/delivery`);
  await expect(driver.getByText("You don't have access to this section")).toBeVisible();
  await driverCtx.close();
});

test('audit BUG-04: a pickup order without name/phone asks for the field, never claims that prices changed', async ({ page }) => {
  await page.goto(`/r/${s.orgSlug}/order/pickup`);
  await addHarira(page);
  const resp = page.waitForResponse((r) => r.url().endsWith('/api/public/orders/pickup'));
  await page.getByTestId('submit-order').click();
  expect((await (await resp).json()).error).toBe('validation_failed');
  const alert = page.getByTestId('cart-sheet').getByRole('alert').last();
  await expect(alert).toHaveText('Este campo é obrigatório.');
  await expect(page.getByTestId('cart-sheet')).not.toContainText('preços foram alterados');
});

test('M9-09/10: WhatsApp prepares a message (nothing is stored or sent); external links on the storefront', async ({ page }) => {
  await page.goto(`/r/${s.orgSlug}`);
  await expect(page.getByRole('link', { name: /Pedir na Glovo/ })).toHaveAttribute('href', 'https://glovoapp.com/pt/en/braga/e2e-seed/');
  await expect(page.getByRole('link', { name: /Pedir na Uber Eats/ })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/e2e.seed');
  const before = (await sql<{ n: string }>(`SELECT count(*)::text AS n FROM "Order" WHERE "organizationId" = $1`, [s.orgId]))[0].n;
  await page.getByRole('link', { name: 'Pedir por WhatsApp' }).click();
  await expect(page).toHaveURL(/\/order\/whatsapp/);
  await addHarira(page);
  await expect(page.getByTestId('submit-order')).toHaveCount(0);
  await expect(page.getByTestId('cart-total')).toHaveText('6,00 €');
  const href = await page.getByTestId('whatsapp-send').getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/351900000001\?text=/);
  const text = decodeURIComponent(href!.split('text=')[1]).replace(/\u00a0/g, ' ');
  expect(text).toContain('1 × Seed harira');
  expect(text).toContain('Total estimado: 6,00 €');
  await expect(page.getByTestId('cart-sheet')).toContainText('só é enviado quando carregar em enviar');
  const after = (await sql<{ n: string }>(`SELECT count(*)::text AS n FROM "Order" WHERE "organizationId" = $1`, [s.orgId]))[0].n;
  expect(after).toBe(before);
});
