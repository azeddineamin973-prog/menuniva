// Cost of the polling endpoints (Live Orders every 5 s, kitchen screen every 4 s).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3300';
const LOG = 'audit/logs/perf-server.log';
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(`${BASE}/login`);
await page.getByTestId('login-form').locator('input[name=email]').fill(seed.owner);
await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
await page.getByTestId('login-form').locator('button[type=submit]').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));
for (const path of [`/api/dashboard/${seed.slug}/orders/live`, `/api/dashboard/${seed.slug}/kds/${seed.kitchenStationId}`]) {
  await page.request.get(`${BASE}${path}`);
  await new Promise((r) => setTimeout(r, 300));
  const t0 = Date.now();
  const res = await page.request.get(`${BASE}${path}`);
  const body = await res.body();
  const ms = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 400));
  const hits = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[db] ')).map((l) => l.split(' ')).filter((p) => Number(p[1]) >= t0 && Number(p[1]) <= t0 + ms + 300);
  console.log(`${path}: HTTP ${res.status()} ${ms} ms, ${Math.round(body.length / 1024)} KB JSON, ${hits.length} queries / ${hits.reduce((s, p) => s + parseInt(p[2], 10), 0)} ms`);
}
await browser.close();
