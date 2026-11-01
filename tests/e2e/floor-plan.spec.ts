import { expect, test, type Page } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

/**
 * Floor plan builder for any restaurant (fictional tenants only). The owner draws a room (size,
 * labels), places the restaurant's own tables (drag, keyboard, nudge buttons on touch screens,
 * templates), saves, and chooses how tables get onto online requests. Guests pick a free table
 * on the plan (desktop and phone) and never see anything private; a second restaurant and a
 * second location keep their own plans; automatic assignment holds a table without a map.
 */
let s: Seed;
let tomorrow: string;
const HOURS = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '12:00', close: '23:00' }]])));
test.beforeAll(async () => {
  s = seed(`fp${Date.now()}`);
  await sql(`UPDATE "RestaurantLocation" SET "reservationsEnabled" = true WHERE id = $1`, [s.locationId]);
  await sql(`UPDATE "ReservationSettings" SET "bookableHours" = $2::jsonb, "maxCoversPerSlot" = 20, "maxPartySize" = 8 WHERE "locationId" = $1`, [s.locationId, HOURS]);
  // The restaurant's own tables (the seed's table 07 has no seat count: never offered online).
  for (const [label, seats] of [['A1', 2], ['A2', 4], ['A3', 6]] as const) {
    await sql(`INSERT INTO "RestaurantTable" (id, "organizationId", "locationId", label, seats) VALUES ($1, $2, $3, $4, $5)`, [`fp${Date.now()}${label}`, s.orgId, s.locationId, label, seats]);
  }
  tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
});

const table = (page: Page, label: string) => page.locator(`[data-testid=editor-table][data-table="${label}"]`);
const planTable = (page: Page, label: string) => page.locator(`[data-testid=plan-table][data-table="${label}"]`);
const pos = async (page: Page, label: string) => ({ x: Number(await table(page, label).getAttribute('data-x')), y: Number(await table(page, label).getAttribute('data-y')) });
async function saveMode(page: Page, mode: 'staff' | 'automatic' | 'guest') {
  await page.getByTestId(`assignment-${mode}`).check();
  await page.getByTestId('table-assignment-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('table-assignment-form').getByRole('status')).toBeVisible();
}
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

test('owner: builds a room with its own tables, size and labels, saves it, and lets guests choose', async ({ page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/tables`);
  await page.getByTestId('open-floor-plan').click();
  await expect(page).toHaveURL(/\/tables\/floor-plan$/);
  // Default for every restaurant: staff assign tables, guests see the simple form.
  await expect(page.getByTestId('assignment-staff')).toBeChecked();
  await expect(page.getByTestId('guest-sees')).toContainText('simple booking form');
  const editor = page.getByTestId('floor-plan-editor');
  await expect(editor.getByTestId('floor-plan-no-area')).toBeVisible();

  // A dining area; it opens at once, and only the restaurant's real tables are offered.
  await editor.getByLabel('New dining area name').fill('Sala');
  await editor.getByRole('button', { name: 'Add area' }).click();
  await expect(editor.getByTestId('editor-area').filter({ hasText: 'Sala' })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByTestId('place-table')).toHaveCount(4);
  for (const t of ['A1', 'A2', 'A3']) await editor.locator(`[data-testid=place-table][data-table="${t}"]`).click();
  await expect(editor.getByTestId('editor-table')).toHaveCount(3);
  await expect(editor.getByTestId('place-table')).toHaveCount(1); // 07 stays off the plan
  await expect(editor.getByTestId('unsaved')).toBeVisible();

  // The room: a bigger size, and labels guests will see.
  await editor.getByTestId('room-preset-large').click();
  await expect(editor.getByTestId('editor-room')).toHaveAttribute('data-w', '1400');
  await editor.getByTestId('new-label').fill('Entrance');
  await editor.getByTestId('add-label').click();
  await expect(editor.locator('[data-testid=editor-label][data-label="Entrance"]')).toBeVisible();
  await expect(editor.getByTestId('label-inspector')).toBeVisible();
  const label = editor.locator('[data-testid=editor-label][data-label="Entrance"]');
  const ly = Number(await label.getAttribute('data-y'));
  await editor.getByTestId('label-inspector').getByTestId('nudge-down').click();
  await expect.poll(async () => Number(await label.getAttribute('data-y'))).toBe(ly + 20);

  // A template arranges the tables already there (positions only), without overlaps.
  await editor.getByTestId('template-rows').click();
  await expect(editor.getByTestId('overlap-warning')).toHaveCount(0);
  await expect(editor.getByTestId('editor-table')).toHaveCount(3);

  // Keyboard: arrows move the clicked table by one grid step (10 plan units).
  const a1 = await pos(page, 'A1');
  await table(page, 'A1').click();
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
  await table(page, 'A3').click();
  await page.getByTestId('inspector-seats').fill('8');
  await page.getByTestId('shape-RECTANGLE').click();
  await page.getByTestId('inspector-rotate').click();
  await expect(table(page, 'A3')).toHaveAttribute('aria-label', /Table A3, 8 seats, rectangle/);

  await editor.getByRole('button', { name: 'Save floor plan' }).click();
  await expect(editor.getByTestId('save-floor-plan').getByRole('status')).toHaveText('Saved');
  await expect(editor.getByTestId('unsaved')).toHaveCount(0);
  await screenshot(page, 'floor-plan-builder');

  // Saved: the same plan after a reload, and in the database.
  const before = { a1: await pos(page, 'A1'), a2: await pos(page, 'A2'), a3: await pos(page, 'A3') };
  await page.reload();
  await expect(table(page, 'A3')).toHaveAttribute('aria-label', /8 seats, rectangle/);
  expect({ a1: await pos(page, 'A1'), a2: await pos(page, 'A2'), a3: await pos(page, 'A3') }).toEqual(before);
  await expect(page.getByTestId('editor-room')).toHaveAttribute('data-w', '1400');
  await expect(page.locator('[data-testid=editor-label][data-label="Entrance"]')).toBeVisible();
  const [a3] = await sql<{ seats: number; planShape: string; planRotation: number }>(`SELECT seats, "planShape", "planRotation" FROM "RestaurantTable" WHERE "locationId" = $1 AND label = 'A3'`, [s.locationId]);
  expect(a3).toEqual({ seats: 8, planShape: 'RECTANGLE', planRotation: 90 });

  // Discard brings back the saved plan.
  await table(page, 'A1').click();
  await page.getByTestId('table-inspector').getByTestId('nudge-right').click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByTestId('discard-plan').click();
  await expect.poll(() => pos(page, 'A1')).toEqual(before.a1);
  await expect(page.getByTestId('unsaved')).toHaveCount(0);

  // New tables straight from the builder, drawn on this room.
  await page.getByTestId('add-tables-panel').locator('summary').click();
  await page.getByTestId('add-plan-labels').fill('B1, B2');
  await page.getByTestId('add-plan-seats').fill('2');
  await page.getByTestId('add-plan-shape').selectOption('SQUARE');
  await page.getByTestId('add-plan-tables').getByRole('button', { name: 'Add to plan' }).click();
  await expect(table(page, 'B1')).toBeVisible();
  await expect(table(page, 'B2')).toHaveAttribute('aria-label', /2 seats, square/);
  await expect(page.getByTestId('overlap-warning')).toHaveCount(0);

  // The guest view of the plan, then guests may choose their table.
  await page.getByTestId('editor-view-guest').click();
  await expect(page.getByTestId('editor-guest-view').getByTestId('plan-table')).toHaveCount(5);
  await expect(page.getByTestId('editor-guest-view').getByTestId('plan-label')).toHaveText('Entrance');
  await page.getByTestId('assignment-guest').check();
  // A guest may leave the choice to the restaurant: assigned automatically unless switched off.
  await expect(page.getByTestId('assignment-auto-fallback')).toBeChecked();
  await page.getByTestId('assignment-auto-fallback').uncheck();
  await page.getByTestId('table-assignment-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('table-assignment-form').getByRole('status')).toBeVisible();
  await expect(page.getByTestId('guest-sees')).toContainText('The floor plan: 1 area, 5 tables');
  const [rs] = await sql<{ guestTableChoice: boolean; autoAssignTables: boolean }>(`SELECT "guestTableChoice", "autoAssignTables" FROM "ReservationSettings" WHERE "locationId" = $1`, [s.locationId]);
  expect(rs).toEqual({ guestTableChoice: true, autoAssignTables: false });

  // "Preview booking page" opens the Preview Studio on the booking page, with the plan.
  await page.getByTestId('preview-guest-plan').click();
  await expect(page).toHaveURL(/\/preview\?page=reserve$/);
  await expect(page.getByTestId('restaurant-preview')).toHaveAttribute('data-page', 'reserve');
  await expect(page.frameLocator('[data-testid=preview-frame]').getByTestId('table-choice')).toBeVisible();
});

test('guest: picks a free table on the plan; it is held with the request, booked tables cannot be picked, nothing private is shown', async ({ browser, page }) => {
  const g = await browser.newPage();
  await g.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  await expect(g.getByTestId('reserve-form')).toHaveAttribute('data-has-plan', 'true');
  await expect(g.getByTestId('plan-label')).toHaveText('Entrance'); // the room as the restaurant drew it
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

  // Another guest at an overlapping time: A2 is shown taken and cannot be chosen; the public
  // answer carries only table ids and statuses, never the first guest.
  const h = await browser.newPage();
  await h.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  const answer = h.waitForResponse((r) => r.url().includes('/api/public/reservations/tables'));
  await chooseTime(h, 2, '21:00');
  const body = await (await answer).json();
  expect(Object.keys(body).sort()).toEqual(['slotAvailable', 'tables']);
  for (const t of body.tables) expect(Object.keys(t).sort()).toEqual(['id', 'status']);
  expect(JSON.stringify(body)).not.toContain('Plan Guest');
  await expect(planTable(h, 'A2')).toHaveAttribute('data-status', 'booked');
  await planTable(h, 'A2').click({ force: true });
  await expect(h.getByTestId('chosen-table')).toHaveCount(0);
  expect(await h.content()).not.toContain('Plan Guest A');
  await h.close();

  // Staff see the requested table, marked as the guest's choice, and still confirm it themselves.
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/reservations?date=${tomorrow}`);
  const row = page.getByTestId('reservation-row').filter({ hasText: 'Plan Guest A' });
  await expect(row.getByTestId('assigned-table')).toHaveText('Table A2');
  await expect(row.getByTestId('assignment-source')).toHaveText("guest's choice");
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

test('owner on a phone: selects a table by touch, moves it with the nudge buttons and saves, without side scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/tables/floor-plan`);
  await table(page, 'B1').scrollIntoViewIfNeeded();
  await table(page, 'B1').tap();
  await expect(page.getByTestId('table-inspector')).toContainText('Table B1');
  const start = await pos(page, 'B1');
  await page.getByTestId('table-inspector').getByTestId('nudge-down').tap();
  await page.getByTestId('table-inspector').getByTestId('nudge-down').tap();
  await expect.poll(() => pos(page, 'B1')).toEqual({ x: start.x, y: start.y + 40 });
  await page.getByRole('button', { name: 'Save floor plan' }).tap();
  await expect(page.getByTestId('save-floor-plan').getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.reload();
  await expect.poll(() => pos(page, 'B1')).toEqual({ x: start.x, y: start.y + 40 });
  await ctx.close();
});

test('automatic assignment: guests get the simple form, each request holds a fitting table, the guest sees it once confirmed', async ({ browser, page }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/tables/floor-plan`);
  await saveMode(page, 'automatic');
  await expect(page.getByTestId('guest-sees')).toContainText('Each request holds a free table automatically');

  const g = await browser.newPage();
  await g.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  await expect(g.getByTestId('table-choice')).toHaveCount(0); // no map in this mode
  await chooseTime(g, 5, '14:00'); // only A3 (8 seats) seats 5
  await fillGuest(g, 'Auto Guest', '+351 931 000 005');
  await g.getByTestId('reserve-submit').click();
  await expect(g).toHaveURL(/\/reservation\//);
  await expect(g.getByTestId('reservation-table')).toHaveCount(0); // held, but not promised yet

  await page.goto(`/dashboard/${s.orgSlug}/reservations?date=${tomorrow}`);
  const row = page.getByTestId('reservation-row').filter({ hasText: 'Auto Guest' });
  await expect(row.getByTestId('assigned-table')).toHaveText('Table A3');
  await expect(row.getByTestId('assignment-source')).toHaveText('automatic');
  await row.getByTestId('res-CONFIRMED').click();
  await expect(row.getByText('confirmed', { exact: false })).toBeVisible();
  await g.reload();
  await expect(g.getByTestId('reservation-status')).toHaveAttribute('data-status', 'CONFIRMED');
  await expect(g.getByTestId('reservation-table')).toHaveText('Table A3');
  await g.close();
  // Back to guest choice for the tests below.
  await page.goto(`/dashboard/${s.orgSlug}/tables/floor-plan`);
  await saveMode(page, 'guest');
});

test('another restaurant builds its own plan; neither restaurant can see or use the other one', async ({ browser, page }) => {
  const b = seed(`fq${Date.now()}`);
  await sql(`UPDATE "RestaurantLocation" SET "reservationsEnabled" = true WHERE id = $1`, [b.locationId]);
  await sql(`UPDATE "ReservationSettings" SET "bookableHours" = $2::jsonb WHERE "locationId" = $1`, [b.locationId, HOURS]);
  await login(page, b.owner, b.password);
  // Restaurant B starts from its own empty builder: none of restaurant A's rooms or tables.
  await page.goto(`/dashboard/${b.orgSlug}/tables/floor-plan`);
  await expect(page.getByTestId('editor-area')).toHaveCount(0);
  await page.getByLabel('New dining area name').fill('Salão');
  await page.getByRole('button', { name: 'Add area' }).click();
  await expect(page.getByTestId('editor-area')).toHaveText('Salão');
  await page.getByTestId('add-tables-panel').locator('summary').click();
  await page.getByTestId('add-plan-labels').fill('M1, M2, M3');
  await page.getByTestId('add-plan-seats').fill('4');
  await page.getByTestId('add-plan-tables').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.getByTestId('editor-table')).toHaveCount(3);
  await expect(page.locator('[data-testid=editor-table][data-table^="A"]')).toHaveCount(0);
  await saveMode(page, 'guest');
  // Restaurant A's builder does not exist for B's owner.
  expect((await page.goto(`/dashboard/${s.orgSlug}/tables/floor-plan`))?.status()).toBe(404);

  // Guests of B see B's tables only, and A's guests never see B's.
  const g = await browser.newPage();
  await g.goto(`/r/${b.orgSlug}/reserve?lang=en`);
  await chooseTime(g, 2, '20:00');
  await expect(g.locator('[data-testid=floor-plan] [data-testid=plan-table]')).toHaveCount(3);
  await expect(planTable(g, 'M1')).toHaveAttribute('data-status', 'available');
  await expect(planTable(g, 'A1')).toHaveCount(0);
  await g.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  await expect(planTable(g, 'M1')).toHaveCount(0);
  // A's table cannot be booked through B's page.
  const [{ id: aTable }] = await sql<{ id: string }>(`SELECT id FROM "RestaurantTable" WHERE "locationId" = $1 AND label = 'A2'`, [s.locationId]);
  const res = await g.request.post('/api/public/reservations', {
    headers: { origin: new URL(g.url()).origin },
    data: { orgSlug: b.orgSlug, date: tomorrow, time: '20:00', partySize: 2, name: 'Cross Guest', phone: '+351 931 000 009', idempotencyKey: crypto.randomUUID(), language: 'en', tableId: aTable },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toBe('table_unavailable');
  await g.close();
});

test('a second location has its own floor plan and booking map', async ({ browser, page }) => {
  await sql(
    `INSERT INTO "RestaurantLocation" (id, "organizationId", slug, name, "isPublished", "reservationsEnabled", "openingHours", "createdAt", "updatedAt") VALUES ($1, $2, 'porto', 'Porto', true, true, $3::jsonb, now(), now())`,
    [`loc${Date.now()}`, s.orgId, HOURS],
  );
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/tables/floor-plan`);
  await expect(page.getByTestId('floor-plan-location')).toContainText('You are editing');
  await expect(page.getByTestId('editor-area')).toHaveText('Sala');
  await page.getByTestId('location-switcher').selectOption({ label: 'Porto' });
  await expect(page.getByTestId('floor-plan-location')).toContainText('Porto');
  await expect(page.getByTestId('floor-plan-empty')).toBeVisible(); // nothing of the first location
  await page.getByLabel('New dining area name').fill('Rooftop');
  await page.getByRole('button', { name: 'Add area' }).click();
  await page.getByTestId('add-tables-panel').locator('summary').click();
  await page.getByTestId('add-plan-labels').fill('P1, P2');
  await page.getByTestId('add-plan-seats').fill('2');
  await page.getByTestId('add-plan-tables').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.getByTestId('editor-table')).toHaveCount(2);
  await saveMode(page, 'guest');

  const g = await browser.newPage();
  await g.goto(`/r/${s.orgSlug}/reserve?l=porto&lang=en`);
  await chooseTime(g, 2, '20:00');
  await expect(g.locator('[data-testid=floor-plan] [data-testid=plan-table]')).toHaveCount(2);
  await expect(planTable(g, 'P1')).toHaveAttribute('data-status', 'available');
  await expect(planTable(g, 'A1')).toHaveCount(0);
  await g.goto(`/r/${s.orgSlug}/reserve?lang=en`);
  await expect(planTable(g, 'P1')).toHaveCount(0);
  await expect(planTable(g, 'A1')).toHaveCount(1);
  await g.close();
});
