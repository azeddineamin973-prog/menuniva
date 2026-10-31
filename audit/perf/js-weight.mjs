// JavaScript and total bytes a cold browser downloads for a page.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3300';
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const browser = await chromium.launch({ channel: 'chrome' });
const login = async (ctx) => { const p = await ctx.newPage(); await p.goto(`${BASE}/login`); await p.getByTestId('login-form').locator('input[name=email]').fill(seed.owner); await p.getByTestId('login-form').locator('input[name=password]').fill(seed.password); await p.getByTestId('login-form').locator('button[type=submit]').click(); await p.waitForURL((u) => !u.pathname.startsWith('/login')); await p.close(); };
const auth = await browser.newContext(); await login(auth);
for (const [ctxName, path] of [['owner', `/dashboard/${seed.slug}`], ['owner', `/dashboard/${seed.slug}/menu`], ['owner', `/dashboard/${seed.slug}/orders`], ['guest', `/r/${seed.slug}`], ['guest', `/t/${seed.tables[0]}`]]) {
  const ctx = ctxName === 'owner' ? auth : await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let js = 0, all = 0, n = 0;
  cdp.on('Network.loadingFinished', (e) => { all += e.encodedDataLength; n++; });
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => { if (types.get(e.requestId) === 'Script') js += e.encodedDataLength; });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  console.log(`${path.padEnd(42)} ${n} requests · ${Math.round(all / 1024)} KB transferred · ${Math.round(js / 1024)} KB JS (compressed)`);
  await page.close();
}
await browser.close();
