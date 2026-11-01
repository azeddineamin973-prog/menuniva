import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`pr${Date.now()}`);
});

async function cartWithTwoHarira(page: Page) {
  await page.goto(`/t/${s.qrToken}`);
  await page.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
  await page.getByRole('button', { name: '+' }).click();
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('view-cart').click();
}

test('M10-01..04 + TEST 11 (browser): automatic 10 % and a promo code, savings shown, server totals stored', async ({ page, browser }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/promotions`);
  const f = page.getByTestId('promotion-form');
  await f.getByLabel('Name shown to guests').fill('E2E 10 %');
  await f.getByLabel('% off').fill('10');
  await f.getByRole('button', { name: 'Create promotion' }).click();
  await expect(page.getByTestId('promotion').filter({ hasText: 'E2E 10 %' })).toBeVisible();
  await f.getByLabel('Name shown to guests').fill('E2E code 2 €');
  await f.getByLabel('Type').selectOption('FIXED_AMOUNT');
  await f.getByLabel('€ off').fill('2,00');
  await f.getByLabel('Promo code').fill('e2epromo');
  await f.getByLabel('Priority (higher first)').fill('10');
  await f.getByRole('button', { name: 'Create promotion' }).click();
  await expect(page.getByTestId('promotion').filter({ hasText: 'code E2EPROMO' })).toBeVisible();

  const guest = await browser.newPage();
  await cartWithTwoHarira(guest);
  await expect(guest.getByTestId('discount-line')).toContainText('E2E 10 %');
  await expect(guest.getByTestId('cart-total')).toHaveText('11,70 €'); // 13,00 − 1,30
  await expect(guest.getByTestId('you-save')).toContainText('1,30');
  await guest.getByTestId('coupon-input').fill('WRONG');
  await guest.getByTestId('coupon-apply').click();
  await expect(guest.getByTestId('coupon-error')).toBeVisible();
  await guest.getByTestId('coupon-input').fill('e2epromo');
  await guest.getByTestId('coupon-apply').click();
  await expect(guest.getByTestId('discount-line')).toContainText('E2E code 2 €');
  await expect(guest.getByTestId('cart-total')).toHaveText('11,00 €'); // higher-priority code, not combined with 10 %
  await guest.getByTestId('submit-order').click();
  await expect(guest).toHaveURL(/\/o\//);
  await expect(guest.getByText('Desconto')).toBeVisible();
  const [o] = await sql<{ subtotalCents: number; discountCents: number; totalCents: number }>(`SELECT "subtotalCents", "discountCents", "totalCents" FROM "Order" WHERE "organizationId" = $1`, [s.orgId]);
  expect(o).toEqual({ subtotalCents: 1300, discountCents: 200, totalCents: 1100 });
  await guest.close();
});

test('M10-05..09 + TEST 12 (browser): guest requests, staff assign + confirm, double-booking refused, full slot unavailable', async ({ page, browser }) => {
  const hours = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '12:00', close: '22:00' }]])));
  await sql(`UPDATE "RestaurantLocation" SET "reservationsEnabled" = true WHERE id = $1`, [s.locationId]);
  await sql(`UPDATE "ReservationSettings" SET "bookableHours" = $2::jsonb, "maxCoversPerSlot" = 4, "maxPartySize" = 6 WHERE "locationId" = $1`, [s.locationId, hours]);
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });

  const book = async (name: string) => {
    const g = await browser.newPage();
    await g.goto(`/r/${s.orgSlug}`);
    await g.getByRole('link', { name: 'Reservar mesa' }).click();
    await g.getByTestId('reserve-date').fill(tomorrow);
    await g.getByTestId('reserve-party').selectOption('2');
    await expect(g.getByTestId('reserve-times')).toHaveAttribute('data-for', `${tomorrow}|2`);
    const slot = g.getByTestId('reserve-slot').filter({ hasText: '20:00' });
    await expect(slot).toBeVisible();
    return { g, slot, name };
  };

  for (const name of ['E2E Res A', 'E2E Res B']) {
    const { g, slot } = await book(name);
    await slot.click();
    await g.getByLabel('Nome').fill(name);
    await g.getByLabel('Telefone').fill('+351 933 333 333');
    await g.getByTestId('reserve-submit').click();
    await expect(g).toHaveURL(/\/reservation\//);
    await expect(g.getByTestId('reservation-status')).toHaveAttribute('data-status', 'REQUESTED');
    if (name === 'E2E Res A') {
      // Staff confirm the first reservation with table 07
      await login(page, s.owner, s.password);
      await page.goto(`/dashboard/${s.orgSlug}/reservations?date=${tomorrow}`);
      const row = page.getByTestId('reservation-row').filter({ hasText: 'E2E Res A' });
      await row.getByRole('button', { name: 'Assign table' }).click();
      await expect(row.getByTestId('assigned-table')).toHaveText('Table 07');
      await row.getByTestId('res-CONFIRMED').click();
      await expect(row.getByText('confirmed')).toBeVisible();
      await g.reload();
      await expect(g.getByTestId('reservation-status')).toHaveAttribute('data-status', 'CONFIRMED');
    }
    await g.close();
  }

  // Same table for the overlapping second reservation → refused
  await page.goto(`/dashboard/${s.orgSlug}/reservations?date=${tomorrow}`);
  const rowB = page.getByTestId('reservation-row').filter({ hasText: 'E2E Res B' });
  await rowB.getByRole('button', { name: 'Assign table' }).click();
  await expect(rowB.getByRole('alert')).toContainText('already booked');

  // 2 + 2 guests = capacity 4 → 20:00 is now full for another party of 2
  const { g, slot } = await book('E2E Res C');
  await expect(slot).toBeDisabled();
  await g.close();
});
