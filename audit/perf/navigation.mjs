// Tap-to-feedback and tap-to-page times of key links on the throttled phone (same profile as
// mobile.mjs: 390×844 at 3×, 150 ms latency, 1.6 Mbps down, 4× slower CPU), after the page has
// loaded and hydrated. "Feedback" is when the tapped link enters its pending state (spinner or
// pulsing line, src/components/ui/link-pending.tsx; it fades in from 100 ms after that, so quick
// navigations do not flicker); "new page" is when the new address is shown.
//   node audit/perf/navigation.mjs
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3300';
const RUNS = Number(process.env.RUNS ?? 3);
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const browser = await chromium.launch({ channel: 'chrome' });
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function ownerCookies() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.getByTestId('login-form').locator('input[name=email]').fill(seed.owner);
  await p.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
  await p.getByTestId('login-form').locator('button[type=submit]').click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  const c = await ctx.cookies();
  await ctx.close();
  return c;
}

async function tap(from, selector, to, cookies) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  if (cookies) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NET);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle', timeout: 120_000 });
  const link = page.locator(selector).first();
  await link.scrollIntoViewIfNeeded();
  await link.evaluate((a) => {
    window.__nav = { tap: 0, feedback: 0 };
    a.addEventListener('click', () => (window.__nav.tap = performance.now()), { capture: true, once: true });
    new MutationObserver(() => {
      if (!window.__nav.feedback && a.querySelector('[data-link-pending]')) window.__nav.feedback = performance.now();
    }).observe(a, { subtree: true, childList: true, attributes: true });
  });
  await link.tap();
  await page.waitForURL((u) => u.pathname.startsWith(to), { timeout: 60_000 });
  const t = await page.evaluate(() => ({ ...window.__nav, page: performance.now() }));
  // The pending state must end with the navigation (no spinner left on the old link).
  await page.waitForTimeout(300);
  const stuck = await page.locator(`${selector} [data-link-pending]`).count();
  await ctx.close();
  return { feedback: t.feedback ? Math.round(t.feedback - t.tap) : null, page: Math.round(t.page - t.tap), stuck };
}

const owner = await ownerCookies();
const CASES = [
  // Ordering-mode links are keyed by their address (src/components/storefront/order-modes.tsx).
  ['guest menu → pickup', `/r/${seed.slug}`, `a[data-mode="/r/${seed.slug}/order/pickup"]`, `/r/${seed.slug}/order/pickup`, null],
  ['guest menu → delivery', `/r/${seed.slug}`, `a[data-mode="/r/${seed.slug}/order/delivery"]`, `/r/${seed.slug}/order/delivery`, null],
  ['owner menu → add dish', `/dashboard/${seed.slug}/menu`, `a[href^="/dashboard/${seed.slug}/menu/products/new"]`, `/dashboard/${seed.slug}/menu/products/new`, owner],
  ['owner home → preview', `/dashboard/${seed.slug}`, '[data-testid="preview-restaurant-button"]', `/dashboard/${seed.slug}/preview`, owner],
];
for (const [name, from, selector, to, cookies] of CASES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await tap(from, selector, to, cookies));
  const fb = runs.map((r) => r.feedback);
  console.log(
    `${name.padEnd(24)} feedback ${fb.includes(null) ? 'MISSING' : `${med(fb)} ms`} · new page ${med(runs.map((r) => r.page))} ms · spinner left after navigation: ${runs.some((r) => r.stuck) ? 'YES' : 'no'}`,
  );
}
await browser.close();
