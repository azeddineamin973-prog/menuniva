// Every request of one cold page load on the throttled phone (same profile as mobile.mjs).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8').split('\n').reverse().find((l) => l.startsWith('{')));
const path = (process.argv[2] ?? '/r/{slug}').replace('{slug}', seed.slug).replace('{table}', seed.tables[0]);
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const req = new Map();
cdp.on('Network.requestWillBeSent', (e) => req.set(e.requestId, { url: e.request.url, t0: e.timestamp, prio: e.request.initialPriority }));
cdp.on('Network.responseReceived', (e) => { const r = req.get(e.requestId); if (r) r.type = e.type; });
cdp.on('Network.loadingFinished', (e) => { const r = req.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; } });
let start;
cdp.on('Network.requestWillBeSent', (e) => (start ??= e.timestamp));
await page.goto(`http://localhost:3300${path}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(1500);
const lcp = await page.evaluate(() => new Promise((r) => new PerformanceObserver((l) => { const e = l.getEntries().at(-1); r({ t: Math.round(e.startTime), el: e.element?.tagName + ' ' + (e.element?.currentSrc ?? e.element?.textContent ?? '').slice(-60) }); }).observe({ type: 'largest-contentful-paint', buffered: true })));
console.log(`${path}  LCP ${lcp.t} ms → ${lcp.el}`);
for (const r of [...req.values()].filter((r) => r.bytes).sort((a, b) => a.t0 - b.t0))
  console.log(`${String(Math.round((r.t0 - start) * 1000)).padStart(6)}–${String(Math.round((r.t1 - start) * 1000)).padStart(5)} ms ${String(Math.round(r.bytes / 1024)).padStart(5)} KB ${(r.type ?? '').padEnd(10)} ${(r.prio ?? '').padEnd(8)} ${r.url.replace('http://localhost:3300', '').slice(-80)}`);
await browser.close();
