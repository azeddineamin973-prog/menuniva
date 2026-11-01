// Screenshots and overflow checks of the Preview Studio and the 2D table reservation (guest floor
// plan, owner editor) on a fictitious restaurant seeded into the TEST database (menuniva_test).
//   node audit/ux/studio-shots.mjs [base] [run] [--fresh]
//   base: a server running on the TEST database (default http://localhost:3101), run: folder name.
// The seeded restaurant is kept in audit/ux/out/studio-seed.json and reused unless --fresh.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASE = args[0] ?? 'http://localhost:3101';
const RUN = args[1] ?? 'studio';
const FRESH = process.argv.includes('--fresh');
const TEST_DB = process.env.TEST_DATABASE_URL ?? '';
if (!/menuniva_test\b/.test(TEST_DB)) throw new Error('TEST_DATABASE_URL must point to menuniva_test');
const OUT = `audit/artifacts/ux/${RUN}/studio`;
const SEED_FILE = 'audit/ux/out/studio-seed.json';
mkdirSync(OUT, { recursive: true });
mkdirSync('audit/ux/out', { recursive: true });

async function sql(query, params = []) {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  try {
    return (await c.query(query, params)).rows;
  } finally {
    await c.end();
  }
}

/** A restaurant with three languages, pickup, reservations with guest table choice and two dining areas. */
async function seedStudio() {
  const out = execFileSync('npx', ['tsx', '--conditions=react-server', 'tests/e2e/seed.ts', `studio${Date.now()}`], { env: { ...process.env, APP_ENV: 'test', DATABASE_URL: TEST_DB }, encoding: 'utf8' });
  const s = JSON.parse(out.trim().split('\n').reverse().find((l) => l.startsWith('{')));
  const hours = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '12:00', close: '23:00' }]])));
  await sql(`UPDATE "RestaurantOrganization" SET "enabledLanguages" = ARRAY['pt','en','ar']::"LanguageCode"[] WHERE id = $1`, [s.orgId]);
  await sql(`UPDATE "RestaurantLocation" SET "takeawayEnabled" = true, "reservationsEnabled" = true, "openingHours" = $2::jsonb WHERE id = $1`, [s.locationId, hours]);
  await sql(
    `INSERT INTO "ReservationSettings" (id, "locationId", "bookableHours", "guestTableChoice") VALUES ($1, $2, $3::jsonb, true)
     ON CONFLICT ("locationId") DO UPDATE SET "bookableHours" = $3::jsonb, "guestTableChoice" = true`,
    [`rs${Date.now()}`, s.locationId, hours],
  );
  const areas = { sala: `fa${Date.now()}s`, terrace: `fa${Date.now()}t` };
  const salaLabels = JSON.stringify([{ id: 'door', text: 'Entrada', x: 500, y: 610 }, { id: 'bar', text: 'Balcão', x: 900, y: 40 }]);
  const terraceLabels = JSON.stringify([{ id: 'street', text: 'Rua', x: 600, y: 470 }]);
  await sql(
    `INSERT INTO "DiningArea" (id, "organizationId", "locationId", name, "sortOrder", "planWidth", "planHeight", "planLabels") VALUES
     ($1, $3, $4, 'Sala', 1, 1000, 640, $5::jsonb), ($2, $3, $4, 'Esplanada', 2, 1200, 500, $6::jsonb)`,
    [areas.sala, areas.terrace, s.orgId, s.locationId, salaLabels, terraceLabels],
  );
  const tables = [
    ['1', 2, 'ROUND', 0, 140, 130, areas.sala],
    ['2', 2, 'ROUND', 0, 300, 130, areas.sala],
    ['3', 4, 'SQUARE', 0, 480, 140, areas.sala],
    ['4', 4, 'SQUARE', 0, 660, 140, areas.sala],
    ['5', 6, 'RECTANGLE', 0, 300, 420, areas.sala],
    ['6', 8, 'RECTANGLE', 90, 880, 360, areas.sala],
    ['8', 4, 'ROUND', 0, 580, 440, areas.sala],
    ['10', 2, 'ROUND', 0, 160, 160, areas.terrace],
    ['11', 4, 'SQUARE', 0, 360, 160, areas.terrace],
    ['12', 4, 'ROUND', 0, 560, 160, areas.terrace],
  ];
  const ids = {};
  for (const [label, seats, shape, rotation, x, y, areaId] of tables) {
    const id = `ft${Date.now()}${label}`;
    ids[label] = id;
    await sql(`INSERT INTO "RestaurantTable" (id, "organizationId", "locationId", "areaId", label, seats, "planX", "planY", "planShape", "planRotation") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"TableShape", $10)`, [id, s.orgId, s.locationId, areaId, label, seats, x, y, shape, rotation]);
  }
  // Tomorrow 20:00: table 3 is taken (a confirmed reservation holds it).
  const [{ tz }] = await sql(`SELECT "timeZone" AS tz FROM "RestaurantLocation" WHERE id = $1`, [s.locationId]);
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('sv-SE', { timeZone: tz });
  const resId = `fr${Date.now()}`;
  await sql(
    `INSERT INTO "Reservation" (id, "organizationId", "locationId", "startsAt", "endsAt", "partySize", name, phone, status, "trackingTokenHash", "idempotencyKey", "updatedAt")
     VALUES ($1, $2, $3, ($4 || ' 20:00')::timestamp AT TIME ZONE $5, ($4 || ' 21:30')::timestamp AT TIME ZONE $5, 4, 'Studio Seed', '+351 911 111 111', 'CONFIRMED', $6, $7, now())`,
    [resId, s.orgId, s.locationId, tomorrow, tz, randomBytes(16).toString('hex'), randomUUID()],
  );
  await sql(
    `INSERT INTO "ReservationTableAssignment" (id, "reservationId", "tableId", "startsAt", "endsAt") SELECT $1, r.id, $3, r."startsAt", r."startsAt" + interval '105 minutes' FROM "Reservation" r WHERE r.id = $2`,
    [`fra${Date.now()}`, resId, ids['3']],
  );
  // A second, unrelated fictional restaurant: its own room and tables, automatic assignment, so its
  // guests get the simple form (no map).
  const out2 = execFileSync('npx', ['tsx', '--conditions=react-server', 'tests/e2e/seed.ts', `beta${Date.now()}`], { env: { ...process.env, APP_ENV: 'test', DATABASE_URL: TEST_DB }, encoding: 'utf8' });
  const b = JSON.parse(out2.trim().split('\n').reverse().find((l) => l.startsWith('{')));
  await sql(`UPDATE "RestaurantLocation" SET "reservationsEnabled" = true, "openingHours" = $2::jsonb WHERE id = $1`, [b.locationId, hours]);
  await sql(`INSERT INTO "ReservationSettings" (id, "locationId", "bookableHours", "autoAssignTables") VALUES ($1, $2, $3::jsonb, true) ON CONFLICT ("locationId") DO UPDATE SET "bookableHours" = $3::jsonb, "autoAssignTables" = true`, [`rsb${Date.now()}`, b.locationId, hours]);
  const salao = `fb${Date.now()}`;
  await sql(`INSERT INTO "DiningArea" (id, "organizationId", "locationId", name, "planWidth", "planHeight") VALUES ($1, $2, $3, 'Salão', 800, 600)`, [salao, b.orgId, b.locationId]);
  for (const [label, seats, x, y] of [['B1', 2, 150, 150], ['B2', 4, 400, 150], ['B3', 4, 650, 150], ['B4', 6, 400, 420]]) {
    await sql(`INSERT INTO "RestaurantTable" (id, "organizationId", "locationId", "areaId", label, seats, "planX", "planY") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [`fb${Date.now()}${label}`, b.orgId, b.locationId, salao, label, seats, x, y]);
  }
  return { ...s, tomorrow, tables: ids, beta: { orgSlug: b.orgSlug, owner: b.owner, password: b.password } };
}

const seed = !FRESH && existsSync(SEED_FILE) ? JSON.parse(readFileSync(SEED_FILE, 'utf8')) : await seedStudio();
writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
const org = `/dashboard/${seed.orgSlug}`;
const report = [];
const browser = await chromium.launch({ channel: 'chrome' });

async function open(width, height, { owner = true, touch = width < 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch && width < 600 });
  const page = await ctx.newPage();
  if (owner) {
    await page.goto(`${BASE}/login`);
    await page.getByTestId('login-form').locator('input[name=email]').fill(seed.owner);
    await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
    await page.getByTestId('login-form').locator('button[type=submit]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return { ctx, page };
}
const overflow = async (page, w) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  return sw > w + 1 ? `OVERFLOW ${sw}` : 'ok';
};
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.frameLocator('[data-testid=preview-frame]').locator('[data-testid=storefront]').first().waitFor({ timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(500);
};
const stageInfo = (page) =>
  page.evaluate(() => {
    const st = document.querySelector('[data-testid=preview-stage]')?.getBoundingClientRect();
    const dev = document.querySelector('[data-testid=preview-area] > div:last-child')?.getBoundingClientRect();
    const ctl = document.querySelector('[data-testid=restaurant-preview] > div')?.getBoundingClientRect();
    const zoom = document.querySelector('[data-testid=preview-zoom-level]')?.textContent;
    const r = (b) => (b ? `${Math.round(b.width)}×${Math.round(b.height)}@${Math.round(b.left)},${Math.round(b.top)}` : '-');
    return `controls ${r(ctl)} · stage ${r(st)} · device ${r(dev)} · zoom ${zoom} · viewport ${innerWidth}×${innerHeight}`;
  });

// Studio on desktop sizes: each device, a zoom step, and the reservation page.
for (const [w, h] of [[1440, 900], [1280, 800], [1920, 1080]]) {
  const { ctx, page } = await open(w, h);
  await page.goto(`${BASE}${org}/preview`);
  await settle(page);
  await page.screenshot({ path: `${OUT}/studio-${w}-phone.png` });
  report.push([`studio ${w} phone`, await overflow(page, w), await stageInfo(page)]);
  for (const d of ['tablet', 'desktop']) {
    await page.getByTestId(`preview-device-${d}`).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/studio-${w}-${d}.png` });
    report.push([`studio ${w} ${d}`, await overflow(page, w), await stageInfo(page)]);
  }
  if (w === 1440) {
    await page.getByTestId('preview-zoom-in').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/studio-${w}-desktop-zoomed.png` });
    report.push([`studio ${w} desktop zoomed`, await overflow(page, w), await stageInfo(page)]);
    await page.getByTestId('preview-device-phone').click();
    await page.getByTestId('preview-page-reserve').click();
    await settle(page);
    await page.screenshot({ path: `${OUT}/studio-${w}-phone-reserve.png` });
    await page.getByTestId('preview-language').selectOption('ar');
    await settle(page);
    await page.screenshot({ path: `${OUT}/studio-${w}-phone-reserve-ar.png` });
  }
  await ctx.close();
}
// Studio on a tablet and phones (full page: controls, stage, sharing stacked).
for (const [w, h] of [[768, 1024], [390, 844], [360, 740]]) {
  const { ctx, page } = await open(w, h);
  await page.goto(`${BASE}${org}/preview`);
  await settle(page);
  await page.screenshot({ path: `${OUT}/studio-${w}.png`, fullPage: true });
  report.push([`studio ${w}`, await overflow(page, w), await stageInfo(page)]);
  await page.getByTestId('preview-device-desktop').click();
  await page.waitForTimeout(400);
  report.push([`studio ${w} desktop`, await overflow(page, w), await stageInfo(page)]);
  await ctx.close();
}

// Guest reservation with the floor plan (desktop and phone).
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const { ctx, page } = await open(w, h, { owner: false });
  await page.goto(`${BASE}/r/${seed.orgSlug}/reserve?lang=en`);
  await page.getByTestId('reserve-date').fill(seed.tomorrow);
  await page.getByTestId('reserve-party').selectOption('4');
  await page.waitForFunction(() => document.querySelector('[data-testid=reserve-times]')?.getAttribute('data-for')?.endsWith('|4'));
  await page.getByTestId('reserve-slot').filter({ hasText: '20:00' }).click();
  if (w < 1024) await page.getByTestId('toggle-plan').click();
  await page.locator('[data-testid=plan-table][data-status=available]').first().waitFor();
  await page.screenshot({ path: `${OUT}/guest-plan-${w}.png`, fullPage: true });
  const statuses = await page.locator('[data-testid=floor-plan] [data-testid=plan-table]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-table')}:${e.getAttribute('data-status')}`).join(' '));
  await page.locator('[data-testid=plan-table][data-table="4"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/guest-plan-${w}-chosen.png`, fullPage: true });
  report.push([`guest plan ${w}`, await overflow(page, w), statuses]);
  await ctx.close();
}

// Owner floor plan builder: as saved, a table selected, a template, a label selected, guest view.
for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
  const { ctx, page } = await open(w, h);
  await page.goto(`${BASE}${org}/tables/floor-plan`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/editor-${w}.png`, fullPage: true });
  await page.locator('[data-testid=editor-table][data-table="5"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/editor-${w}-selected.png`, fullPage: true });
  await page.getByTestId('template-walls').click();
  await page.waitForTimeout(200);
  await page.getByTestId('editor-canvas').screenshot({ path: `${OUT}/editor-${w}-walls.png` });
  const overlaps = await page.locator('[data-testid=editor-table][data-overlap]').count();
  await page.locator('[data-testid=editor-label][data-label="Entrada"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/editor-${w}-label.png`, fullPage: true });
  await page.getByTestId('editor-view-guest').click();
  await page.waitForTimeout(200);
  await page.getByTestId('editor-guest-view').screenshot({ path: `${OUT}/editor-${w}-guest-view.png` });
  report.push([`editor ${w}`, await overflow(page, w), `overlapping after template: ${overlaps}`]);
  await ctx.close();
}
// The second restaurant: its own builder, and guests get the simple form (automatic assignment).
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-form').locator('input[name=email]').fill(seed.beta.owner);
  await page.getByTestId('login-form').locator('input[name=password]').fill(seed.beta.password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${BASE}/dashboard/${seed.beta.orgSlug}/tables/floor-plan`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/beta-editor-1440.png`, fullPage: true });
  const own = await page.locator('[data-testid=editor-table]').evaluateAll((els) => els.map((e) => e.getAttribute('data-table')).join(' '));
  const other = await page.goto(`${BASE}${org}/tables/floor-plan`);
  report.push(['beta builder', `tables ${own}`, `other restaurant's builder → HTTP ${other?.status()}`]);
  await ctx.close();
  const g = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await g.goto(`${BASE}/r/${seed.beta.orgSlug}/reserve?lang=en`);
  await g.screenshot({ path: `${OUT}/beta-guest-390.png`, fullPage: true });
  report.push(['beta guest form', (await g.getByTestId('table-choice').count()) === 0 ? 'simple form, no map' : 'MAP SHOWN', await overflow(g, 390)]);
  await g.close();
}
await browser.close();
for (const r of report) console.log(r.filter(Boolean).join(' · '));
console.log(`screenshots in ${OUT}`);
