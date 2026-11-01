import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

/**
 * 2D table reservation. The owner arranges the restaurant's existing tables on a dining area
 * (drag, keyboard, seats, shape), saves it and lets guests choose; guests pick a free table on
 * the plan with their request (desktop and phone); a table taken meanwhile is never kept.
 */
let s: Seed;
let tomorrow: string;
test.beforeAll(async () => {
  s = seed(`fp${Date.now()}`);
  const hours = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '12:00', close: '23:00' }]])));
  await sql(`UPDATE "RestaurantLocation" SET "reservationsEnabled" = true WHERE id = $1`, [s.locationId]);
  await sql(`UPDATE "ReservationSettings" SET "bookableHours" = $2::jsonb, "maxCoversPerSlot" = 20, "maxPartySize" = 8 WHERE "locationId" = $1`, [s.locationId, hours]);
  // The restaurant's own tables (the seed's table 07 has no seat count: never offered online).
  for (const [label, seats] of [['A1', 2], ['A2', 4], ['A3', 6]] as const) {
    await sql(`INSERT INTO "RestaurantTable" (id, "organizationId", "locationId", label, seats) VALUES ($1, $2, $3, $4, $5)`, [`fp${Date.now()}${label}`, s.orgId, s.locationId, label, seats]);
  }
  tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
});

const table = (page: Page, label: string) => page.locator(`[data-testid=editor-table][data-table="${label}"]`);
const planTable = (page: Page, label: string) => page.locator(`[data-testid=plan-table][data-table="${label}"]`);
const pos = async (page: Page, label: string) => ({ x: Number(await table(page, label).getAttribute('data-x')), y: Number(await table(page, label).getAttribute('data-y')) });

test('owner: arranges the existing tables on a dining area, saves, and lets guests choose', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/tables`);
  await page.getByTestId('open-floor-plan').click();
  await expect(page).toHaveURL(/\/tables\/floor-plan$/);
  const editor = page.getByTestId('floor-plan-editor');
  await expect(editor.getByTestId('floor-plan-no-area')).toBeVisible();

  // A dining area; the new area opens at once, and only the restaurant's real tables are offered.
  await editor.getByLabel('New dining area name').fill('Sala');
  await editor.getByRole('button', { name: 'Add area' }).click();
  await expect(editor.getByTestId('editor-area').filter({ hasText: 'Sala' })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByTestId('place-table')).toHaveCount(4);
  for (const t of ['A1', 'A2', 'A3']) await editor.locator(`[data-testid=place-table][data-table="${t}"]`).click();
  await expect(editor.getByTestId('editor-table')).toHaveCount(3);
  await expect(editor.getByTestId('place-table')).toHaveCount(1); // 07 stays off the plan
  await expect(editor.getByTestId('unsaved')).toBeVisible();

  // Keyboard: arrows move the focused table by one grid step (10 plan units).
  const a1 = await pos(page, 'A1');
  await table(page, 'A1').focus();
  await expect(page.getByTestId('table-inspector')).toContainText('Table A1');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => pos(page, 'A1')).toEqual({ x: a1.x + 30, y: a1.y + 10 });

  // Drag: A2 follows the pointer (snapped to the grid).
  const a2 = await pos(page, 'A2');
  const box = (await table(page, 'A2').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  const moved = await pos(page, 'A2');
  expect(moved.x).toBeGreaterThan(a2.x + 40);
  expect(moved.y).toBeGreaterThan(a2.y + 100);
  expect(moved.x % 10).toBe(0);

  // Seats and shape of A3: a long table for 8, turned.
  await table(page, 'A3').focus();
  await page.getByTestId('inspector-seats').fill('8');
  await page.getByTestId('shape-RECTANGLE').click();
  await page.getByTestId('inspector-rotate').click();
  await expect(table(page, 'A3')).toHaveAttribute('aria-label', /Table A3, 8 seats, rectangle/);

  await editor.getByRole('button', { name: 'Save floor plan' }).click();
  await expect(editor.getByTestId('save-floor-plan').getByRole('status')).toHaveText('Saved');
  await expect(editor.getByTestId('unsaved')).toHaveCount(0);
  await screenshot(page, 'floor-plan-editor');

  // Saved: the plan is the same after a reload, and in the database.
  const before = { a1: await pos(page, 'A1'), a2: await pos(page, 'A2'), a3: await pos(page, 'A3') };
  await page.reload();
  await expect(table(page, 'A3')).toHaveAttribute('aria-label', /8 seats, rectangle/);
  expect({ a1: await pos(page, 'A1'), a2: await pos(page, 'A2'), a3: await pos(page, 'A3') }).toEqual(before);
  const [a3] = await sql<{ seats: number; planShape: string; planRotation: number }>(`SELECT seats, "planShape", "planRotation" FROM "RestaurantTable" WHERE "locationId" = $1 AND label = 'A3'`, [s.locationId]);
  expect(a3).toEqual({ seats: 8, planShape: 'RECTANGLE', planRotation: 90 });

  // The guest view of the plan, then guests may choose their table.
  await page.getByTestId('editor-view-guest').click();
  await expect(page.getByTestId('editor-guest-view').getByTestId('plan-table')).toHaveCount(3);
  await page.getByTestId('guest-table-choice').check();
  await page.getByTestId('guest-table-choice-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('guest-table-choice-form').getByRole('status')).toBeVisible();
  const [rs] = await sql<{ guestTableChoice: boolean }>(`SELECT "guestTableChoice" FROM "ReservationSettings" WHERE "locationId" = $1`, [s.locationId]);
  expect(rs.guestTableChoice).toBe(true);

  // "Preview as guest" opens the Preview Studio on the booking page, with the plan.
  await page.getByTestId('preview-guest-plan').click();
  await expect(page).toHaveURL(/\/preview\?page=reserve$/);
  await expect(page.getByTestId('restaurant-preview')).toHaveAttribute('data-page', 'reserve');
  await expect(page.frameLocator('[data-testid=preview-frame]').getByTestId('table-choice')).toBeVisible();
});

async function chooseTime(g: Page, party: number, time: string) {
  await g.getByTestId('reserve-date').fill(tomorrow);
  await g.getByTestId('reserve-party').selectOption(String(party));
  await expect(g.getByTestId('reserve-times')).toHaveAttribute('data-for', `${tomorrow}|${party}`);
  await g.getByTestId('reserve-slot').filter({ hasText: time }).click();
}
async function fillGuest(g: Page, name: string, phone: string) {
  await g.getByLabel('Name').fill(name);
  await g.getByLabel('Phone').fill(phone);
}

test('guest: picks a free table on the plan; it is held with the request, and booked tables cannot be picked', async ({ browser, page }) => {
  const g = await browser.newPage();
  await g.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  await expect(g.getByTestId('reserve-form')).toHaveAttribute('data-has-plan', 'true');
  await expect(g.getByTestId('plan-hint')).toBeVisible(); // no time yet: nothing can be picked
  await expect(planTable(g, 'A2')).toHaveAttribute('data-status', 'unknown');
  await chooseTime(g, 4, '20:00');
  // Party of 4: the table for 2 is too small; 07 (no seat count) is not offered at all.
  await expect(planTable(g, 'A2')).toHaveAttribute('data-status', 'available');
  await expect(planTable(g, 'A1')).toHaveAttribute('data-status', 'too_small');
  await expect(planTable(g, 'A1')).toHaveAttribute('aria-disabled', 'true');
  await expect(planTable(g, '07')).toHaveCount(0);
  await planTable(g, 'A2').click();
  await expect(g.getByTestId('chosen-table')).toContainText('Table A2');
  await expect(g.getByTestId('summary-table')).toHaveText('Table A2');
  await expect(g.getByTestId('reserve-summary')).toContainText('not yet a confirmation');
  await screenshot(g, 'floor-plan-guest-desktop');
  await fillGuest(g, 'Plan Guest A', '+351 931 000 001');
  await g.getByTestId('reserve-submit').click();
  await expect(g).toHaveURL(/\/reservation\//);
  await expect(g.getByTestId('reservation-status')).toHaveAttribute('data-status', 'REQUESTED');
  await expect(g.getByTestId('reservation-table')).toHaveText('Requested table: A2');
  await g.close();

  // Another guest at an overlapping time: A2 is shown taken and cannot be chosen.
  const h = await browser.newPage();
  await h.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  await chooseTime(h, 2, '21:00');
  await expect(planTable(h, 'A2')).toHaveAttribute('data-status', 'booked');
  await planTable(h, 'A2').click({ force: true });
  await expect(h.getByTestId('chosen-table')).toHaveCount(0);
  await h.close();

  // Staff see the requested table on the reservation and still confirm it themselves.
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/reservations?date=${tomorrow}`);
  const row = page.getByTestId('reservation-row').filter({ hasText: 'Plan Guest A' });
  await expect(row.getByTestId('assigned-table')).toHaveText('Table A2');
  await expect(row.getByRole('button', { name: 'Confirm' })).toBeVisible();
});

test('two guests choose the same table at once: the second is told and chooses again', async ({ browser }) => {
  const [b, c] = await Promise.all([browser.newPage(), browser.newPage()]);
  for (const g of [b, c]) {
    await g.goto(`/r/${s.orgSlug}/reserve?lang=en`);
    await chooseTime(g, 2, '13:00');
    await planTable(g, 'A1').click();
    await expect(g.getByTestId('chosen-table')).toContainText('Table A1');
  }
  await fillGuest(b, 'Plan Guest B', '+351 931 000 002');
  await b.getByTestId('reserve-submit').click();
  await expect(b).toHaveURL(/\/reservation\//);

  await fillGuest(c, 'Plan Guest C', '+351 931 000 003');
  await c.getByTestId('reserve-submit').click();
  await expect(c.getByTestId('table-notice')).toContainText('This table was just taken');
  await expect(c.getByTestId('chosen-table')).toHaveCount(0);
  await expect(planTable(c, 'A1')).toHaveAttribute('data-status', 'booked'); // the plan was refreshed
  await expect(c).toHaveURL(/\/reserve/);
  await Promise.all([b.close(), c.close()]);
  const [{ n }] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "ReservationTableAssignment" a JOIN "RestaurantTable" t ON t.id = a."tableId" WHERE t."locationId" = $1 AND t.label = 'A1'`, [s.locationId]);
  expect(n).toBe(1);
});

test('guest on a phone: the plan opens on demand, fits the screen, and the request carries the table', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const g = await ctx.newPage();
  await g.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  await expect(g.getByTestId('floor-plan')).toBeHidden(); // behind "Show the floor plan"
  await chooseTime(g, 2, '19:00');
  await g.getByTestId('toggle-plan').click();
  await expect(g.getByTestId('toggle-plan')).toHaveAttribute('aria-expanded', 'true');
  await expect(planTable(g, 'A3')).toHaveAttribute('data-status', 'available');
  await planTable(g, 'A3').tap();
  await expect(g.getByTestId('chosen-table')).toContainText('Table A3');
  expect(await g.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(g, 'floor-plan-guest-phone');
  await fillGuest(g, 'Plan Guest D', '+351 931 000 004');
  await g.getByTestId('reserve-submit').tap();
  await expect(g).toHaveURL(/\/reservation\//);
  await expect(g.getByTestId('reservation-table')).toHaveText('Requested table: A3');
  await ctx.close();
});
