// Guest storefront and owner menu on a phone over a slow network, measured in a real browser.
// Phone: 390×844 at 3× (iPhone-class). Network: 150 ms latency, 1.6 Mbps down, 750 kbps up and
// 4× slower CPU — the throttling Lighthouse uses for mobile. Each page is loaded cold (empty cache)
// three times; medians are reported.
//   node audit/perf/mobile.mjs <label>   → audit/perf/out/mobile-<label>.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const LABEL = process.argv[2] ?? 'run';
const BASE = 'http://localhost:3300';
const RUNS = Number(process.env.RUNS ?? 3);
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const browser = await chromium.launch({ channel: 'chrome' });
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

let ownerCookies = null;
async function ownerSession() {
  if (ownerCookies) return ownerCookies;
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.getByTestId('login-form').locator('input[name=email]').fill(seed.owner);
  await p.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
  await p.getByTestId('login-form').locator('button[type=submit]').click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  ownerCookies = await ctx.cookies();
  await ctx.close();
  return ownerCookies;
}

/** One cold load. `scroll`: then scroll to the bottom like a guest reading the whole menu. */
async function measure(path, { owner = false, scroll = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  if (owner) await ctx.addCookies(await ownerSession());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', NET);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const type = new Map();
  const bytes = { Image: 0, Script: 0, Document: 0, Other: 0 };
  let images = 0;
  cdp.on('Network.responseReceived', (e) => type.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    const t = type.get(e.requestId) ?? 'Other';
    const k = t in bytes ? t : t === 'Fetch' || t === 'XHR' ? 'Other' : 'Other';
    bytes[k] += e.encodedDataLength;
    if (t === 'Image') images++;
  });
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 120_000 });
  const load = Date.now() - t0;
  await page.waitForTimeout(1500);
  const vitals = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0) }));
  const firstView = { ...bytes, images };
  let full = null;
  if (scroll) {
    // Read the whole menu: scroll in screen-sized steps, letting lazy images start.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(250);
    }
    await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => undefined);
    full = { ...bytes, images };
  }
  await ctx.close();
  return { load, ...vitals, firstView, full };
}

const PAGES = [
  ['guest menu /r', `/r/${seed.slug}`, { scroll: true }],
  ['guest table /t', `/t/${seed.tables[0]}`, { scroll: true }],
  ['guest pickup', `/r/${seed.slug}/order/pickup`, {}],
  ['owner menu', `/dashboard/${seed.slug}/menu`, { owner: true, scroll: true }],
];
const out = {};
for (const [name, path, opts] of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(path, opts));
  const pick = (f) => med(runs.map(f));
  const r = {
    lcp: pick((x) => x.lcp),
    fcp: pick((x) => x.fcp),
    load: pick((x) => x.load),
    firstViewImageKB: Math.round(pick((x) => x.firstView.Image) / 1024),
    firstViewImages: pick((x) => x.firstView.images),
    firstViewTotalKB: Math.round(pick((x) => x.firstView.Image + x.firstView.Script + x.firstView.Document + x.firstView.Other) / 1024),
    jsKB: Math.round(pick((x) => x.firstView.Script) / 1024),
    fullMenuImageKB: runs[0].full ? Math.round(pick((x) => x.full.Image) / 1024) : null,
    fullMenuImages: runs[0].full ? pick((x) => x.full.images) : null,
  };
  out[name] = r;
  console.log(
    `${name.padEnd(15)} LCP ${String(r.lcp).padStart(5)} ms · FCP ${String(r.fcp).padStart(5)} ms · load ${String(r.load).padStart(6)} ms · first view ${String(r.firstViewTotalKB).padStart(5)} KB (images ${r.firstViewImageKB} KB in ${r.firstViewImages}, JS ${r.jsKB} KB)` +
      (r.fullMenuImageKB !== null ? ` · whole menu images ${r.fullMenuImageKB} KB in ${r.fullMenuImages}` : ''),
  );
}
await browser.close();
mkdirSync('audit/perf/out', { recursive: true });
writeFileSync(`audit/perf/out/mobile-${LABEL}.json`, JSON.stringify(out, null, 1));
