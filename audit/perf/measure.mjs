// Navigation performance probe (production build on the isolated audit server, DB_QUERY_LOG=1).
// For each page: hard load (TTFB, DOMContentLoaded) and in-app click navigation (click → new
// heading painted), plus the number and total time of database queries the server ran for it.
//   node audit/perf/measure.mjs [label]   → audit/perf/out/<label>.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const LABEL = process.argv[2] ?? 'run';
const BASE = 'http://localhost:3300';
const LOG = 'audit/logs/perf-server.log';
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const org = `/dashboard/${seed.slug}`;
const PAGES = ['', '/orders', '/tasks', '/kitchen', '/tables', '/bills', '/reservations', '/menu', '/preview', '/import', '/stations', '/promotions', '/takeaway', '/delivery', '/reviews', '/loyalty', '/analytics', '/staff', '/settings', '/menu/quick', '/menu/translations', '/setup'];

const queriesBetween = (t0, t1) => {
  const lines = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[db] '));
  const hits = lines.map((l) => l.split(' ')).filter((p) => Number(p[1]) >= t0 && Number(p[1]) <= t1);
  return { n: hits.length, ms: hits.reduce((s, p) => s + parseInt(p[2], 10), 0) };
};
const settle = () => new Promise((r) => setTimeout(r, 250)); // let late queries reach the log

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.getByTestId('login-form').locator('input[name=email]').fill(seed.owner);
await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
await page.getByTestId('login-form').locator('button[type=submit]').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));

const rows = [];
// Warm-up: every route once (first request after a build pays one-off module loading).
for (const p of PAGES) await page.goto(`${BASE}${org}${p}`, { waitUntil: 'domcontentloaded' });

for (const p of PAGES) {
  // Hard load (typing the address / refresh).
  const t0 = Date.now();
  const res = await page.goto(`${BASE}${org}${p}`, { waitUntil: 'domcontentloaded' });
  const timing = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { ttfb: Math.round(n.responseStart - n.requestStart), dcl: Math.round(n.domContentLoadedEventEnd - n.startTime), bytes: n.transferSize };
  });
  await settle();
  const hard = { status: res.status(), ...timing, db: queriesBetween(t0, Date.now()) };

  // Soft navigation: from the overview, click the sidebar link (what staff do all day).
  await page.goto(`${BASE}${org}`, { waitUntil: 'domcontentloaded' });
  await settle();
  let soft = null;
  const link = page.locator(`aside nav a[href="${org}${p}"]`).first();
  if (p && (await link.count())) {
    const before = await page.locator('main h1').first().textContent();
    const t1 = Date.now();
    await link.click();
    await page.waitForURL(`${BASE}${org}${p}`);
    await page.waitForFunction((b) => {
      const h = document.querySelector('main h1');
      return h && h.textContent !== b;
    }, before, { timeout: 15_000 });
    const clickMs = Date.now() - t1;
    await settle();
    soft = { clickMs, db: queriesBetween(t1, Date.now()) };
  }
  rows.push({ page: p || '/', hard, soft });
  console.log(
    `${(p || '/').padEnd(22)} hard: ttfb ${String(hard.ttfb).padStart(4)}ms dcl ${String(hard.dcl).padStart(4)}ms ${String(Math.round(hard.bytes / 1024)).padStart(4)}KB db ${String(hard.db.n).padStart(3)}q/${String(hard.db.ms).padStart(4)}ms` +
      (soft ? `  | click ${String(soft.clickMs).padStart(4)}ms db ${String(soft.db.n).padStart(3)}q/${String(soft.db.ms).padStart(4)}ms` : ''),
  );
}
await browser.close();
mkdirSync('audit/perf/out', { recursive: true });
writeFileSync(`audit/perf/out/${LABEL}.json`, JSON.stringify(rows, null, 1));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const softs = rows.filter((r) => r.soft);
console.log(`\nmedian hard TTFB ${med(rows.map((r) => r.hard.ttfb))}ms · median click ${med(softs.map((r) => r.soft.clickMs))}ms · median queries hard ${med(rows.map((r) => r.hard.db.n))} / click ${med(softs.map((r) => r.soft.db.n))}`);
