// Responsive crawler for the UX audit (2026-10-31). Visits every discovered route as the right
// role at each audit width against the isolated audit server (audit/ux/server.mjs) and records
// overflow, clipped controls, small tap targets, broken images, console/page errors, failed
// requests and layout shift. Screenshots go to audit/artifacts/ux/<run>/ (git-ignored).
//   node audit/ux/crawl.mjs [--run before] [--widths 375,1440] [--only /dashboard] [--no-shots]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://localhost:3300');
const RUN = arg('run', 'before');
const WIDTHS = arg('widths', '320,375,390,430,768,1024,1440,1920').split(',').map(Number);
const ONLY = arg('only', '');
const SHOTS = !process.argv.includes('--no-shots');
const DARK = process.argv.includes('--dark');
const HEIGHT = { 320: 640, 375: 812, 390: 844, 430: 932, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 };
const OUT = path.resolve('audit/artifacts/ux', RUN);
mkdirSync(OUT, { recursive: true });

const seed = JSON.parse(readFileSync('audit/ux/out/seed.json', 'utf8'));
const ids = JSON.parse(readFileSync('audit/ux/out/ids.json', 'utf8'));
const org = `/dashboard/${seed.slug}`;

/** [role, path] — every page.tsx under src/app (see audit/ux/README.md for the mapping). */
const ROUTES = [
  ['anon', '/'],
  ['anon', '/login'],
  ['anon', '/signup'],
  ['anon', '/forgot-password'],
  ['anon', '/reset-password/not-a-real-token-000000000000'],
  ['anon', '/setup?token=not-a-real-token'],
  ['anon', '/invite/not-a-real-token-000000000000'],
  ['anon', `/r/${seed.slug}`],
  ['anon', `/r/${seed.slug}/centro`],
  ['anon', `/r/${seed.slug}/order/pickup`],
  ['anon', `/r/${seed.slug}/order/delivery`],
  ['anon', `/r/${seed.slug}/reserve`],
  ['anon', `/r/${seed.slug}/feedback`],
  ['anon', `/t/${seed.tables[0]}`],
  ['anon', `/t/${seed.tables[0]}?lang=ar`],
  ['anon', `/o/${seed.tracking.newOrder}`],
  ['anon', `/o/${seed.tracking.preparing}`],
  ['anon', `/o/${seed.tracking.completed}`],
  ['anon', `/o/${seed.tracking.pickup}`],
  ['anon', `/o/${seed.tracking.delivery}`],
  ['anon', `/reservation/${seed.reservationTokens[0]}`],
  ['owner', '/dashboard?choose=1'],
  ['owner', '/account'],
  ['owner', '/onboarding/new'],
  ['owner', `${org}`],
  ['owner', `${org}/orders`],
  ['owner', `${org}/tasks`],
  ['owner', `${org}/kitchen`],
  ['owner', `${org}/kitchen/${seed.kitchenStationId}`],
  ['owner', `${org}/kitchen/tickets/${ids.ticketId}/print`],
  ['owner', `${org}/tables`],
  ['owner', `${org}/tables/print`],
  ['owner', `${org}/bills`],
  ['owner', `${org}/bills/${ids.sessionId}`],
  ['owner', `${org}/bills/${ids.sessionId}/receipt`],
  ['owner', `${org}/reservations`],
  ['owner', `${org}/menu`],
  ['owner', `${org}/menu/products/new`],
  ['owner', `${org}/menu/products/${seed.productIds.tajine}`],
  ['owner', `${org}/menu/products/${seed.productIds.draft}`],
  ['owner', `${org}/menu/categories/${seed.categoryId}`],
  ['owner', `${org}/menu/quick`],
  ['owner', `${org}/menu/translations`],
  ['owner', `${org}/menu/upsell`],
  ['owner', `${org}/import`],
  ['owner', `${org}/import/${seed.importJobId}`],
  ['owner', `${org}/stations`],
  ['owner', `${org}/promotions`],
  ['owner', `${org}/takeaway`],
  ['owner', `${org}/delivery`],
  ['owner', `${org}/reviews`],
  ['owner', `${org}/loyalty`],
  ['owner', `${org}/analytics`],
  ['owner', `${org}/staff`],
  ['owner', `${org}/settings`],
  ['owner', `${org}/settings/branding`],
  ['owner', `${org}/settings/channels`],
  ['owner', `${org}/settings/privacy`],
  ['owner', `${org}/settings/tax`],
  ['owner', `${org}/setup`],
  ['owner', `${org}/preview`],
  ['owner', `${org}/setup/preview`],
  ['owner', `${org}/setup/publish`],
  ['owner', `${org}/subscription`],
  ['owner', `${org}/support`],
  ['owner', `${org}/forbidden`],
  ['owner', `${org}/unavailable?module=promotions`],
  ['newowner', `/dashboard/${seed.secondSlug}`],
  ['newowner', `/dashboard/${seed.secondSlug}/setup`],
  ['newowner', `/dashboard/${seed.secondSlug}/preview`],
  ['anon', `/r/${seed.secondSlug}`],
  ['newowner', `/dashboard/${seed.secondSlug}/menu`],
  ['newowner', `/dashboard/${seed.secondSlug}/orders`],
  ['kitchen', `${org}/kitchen`],
  ['kitchen', `${org}/kitchen/${seed.kitchenStationId}`],
  ['driver', `${org}/driver`],
  ['waiter', `${org}/tasks`],
  ['waiter', `${org}/orders`],
  ['admin', '/admin'],
  ['admin', `/admin/tenants/${seed.orgId}`],
  ['admin', '/admin/tenants/new'],
  ['admin', '/admin/plans'],
  ['admin', '/admin/settings'],
  ['admin', '/admin/support'],
  ['admin', '/admin/audit'],
  ['admin', '/admin/health'],
].filter(([role, p]) => !ONLY || ONLY.split('|').some((o) => (o.startsWith('@') ? role === o.slice(1) : o.endsWith('$') ? p === o.slice(0, -1) : p.startsWith(o) || p.includes(o))));

const LOGIN = { owner: seed.owner, newowner: seed.newOwner, admin: seed.admin, kitchen: seed.staff.KITCHEN_STAFF, driver: seed.staff.DELIVERY_STAFF, waiter: seed.staff.WAITER };

/** Runs inside the page: collects layout problems. */
function inspect(deviceWidth) {
  // On a phone (isMobile), content wider than the screen makes the browser zoom the whole page
  // out: innerWidth then grows past the device width. Measure against the real screen width.
  const vw = deviceWidth;
  const doc = document.documentElement;
  const out = { scrollWidth: Math.max(doc.scrollWidth, window.innerWidth), innerWidth: window.innerWidth, vw, overflowers: [], clippedControls: [], small: [], brokenImages: [], distorted: [], unlabeled: [], tinyText: 0 };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const tid = el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : '';
    const cls = typeof el.className === 'string' ? `.${el.className.split(/\s+/).filter(Boolean).slice(0, 4).join('.')}` : '';
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${tid}${cls} "${text}"`;
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Is the element inside a horizontally scrollable/clipping container (intended)?
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) return true;
    }
    return false;
  };
  const all = [...document.body.querySelectorAll('*')];
  for (const el of all) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !clippedByAncestor(el) && getComputedStyle(el).position !== 'fixed') {
      // Report the outermost offender only.
      const parent = el.parentElement;
      const pr = parent?.getBoundingClientRect();
      if (!pr || (pr.right <= vw + 1 && pr.left >= -1)) out.overflowers.push(`${describe(el)} [${Math.round(r.left)}→${Math.round(r.right)}]`);
    }
  }
  // Labels of text fields are not targets themselves; checkbox/radio labels are measured below.
  const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary')].filter((el) => !el.classList.contains('sr-only'));
  for (const el of controls) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    // WCAG 2.5.8 exempts links inside a sentence/paragraph.
    const inline = tag === 'a' && getComputedStyle(el).display === 'inline' && (el.parentElement?.textContent?.trim().length ?? 0) > (el.textContent?.trim().length ?? 0) + 3;
    const target = el.closest('label') && (el.type === 'checkbox' || el.type === 'radio') ? el.closest('label').getBoundingClientRect() : r;
    if (!inline && (target.height < 24 || target.width < 24)) out.small.push({ fail: true, d: `${describe(el)} ${Math.round(target.width)}×${Math.round(target.height)}` });
    else if (!inline && tag !== 'a' && target.height < 40 && vw <= 430 && !['checkbox', 'radio'].includes(el.type)) out.small.push({ fail: false, d: `${describe(el)} ${Math.round(target.width)}×${Math.round(target.height)}` });
    if ((tag === 'button' || (tag === 'a' && /inline-flex|flex/.test(getComputedStyle(el).display))) && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.clippedControls.push(describe(el));
    if (['input', 'select', 'textarea'].includes(tag) && !['submit', 'button', 'checkbox', 'radio', 'file'].includes(el.type)) {
      const labelled = el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
      if (!labelled) out.unlabeled.push(describe(el));
    }
  }
  for (const img of document.images) {
    if (!visible(img)) continue;
    if (img.complete && img.naturalWidth === 0) out.brokenImages.push(img.currentSrc || img.src);
    else if (img.naturalWidth) {
      const r = img.getBoundingClientRect();
      const fit = getComputedStyle(img).objectFit;
      const ratioDiff = Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) / (img.naturalWidth / img.naturalHeight);
      if (fit === 'fill' && ratioDiff > 0.05 && r.width > 20) out.distorted.push(`${img.src.slice(-40)} box ${Math.round(r.width)}×${Math.round(r.height)} natural ${img.naturalWidth}×${img.naturalHeight}`);
    }
  }
  if (vw <= 430) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement)) continue;
      if (parseFloat(getComputedStyle(n.parentElement).fontSize) < 11) out.tinyText++;
    }
  }
  out.cls = window.__cls ?? 0;
  out.title = document.title;
  out.h1 = [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()).slice(0, 2);
  return out;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const states = {};
async function stateFor(role) {
  if (role === 'anon') return undefined;
  if (states[role]) return states[role];
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByTestId('login-form').locator('input[name=email]').fill(LOGIN[role]);
  await page.getByTestId('login-form').locator('input[name=password]').fill(seed.password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  states[role] = await ctx.storageState();
  await ctx.close();
  return states[role];
}

const results = [];
for (const width of WIDTHS) {
  // Phones and tablets (iPad portrait/landscape) are touch devices; 1440/1920 are mouse desktops.
  const mobile = width <= 1024;
  const byRole = {};
  for (const [role, route] of ROUTES) {
    if (!byRole[role]) {
      byRole[role] = await browser.newContext({ baseURL: BASE, viewport: { width, height: HEIGHT[width] ?? 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, storageState: await stateFor(role) });
      if (DARK) await byRole[role].addCookies([{ name: 'mn_theme', value: 'dark', url: BASE }]);
      await byRole[role].addInitScript(() => {
        window.__cls = 0;
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {}
      });
    }
    const page = await byRole[role].newPage();
    const consoleErrors = [];
    const failed = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
    page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message.slice(0, 200)}`));
    page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
    page.on('requestfailed', (r) => !/ERR_ABORTED/.test(r.failure()?.errorText ?? '') && failed.push(`FAILED ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
    let status = 0;
    let finalUrl = '';
    let data = null;
    const t0 = Date.now();
    try {
      const res = await page.goto(route, { waitUntil: 'load', timeout: 45_000 });
      status = res?.status() ?? 0;
      await page.waitForTimeout(700);
      finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
      data = await page.evaluate(inspect, width);
      if (SHOTS) {
        const name = `${width}_${role}_${route.replace(/^\//, '').replace(/[/?=&]+/g, '_').slice(0, 90) || 'home'}.png`;
        await page.screenshot({ path: path.join(OUT, name), fullPage: true, clip: undefined, timeout: 30_000 }).catch(() => {});
        data.shot = name;
      }
    } catch (e) {
      consoleErrors.push(`NAVIGATION ${e.message.slice(0, 160)}`);
    }
    results.push({ width, role, route, status, finalUrl, ms: Date.now() - t0, consoleErrors, failed: [...new Set(failed)], ...data });
    await page.close();
    const d = data ?? {};
    const flags = [
      d.scrollWidth > d.vw + 1 ? `OVERFLOW+${d.scrollWidth - d.vw}` : '',
      d.small?.filter((s) => s.fail).length ? `TAP<24:${d.small.filter((s) => s.fail).length}` : '',
      d.clippedControls?.length ? `CLIP:${d.clippedControls.length}` : '',
      d.brokenImages?.length ? `BROKENIMG:${d.brokenImages.length}` : '',
      consoleErrors.length ? `CONSOLE:${consoleErrors.length}` : '',
      failed.length ? `HTTP:${failed.length}` : '',
      d.cls > 0.1 ? `CLS:${d.cls.toFixed(2)}` : '',
    ].filter(Boolean);
    console.log(`${width} ${role.padEnd(8)} ${String(status).padEnd(3)} ${route.slice(0, 70).padEnd(70)} ${flags.join(' ')}`);
  }
  for (const c of Object.values(byRole)) await c.close();
}
await browser.close();
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length} page views → ${path.relative(process.cwd(), OUT)}/results.json`);
