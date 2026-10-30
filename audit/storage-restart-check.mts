// Image persistence across an app restart with Supabase Storage.
//   npx tsx audit/storage-restart-check.mts      (needs a current .next-e2e build: run the E2E suite first)
// Uses only the TEST database (a new fictitious restaurant) and a temporary bucket folder
// test-tmp/restart-<time>/ that is emptied at the end. The secret key is never printed.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { chromium, type Page } from '@playwright/test';
import { makePng } from '../tests/support/png.ts';

loadEnv({ quiet: true });
const TEST_DB = process.env.TEST_DATABASE_URL ?? '';
if (!TEST_DB.includes('menuniva_test')) throw new Error('TEST_DATABASE_URL must point to menuniva_test');
const PORT = 3110;
const BASE = `http://localhost:${PORT}`;
const PREFIX = `test-tmp/restart-${Date.now()}/`;
const env = {
  ...process.env,
  NEXT_DIST_DIR: '.next-e2e',
  APP_ENV: 'test',
  DATABASE_URL: TEST_DB,
  APP_BASE_URL: BASE,
  APP_SECRET: process.env.APP_SECRET || 'e2e-secret-e2e-secret-e2e-secret-123456',
  STORAGE_DRIVER: 'supabase',
  SUPABASE_STORAGE_PREFIX: PREFIX,
};
const results: [string, boolean][] = [];
const check = (name: string, ok: boolean) => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
async function sql<T>(q: string, p: unknown[]) {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  try {
    return (await c.query(q, p)).rows as T[];
  } finally {
    await c.end();
  }
}
async function startServer(): Promise<ChildProcess> {
  const proc = spawn('npx', ['next', 'start', '--port', String(PORT)], { env, stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return proc;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}
async function stopServer(proc: ChildProcess) {
  process.kill(-proc.pid!, 'SIGTERM'); // whole process group (npx → next)
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/api/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not stop');
}
const naturalWidth = (page: Page, src: string) => page.locator(`img[src="${src}"]`).first().evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth));
const bytes = async (path: string) => {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()) };
};

const s = JSON.parse(
  execFileSync('npx', ['tsx', '--conditions=react-server', 'tests/e2e/seed.ts', `rs${Date.now()}`], { env: { ...process.env, APP_ENV: 'test', DATABASE_URL: TEST_DB }, encoding: 'utf8' })
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{'))!,
);
const LOGO = makePng(64, 48, [30, 120, 60]);
const COVER = makePng(320, 120, [200, 160, 40]);
const DISH = makePng(96, 96, [180, 50, 50]);
console.log(`restaurant ${s.orgSlug} (TEST database), bucket folder ${PREFIX}`);

let server = await startServer();
const pid1 = server.pid;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  // ---- 1st server process: upload through the real UI
  const page = await browser.newPage({ baseURL: BASE });
  await page.goto('/login');
  await page.locator('[data-testid=login-form] input[name=email]').fill(s.owner);
  await page.locator('[data-testid=login-form] input[name=password]').fill(s.password);
  await page.locator('[data-testid=login-form] button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form = page.getByTestId('branding-form');
  await form.locator('#logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO });
  await form.locator('#cover').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: COVER });
  await form.getByRole('button', { name: 'Save' }).click();
  await form.getByText('Saved').waitFor();
  await page.goto(`/dashboard/${s.orgSlug}/menu/products/${s.dishId}`);
  const photoForm = page.locator('#image').locator('xpath=ancestor::form');
  await page.locator('#image').setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: DISH });
  await photoForm.getByLabel('I have the right to publish this photo.').check();
  await photoForm.getByRole('button', { name: 'Upload photo' }).click();
  let dish = '';
  for (let i = 0; i < 40 && !dish; i++) {
    dish = (await sql<{ url: string }>(`SELECT url FROM "ProductImage" WHERE "productId" = $1`, [s.dishId]))[0]?.url ?? '';
    if (!dish) await new Promise((r) => setTimeout(r, 250));
  }
  const [b] = await sql<{ logoUrl: string; coverUrl: string }>(`SELECT "logoUrl", "coverUrl" FROM "RestaurantBranding" WHERE "organizationId" = $1`, [s.orgId]);
  check('upload: logo, cover and dish photo paths saved in PostgreSQL', [b?.logoUrl, b?.coverUrl, dish].every((p) => new RegExp(`^/media/${s.orgId}/(branding|products)/`).test(p ?? '')));

  // ---- restart: stop the process completely, start a new one
  await stopServer(server);
  check('restart: first server process stopped (port closed)', await fetch(`${BASE}/api/health`).then(() => false, () => true));
  server = await startServer();
  check(`restart: new server process started (pid ${pid1} → ${server.pid})`, server.pid !== pid1);

  // ---- 2nd server process: everything is still there and displays
  const guest = await browser.newPage({ baseURL: BASE });
  await guest.goto(`/r/${s.orgSlug}`);
  check('after restart: guest page shows the logo, decoded 64 px wide', (await naturalWidth(guest, b.logoUrl)) === 64);
  check('after restart: guest page shows the cover, decoded 320 px wide', (await naturalWidth(guest, b.coverUrl)) === 320);
  await guest.goto(`/t/${s.qrToken}`);
  check('after restart: table menu shows the dish photo, decoded 96 px wide', (await naturalWidth(guest, dish)) === 96);
  for (const [name, path, buf] of [['logo', b.logoUrl, LOGO], ['cover', b.coverUrl, COVER], ['dish photo', dish, DISH]] as const) {
    const r = await bytes(path);
    check(`after restart: ${name} bytes identical, image/png`, r.status === 200 && r.type === 'image/png' && r.body.equals(buf));
  }

  // ---- cleanup through the UI (also exercises delete on the restarted process)
  const page2 = await browser.newPage({ baseURL: BASE });
  await page2.context().addCookies(await page.context().cookies());
  await page2.goto(`/dashboard/${s.orgSlug}/settings/branding`);
  const form2 = page2.getByTestId('branding-form');
  await form2.getByLabel('Remove the current logo').check();
  await form2.getByLabel('Remove the current cover photo').check();
  await form2.getByRole('button', { name: 'Save' }).click();
  await form2.getByText('Saved').waitFor();
  await page2.goto(`/dashboard/${s.orgSlug}/menu/products/${s.dishId}`);
  await page2.locator(`img[src="${dish}"]`).locator('xpath=..').getByRole('button', { name: 'Remove' }).click();
  await page2.locator(`img[src="${dish}"]`).waitFor({ state: 'detached' });
  const after = await Promise.all([b.logoUrl, b.coverUrl, dish].map(bytes));
  check('after restart: removing all three deletes them (404)', after.every((r) => r.status === 404));
} finally {
  await browser.close();
  await stopServer(server).catch(() => undefined);
}
const left = execFileSync('node', ['scripts/storage-test-cleanup.mjs', PREFIX], { encoding: 'utf8' }).trim();
check(`bucket folder ${PREFIX} empty at the end (${left.split('\n')[0]})`, /^0 object/.test(left));
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
