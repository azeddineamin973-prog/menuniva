import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { expect, type Page } from '@playwright/test';

loadEnv({ path: path.resolve(__dirname, '../../.env') });
/** DEMO database only (fictitious data). */
export const DEMO_DB = process.env.DEMO_DATABASE_URL ?? '';
if (!DEMO_DB.includes('menuniva_demo')) throw new Error('audit runs only against menuniva_demo');
export const BASE = 'http://localhost:3201';
export const ORIGIN = { Origin: BASE };
/** Fictitious demo-only credentials (same nature as the repo's demo-e2e-password-1). */
export const PASSWORD = 'audit-demo-password-1';
export const ADMIN = { name: 'Audit Super Admin (DEMO)', email: 'audit.admin@demo.menuniva.invalid', password: 'audit-admin-password-1' };

const SHOTS = path.resolve(__dirname, '../artifacts/screenshots');
mkdirSync(SHOTS, { recursive: true });
export async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DEMO_DB });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Evidence collected during the run, written to audit/logs/evidence-<name>.json. */
export function evidence(name: string) {
  const file = path.resolve(__dirname, `../logs/evidence-${name}.json`);
  const data: Record<string, unknown> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return {
    add(key: string, value: unknown) {
      data[key] = value;
      writeFileSync(file, JSON.stringify(data, null, 2));
    },
  };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-form').locator('input[name=email]').fill(email);
  await page.getByTestId('login-form').locator('input[name=password]').fill(password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Signs up through /signup and registers a restaurant through /onboarding/new. Returns the slug. */
export async function signUpAndRegister(page: Page, owner: { name: string; email: string }, restaurant: string, city: string): Promise<string> {
  await page.goto('/signup');
  await page.getByLabel('Nome completo').fill(owner.name);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Palavra-passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/onboarding\/new/);
  await page.getByLabel('Restaurant name').fill(restaurant);
  await page.getByLabel('City').fill(city);
  await page.getByRole('button', { name: 'Create restaurant' }).click();
  await expect(page).toHaveURL(/\/dashboard\/[a-z0-9-]+\/setup/);
  return new URL(page.url()).pathname.split('/')[2];
}

/** Ensures a Super Admin exists in the demo DB, created through the real CLI token + /setup page. */
export async function ensureSuperAdmin(page: Page) {
  const [existing] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "User" WHERE email = $1 AND "platformRole" = 'PLATFORM_SUPER_ADMIN'`, [ADMIN.email]);
  if (existing.n > 0) return login(page, ADMIN.email, ADMIN.password);
  const out = execFileSync('npx', ['tsx', '--conditions=react-server', 'scripts/create-setup-token.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: DEMO_DB, APP_ENV: 'demo', APP_BASE_URL: BASE },
    encoding: 'utf8',
  });
  const url = out.match(/https?:\/\/\S+\/setup\?token=\S+/)?.[0];
  if (!url) throw new Error(`No setup link printed (another platform admin may exist in the demo DB):\n${out}`);
  await page.goto(new URL(url).pathname + new URL(url).search);
  await page.getByLabel('Full name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export async function setDashboardLanguageEnglish(page: Page) {
  await page.goto('/account');
  const f = page.getByTestId('profile-form');
  await f.getByLabel('Dashboard language').selectOption('en');
  await f.getByRole('button').click();
  await expect(f.getByText(/Saved/i)).toBeVisible();
}

export const runId = () => `${Date.now().toString(36)}`;

export type DishSpec = { cat: number; name: string; dine: string; takeaway?: string; delivery?: string };
export type Built = { slug: string; orgId: string; locationId: string; email: string; tableHrefs: string[] };

/**
 * Builds a complete fictitious restaurant through the real UI: sign-up, onboarding, address,
 * stations, categories, dishes with channel prices, ordering channels, tables, publish.
 */
export async function buildRestaurant(
  page: Page,
  o: { label: string; channels: ('Order at table (QR codes)' | 'Takeaway / pickup' | 'Restaurant delivery' | 'Reservation requests')[]; dishes: DishSpec[]; tables?: string; googleUrl?: string },
): Promise<Built> {
  const id = runId();
  const email = `${o.label.toLowerCase().replace(/\W+/g, '.')}.${id}@audit.menuniva.invalid`;
  // The audit creates many restaurants from one machine; the real limit (10 sign-ups / IP / hour,
  // verified separately in Phase G) is reset in the DEMO database only, so each flow can start.
  await sql(`DELETE FROM "RateLimitBucket" WHERE key LIKE 'signup:%' OR key LIKE 'register-restaurant:%'`);
  const slug = await signUpAndRegister(page, { name: `Audit ${o.label} owner`, email }, `Audit ${o.label} ${id}`, 'Braga');
  await setDashboardLanguageEnglish(page);
  const base = `/dashboard/${slug}`;
  await page.goto(`${base}/settings`);
  const loc = page.getByTestId('location-settings-form');
  await loc.getByLabel('Street address').fill('Rua da Auditoria, 2 (demo)');
  await loc.getByLabel('Postal code').fill('4700-123');
  await loc.getByLabel('City').fill('Braga');
  await loc.getByLabel('Telephone').fill('+351 900 000 102');
  await loc.getByRole('button', { name: 'Save' }).click();
  await expect(loc.getByText('Saved')).toBeVisible();
  await page.goto(`${base}/stations`);
  for (const [name, type] of [['Cozinha F', 'Kitchen'], ['Café F', 'Café']] as const) {
    const f = page.getByTestId('add-station-form');
    await f.getByLabel('Name').fill(name);
    await f.getByLabel('Type').selectOption({ label: type });
    await f.getByRole('button', { name: 'Add station' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.goto(`${base}/menu`);
  for (const [name, station] of [['Pratos', 'Cozinha F'], ['Bebidas', 'Café F']]) {
    const form = page.getByTestId('add-category-form');
    await form.getByLabel(/New category name/).fill(name);
    await form.getByLabel('Default station').selectOption({ label: station });
    await form.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByTestId('menu-category').filter({ hasText: name })).toBeVisible();
  }
  for (const d of o.dishes) {
    await page.goto(`${base}/menu`);
    await page.getByTestId(`add-dish-${d.cat}`).click();
    await page.getByTestId('product-name-pt').fill(d.name);
    await page.getByTestId('price-DINE_IN').fill(d.dine);
    if (d.takeaway) await page.getByTestId('price-TAKEAWAY').fill(d.takeaway);
    if (d.delivery) await page.getByTestId('price-DELIVERY').fill(d.delivery);
    await page.getByTestId('product-status').selectOption('ACTIVE');
    await page.getByRole('button', { name: 'Create dish' }).click();
    await expect(page).toHaveURL(/\/menu\/products\/(?!new)[a-z0-9]+$/);
  }
  await page.goto(`${base}/settings/channels`);
  const ch = page.getByTestId('channels-form');
  for (const c of o.channels) await ch.getByLabel(c).check();
  if (o.googleUrl) await page.locator('#googleReviewUrl').fill(o.googleUrl);
  await ch.getByRole('button', { name: 'Save' }).click();
  await expect(ch.getByText('Saved')).toBeVisible();
  let tableHrefs: string[] = [];
  if (o.tables) {
    await page.goto(`${base}/tables`);
    await page.getByTestId('create-tables-form').getByLabel('Table labels').fill(o.tables);
    await page.getByTestId('create-tables-form').getByRole('button', { name: 'Create tables' }).click();
    await expect(page.getByTestId('table-card').first()).toBeVisible();
    tableHrefs = (await page.getByTestId('open-table-link').evaluateAll((els) => els.map((e) => e.getAttribute('href')))) as string[];
  }
  await page.goto(`${base}/setup/publish`);
  await page.getByTestId('publish-form').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  const [row] = await sql<{ orgId: string; locationId: string }>(`SELECT o.id AS "orgId", l.id AS "locationId" FROM "RestaurantOrganization" o JOIN "RestaurantLocation" l ON l."organizationId" = o.id WHERE o.slug = $1`, [slug]);
  return { slug, ...row, email, tableHrefs };
}

/** Fills the 7-day opening-hours editor inside `scope` with one range per day. */
export async function fillWeekHours(scope: ReturnType<Page['locator']>, open: string, close: string) {
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    const row = scope.locator('div.rounded-xl').filter({ hasText: day }).first();
    if ((await row.getByLabel(`${day} opens`).count()) === 0) await row.getByRole('button', { name: '+ Add hours' }).click();
    await row.getByLabel(`${day} opens`).fill(open);
    await row.getByLabel(`${day} closes`).fill(close);
  }
}
