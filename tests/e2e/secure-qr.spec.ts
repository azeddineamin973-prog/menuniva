import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

/**
 * Secure QR table ordering, end to end (QR-ORDERING-DESIGN.md option D): a closed table, "ask staff to
 * open", the waiter opens it and reads the PIN, phones enter it once, a copied QR cannot order, the
 * waiter approves and rejects, only the approved order reaches the kitchen, closing the table ends
 * every phone's authorisation. Fictitious restaurant in the TEST database. Screenshots go to
 * audit/restaurant-operations/qr-security/implementation/screenshots/.
 */
const SHOTS = 'audit/restaurant-operations/qr-security/implementation/screenshots';
mkdirSync(SHOTS, { recursive: true });
const ORIGIN = { Origin: 'http://localhost:3100' };
const PHONE = { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' };
let s: Seed;
test.beforeAll(async () => {
  s = seed(`sqr${Date.now()}`);
  await sql(`UPDATE "RestaurantLocation" SET "tableOrderingPolicy" = 'SESSION_PIN' WHERE id = $1`, [s.locationId]);
});

async function addHarira(p: Page) {
  await p.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await p.getByTestId('add-to-cart').click();
  await p.getByTestId('view-cart').click();
  await expect(p.getByTestId('cart-total')).toHaveText('6,50 €');
}
const orderBody = () => ({ qrToken: s.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: s.plainDishId, quantity: 1, modifiers: [] }] });

test('guest and waiter journey: closed table → open → PIN once → approve / reject → kitchen → close revokes', async ({ browser }) => {
  test.setTimeout(240_000);
  // ---- 1. A guest scans the QR of a table nobody opened: the menu works, ordering does not.
  const g1 = await browser.newContext(PHONE);
  const guest = await g1.newPage();
  await guest.goto(`/t/${s.qrToken}`);
  await expect(guest.getByTestId('table-access-banner')).toHaveAttribute('data-state', 'closed');
  await addHarira(guest);
  await expect(guest.getByTestId('table-closed-box')).toBeVisible();
  await expect(guest.getByTestId('submit-order')).toBeDisabled();
  await guest.getByTestId('ask-open-table').click();
  await expect(guest.getByTestId('open-table-notice')).toContainText('Avisámos');
  await guest.screenshot({ path: `${SHOTS}/01-guest-table-closed-ask-staff.png` });
  // A copied QR on a closed table: refused, nothing written.
  const remote = await browser.newContext();
  const r0 = await remote.request.post('/api/public/orders/table', { headers: ORIGIN, data: orderBody() });
  expect(r0.status()).toBe(422);
  expect((await r0.json()).error).toBe('table_not_open');

  // ---- 2. The waiter sees the request, opens the table and reads the PIN.
  const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const waiter = await staff.newPage();
  await login(waiter, s.waiter, s.password);
  await waiter.goto(`/dashboard/${s.orgSlug}/tables`);
  await expect(waiter.getByTestId('open-request')).toBeVisible();
  await waiter.getByTestId('open-table').click();
  await expect(waiter.getByTestId('table-pin-07')).toBeVisible();
  // The PIN is not in the page until asked for (and the request is audited).
  expect(await waiter.content()).not.toMatch(/data-testid="table-pin-07-value"/);
  await waiter.getByTestId('table-pin-07-show').click();
  const pin = (await waiter.getByTestId('table-pin-07-value').innerText()).trim();
  expect(pin).toMatch(/^\d{6}$/);
  await waiter.screenshot({ path: `${SHOTS}/02-waiter-tables-open-with-pin.png`, fullPage: true });
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "StaffTask" WHERE type = 'OPEN_TABLE' AND status = 'DONE'`))[0].n).toBe(1);
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "TableSession" WHERE "pinCipher" LIKE '%' || $1 || '%'`, [pin]))[0].n).toBe(0);

  // ---- 3. A copied QR on the now open table still cannot order without the PIN.
  const r1 = await remote.request.post('/api/public/orders/table', { headers: ORIGIN, data: orderBody() });
  expect(r1.status()).toBe(422);
  expect((await r1.json()).error).toBe('pin_required');

  // ---- 4. The guest enters a wrong PIN, then the right one once, and the order is sent.
  await guest.reload();
  await expect(guest.getByTestId('table-access-banner')).toHaveAttribute('data-state', 'pin');
  await guest.getByTestId('view-cart').click();
  await expect(guest.getByTestId('table-pin-box')).toBeVisible();
  await guest.getByTestId('table-pin-input').fill(pin === '000000' ? '111111' : '000000');
  await guest.getByTestId('submit-order').click();
  await expect(guest.getByTestId('submit-error')).toContainText('PIN não está correto');
  await guest.getByTestId('table-pin-input').fill(pin);
  await guest.screenshot({ path: `${SHOTS}/03-guest-enters-pin-once.png` });
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);
  await expect(guest.getByTestId('order-status')).toContainText('aguardar');
  await guest.screenshot({ path: `${SHOTS}/04-guest-waiting-for-approval.png` });
  const cookies = await g1.cookies();
  const grant = cookies.find((c) => c.name === 'mn_tg');
  expect(grant?.httpOnly).toBe(true);
  expect(grant?.sameSite).toBe('Lax');
  // Order again from the same phone: no PIN asked.
  await guest.goto(`/t/${s.qrToken}`);
  await expect(guest.getByTestId('table-access-banner')).toHaveCount(0);

  // ---- 5. A second phone at the same table authorises itself with the same PIN.
  const g2 = await browser.newContext(PHONE);
  const guest2 = await g2.newPage();
  await guest2.goto(`/t/${s.qrToken}`);
  await addHarira(guest2);
  await guest2.getByTestId('table-pin-input').fill(pin);
  await guest2.getByTestId('submit-order').click();
  await expect(guest2).toHaveURL(/\/o\//);
  const tracking2 = guest2.url();

  // ---- 6. Live Orders: provenance on each card; approve one, reject the other.
  await waiter.goto(`/dashboard/${s.orgSlug}/orders`);
  const cards = waiter.getByTestId('column-new').getByTestId('order-card');
  await expect(cards).toHaveCount(2, { timeout: 15_000 });
  await expect(cards.first().getByTestId('order-provenance')).toBeVisible();
  await waiter.screenshot({ path: `${SHOTS}/05-waiter-live-orders-pending.png`, fullPage: true });
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "KitchenTicket" WHERE "organizationId" = $1`, [s.orgId]))[0].n).toBe(0);
  const [first, second] = await sql<{ id: string; number: number }>(`SELECT id, number FROM "Order" WHERE "organizationId" = $1 ORDER BY number`, [s.orgId]);
  await cards.filter({ hasText: `#${first.number}` }).getByTestId('action-ACCEPTED').click();
  await expect.poll(async () => (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "KitchenTicket" WHERE "orderId" = $1`, [first.id]))[0].n).toBe(1);
  await cards.filter({ hasText: `#${second.number}` }).getByTestId('action-CANCELLED').click();
  await waiter.getByTestId('quick-reasons').locator('button').first().click();
  await waiter.getByTestId('confirm-cancel').click();
  await expect.poll(async () => (await sql<{ status: string }>(`SELECT status FROM "Order" WHERE id = $1`, [second.id]))[0].status).toBe('CANCELLED');
  // Only the approved order reached the kitchen.
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "KitchenTicket" WHERE "organizationId" = $1`, [s.orgId]))[0].n).toBe(1);
  // The rejected guest is told.
  await guest2.goto(tracking2);
  await expect(guest2.getByTestId('order-confirmation')).toContainText(/Cancelado|Recusado|cancel/i);
  await guest2.screenshot({ path: `${SHOTS}/06-guest-order-rejected.png` });

  // ---- 7. The bill shows the seating's phones; staff close the table.
  const [session] = await sql<{ id: string }>(`SELECT id FROM "TableSession" WHERE "organizationId" = $1 AND status = 'OPEN'`, [s.orgId]);
  await waiter.goto(`/dashboard/${s.orgSlug}/bills/${session.id}`);
  await expect(waiter.getByTestId('session-device')).toHaveCount(2);
  await waiter.screenshot({ path: `${SHOTS}/07-waiter-bill-phones-and-pin.png`, fullPage: true });
  // The accepted order is cancelled for the test so the table can close without a balance.
  const cancel = await waiter.request.post(`/api/dashboard/${s.orgSlug}/orders/${first.id}/status`, { headers: ORIGIN, data: { to: 'CANCELLED', expectedFrom: 'ACCEPTED', reason: 'test: guests left' } });
  expect(cancel.ok()).toBe(true);
  await waiter.reload();
  await waiter.getByTestId('close-form').getByRole('button', { name: 'Close table' }).click();
  await expect.poll(async () => (await sql<{ status: string }>(`SELECT status FROM "TableSession" WHERE id = $1`, [session.id]))[0].status).toBe('CLOSED');
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "TableSessionDevice" WHERE "tableSessionId" = $1 AND "revokedAt" IS NULL`, [session.id]))[0].n).toBe(0);

  // ---- 8. The guests' phones can no longer order (from the table or from home), and the page says why.
  const after = await guest.request.post('/api/public/orders/table', { headers: ORIGIN, data: orderBody() });
  expect(after.status()).toBe(422);
  expect((await after.json()).error).toBe('session_ended');
  await guest.goto(`/t/${s.qrToken}`);
  await expect(guest.getByTestId('table-access-banner')).toHaveAttribute('data-state', 'closed');
  await expect(guest.getByTestId('table-access-banner')).toContainText('terminou');
  await guest.screenshot({ path: `${SHOTS}/08-former-guest-after-close.png` });
  // A tracking page never hands out an authorisation, and no secret is in its HTML.
  await guest.goto(tracking2);
  expect(await guest.content()).not.toContain(pin);

  // ---- 9. The waiter's tables page on a phone (responsive).
  const staffPhone = await browser.newContext(PHONE);
  const wp = await staffPhone.newPage();
  await login(wp, s.waiter, s.password);
  await wp.goto(`/dashboard/${s.orgSlug}/tables`);
  await expect(wp.getByTestId('open-table')).toBeVisible();
  await wp.screenshot({ path: `${SHOTS}/09-waiter-tables-mobile.png`, fullPage: true });

  for (const c of [g1, g2, remote, staff, staffPhone]) await c.close();
});

test('12 phones enter the PIN and order at the same moment: 12 orders, one seating, one bill', async ({ browser }) => {
  test.setTimeout(180_000);
  const t = seed(`sqr12${Date.now()}`);
  await sql(`UPDATE "RestaurantLocation" SET "tableOrderingPolicy" = 'SESSION_PIN' WHERE id = $1`, [t.locationId]);
  const staff = await browser.newContext();
  const waiter = await staff.newPage();
  await login(waiter, t.waiter, t.password);
  await waiter.goto(`/dashboard/${t.orgSlug}/tables`);
  await waiter.getByTestId('open-table').click();
  await waiter.getByTestId('table-pin-07-show').click();
  const pin = (await waiter.getByTestId('table-pin-07-value').innerText()).trim();
  const guests = await Promise.all(Array.from({ length: 12 }, () => browser.newContext(PHONE)));
  const pages = await Promise.all(guests.map((c) => c.newPage()));
  await Promise.all(pages.map((p) => p.goto(`/t/${t.qrToken}`)));
  for (const p of pages) {
    await p.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
    await p.getByTestId('add-to-cart').click();
    await p.getByTestId('view-cart').click();
    await p.getByTestId('table-pin-input').fill(pin);
  }
  await Promise.all(pages.map((p) => p.getByTestId('submit-order').click()));
  await Promise.all(pages.map((p) => expect(p).toHaveURL(/\/o\//)));
  const [n] = await sql<{ n: number; sessions: number; devices: number }>(`SELECT count(*)::int AS n, count(DISTINCT "tableSessionId")::int AS sessions, count(DISTINCT "tableSessionDeviceId")::int AS devices FROM "Order" WHERE "organizationId" = $1`, [t.orgId]);
  expect(n).toEqual({ n: 12, sessions: 1, devices: 12 });
  await Promise.all([...guests, staff].map((c) => c.close()));
});
