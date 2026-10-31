// Lists the database queries one page load runs, grouped by statement (DB_QUERY_LOG=1 server).
//   node audit/perf/queries.mjs /dashboard/casa-aurora/tables [--soft]
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3300';
const LOG = 'audit/logs/perf-server.log';
const path = process.argv[2];
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(`${BASE}/login`);
await page.getByTestId('login-form').locator('input[name=email]').fill(seed.owner);
await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
await page.getByTestId('login-form').locator('button[type=submit]').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));
await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 400));
const t0 = Date.now();
await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 600));
const t1 = Date.now();
await browser.close();
const hits = readFileSync(LOG, 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('[db] '))
  .map((l) => l.split(' '))
  .filter((p) => Number(p[1]) >= t0 && Number(p[1]) <= t1);
const groups = new Map();
for (const p of hits) {
  const sql = p.slice(3).join(' ').replace(/\$\d+/g, '?').replace(/"public"\./g, '').slice(0, 110);
  const g = groups.get(sql) ?? { n: 0, ms: 0 };
  g.n++;
  g.ms += parseInt(p[2], 10);
  groups.set(sql, g);
}
console.log(`${path}: ${hits.length} queries, ${hits.reduce((s, p) => s + parseInt(p[2], 10), 0)} ms`);
for (const [sql, g] of [...groups].sort((a, b) => b[1].n - a[1].n || b[1].ms - a[1].ms).slice(0, 18)) console.log(`${String(g.n).padStart(4)}× ${String(g.ms).padStart(5)}ms  ${sql}`);
