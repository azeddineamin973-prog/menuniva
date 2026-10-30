import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`bill${Date.now()}`);
});
const ORIGIN = { Origin: 'http://localhost:3100' };

test('M8: merged bill, reduce item with reason, split payments, receipt, ticket printing, close table', async ({ page, request }) => {
  for (const quantity of [1, 2]) {
    const r = await request.post('/api/public/orders/table', { headers: ORIGIN, data: { qrToken: s.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: s.plainDishId, quantity, modifiers: [] }] } });
    expect(r.status()).toBe(201);
  }
  await login(page, s.owner, s.password);

  // Ticket printing: accept the first order, then print the kitchen ticket
  const [first] = await sql<{ id: string }>(`SELECT id FROM "Order" WHERE "organizationId" = $1 ORDER BY number ASC LIMIT 1`, [s.orgId]);
  const acc = await page.request.post(`/api/dashboard/${s.orgSlug}/orders/${first.id}/status`, { headers: ORIGIN, data: { to: 'ACCEPTED', expectedFrom: 'NEW' } });
  expect(acc.status()).toBe(200);
  const [ticket] = await sql<{ id: string }>(`SELECT id FROM "KitchenTicket" WHERE "orderId" = $1`, [first.id]);
  const pdf = await page.request.get(`/api/dashboard/${s.orgSlug}/kds/tickets/${ticket.id}/pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.goto(`/dashboard/${s.orgSlug}/kitchen/tickets/${ticket.id}/print`);
  await expect(page.getByTestId('ticket')).toContainText('Mesa 07');
  await expect(page.getByTestId('ticket')).toContainText('1 × Seed harira');

  // Merged bill
  await page.goto(`/dashboard/${s.orgSlug}/bills`);
  await page.getByTestId('open-session').first().click();
  await expect(page.getByTestId('bill-total')).toHaveText('19,50 €');

  // Reduce the second order from 2 to 1 (owner only, reason required)
  const second = page.getByTestId('bill-item').filter({ hasText: '2 × Seed harira' });
  await second.getByText('Reduce or remove').click();
  await second.getByLabel('Reason (kept in the audit log)').fill('Guest ordered twice by mistake');
  await second.getByRole('button', { name: 'Apply change' }).click();
  await expect(page.getByTestId('bill-total')).toHaveText('13,00 €');

  // Split: guest A pays one item in cash, guest B pays the rest by card amount
  const form = page.getByTestId('payment-form');
  await form.locator('input[name=itemIds]').first().check();
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('bill-paid')).toHaveText('6,50 €');
  await expect(page.getByTestId('bill-balance')).toHaveText('6,50 €');
  await expect(page.getByTestId('bill-item').filter({ hasText: 'paid' })).toHaveCount(1); // only the item actually paid
  await page.getByTestId('payment-form').getByLabel('Method').selectOption('CARD_TERMINAL');
  await page.getByTestId('payment-form').getByLabel(/an amount/).fill('6,50');
  await page.getByTestId('payment-form').getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('bill-balance')).toHaveText('0,00 €');
  await expect(page.getByTestId('payment-row')).toHaveCount(2);

  // Receipt is clearly not an invoice
  const receiptUrl = page.url() + '/receipt';
  await page.goto(receiptUrl);
  await expect(page.getByTestId('not-invoice')).toContainText('NÃO É FATURA');
  await expect(page.getByTestId('receipt')).toContainText('13,00');

  // Close: orders still in progress block closing
  await page.goBack();
  await page.getByTestId('close-form').getByRole('button', { name: 'Close table' }).click();
  await expect(page.getByTestId('close-form').getByRole('alert')).toContainText('still being prepared');
  await sql(`UPDATE "Order" SET status = 'READY' WHERE "organizationId" = $1`, [s.orgId]);
  await page.getByTestId('close-form').getByRole('button', { name: 'Close table' }).click();
  await expect(page.getByText('This table was closed')).toBeVisible();
  const statuses = await sql<{ status: string }>(`SELECT status FROM "Order" WHERE "organizationId" = $1`, [s.orgId]);
  expect(statuses.every((o) => o.status === 'COMPLETED')).toBe(true);
  const audit = await sql<{ action: string }>(`SELECT action FROM "AuditLog" WHERE "organizationId" = $1 AND action IN ('order.item_quantity_reduced','payment.recorded','table.session_closed')`, [s.orgId]);
  expect(audit.map((a) => a.action).sort()).toEqual(['order.item_quantity_reduced', 'payment.recorded', 'payment.recorded', 'table.session_closed']);
});

test('M8-12: table code required — guest must wait for staff to open the table and enter the code', async ({ page, browser }) => {
  await sql(`UPDATE "RestaurantLocation" SET "tableCodeRequired" = true WHERE id = $1`, [s.locationId]);
  const guest = await browser.newPage();
  await guest.goto(`/t/${s.qrToken}`);
  await guest.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await guest.getByTestId('add-to-cart').click();
  await guest.getByTestId('view-cart').click();
  await expect(guest.getByTestId('table-code-input')).toBeVisible();
  await guest.getByTestId('submit-order').click();
  await expect(guest.getByTestId('cart-sheet').getByRole('alert')).toContainText('ainda não está aberta');

  await login(page, s.waiter, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/tables`);
  await page.getByTestId('open-table').click();
  const code = (await page.getByTestId('table-code').innerText()).replace(/\D/g, '');
  expect(code).toMatch(/^\d{4}$/);

  await guest.getByTestId('table-code-input').fill(code === '0000' ? '1111' : '0000');
  await guest.getByTestId('submit-order').click();
  await expect(guest.getByTestId('cart-sheet').getByRole('alert')).toContainText('não está correto');
  await guest.getByTestId('table-code-input').fill(code);
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);
  await sql(`UPDATE "RestaurantLocation" SET "tableCodeRequired" = false WHERE id = $1`, [s.locationId]);
  await guest.close();
});
