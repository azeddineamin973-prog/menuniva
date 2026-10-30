import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { BASE, ORIGIN, PASSWORD, buildRestaurant, evidence, login, runId, shot, sql, type Built } from './support';

/** PHASE G — security & reliability, real server + DEMO database. Tests share one restaurant (serial). */
test.describe.configure({ mode: 'serial' });
const ev = evidence('phase-g');
let r: Built;
let ownerPage: Page;
let dish: { id: string; cents: number };
let tea: { id: string; cents: number };
let locSlug = '';
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const tokenOf = (href: string) => href.split('/').pop()!;
function order(api: APIRequestContext, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return api.post('/api/public/orders/table', { headers: { ...ORIGIN, ...headers }, data: body });
}
const cart = (qty = 1) => [{ productId: dish.id, quantity: qty, modifiers: [] }];
async function orderCount(tableLabel?: string) {
  const [x] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM "Order" o ${tableLabel ? `JOIN "RestaurantTable" t ON t.id = o."tableId" AND t.label = '${tableLabel}'` : ''} WHERE o."organizationId" = $1`,
    [r.orgId],
  );
  return x.n;
}

test.beforeAll(async ({ browser }) => {
  ownerPage = await (await browser.newContext()).newPage();
  r = await buildRestaurant(ownerPage, { label: 'Security', channels: ['Order at table (QR codes)', 'Takeaway / pickup'], dishes: [{ cat: 0, name: 'Tajine SEC (audit)', dine: '15,00', takeaway: '14,00' }, { cat: 1, name: 'Chá SEC (audit)', dine: '2,00', takeaway: '2,00' }], tables: '1-9' });
  const prods = await sql<{ id: string; cents: number }>(`SELECT p.id, cp."amountCents" AS cents FROM "MenuProduct" p JOIN "ChannelPrice" cp ON cp."productId" = p.id AND cp.channel = 'DINE_IN' WHERE p."organizationId" = $1 ORDER BY cents DESC`, [r.orgId]);
  [dish, tea] = prods;
  locSlug = (await sql<{ slug: string }>(`SELECT slug FROM "RestaurantLocation" WHERE id = $1`, [r.locationId]))[0].slug;
});

test('G1 price tampering: client-supplied prices, totals and foreign products are ignored or refused', async ({ request }) => {
  const qr = tokenOf(r.tableHrefs[0]);
  const ua = { 'user-agent': `g1-${runId()}` };
  const tampered = await order(request, { qrToken: qr, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: dish.id, quantity: 1, modifiers: [], unitPriceCents: 1, priceCents: 1, lineTotalCents: 1 }], totalCents: 1, subtotalCents: 1, discountCents: 1400 }, ua);
  const out: Record<string, unknown> = { tamperedStatus: tampered.status() };
  const [o] = await sql<{ subtotalCents: number; totalCents: number; discountCents: number; unit: number }>(`SELECT o."subtotalCents", o."totalCents", o."discountCents", i."unitPriceCents" AS unit FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o.id WHERE o."organizationId" = $1`, [r.orgId]);
  expect(o).toEqual({ subtotalCents: 1500, totalCents: 1500, discountCents: 0, unit: 1500 });
  out.storedOrder = o;
  const [foreign] = await sql<{ id: string }>(`SELECT p.id FROM "MenuProduct" p WHERE p."organizationId" <> $1 AND p.status = 'ACTIVE' LIMIT 1`, [r.orgId]);
  const cases: [string, unknown[]][] = [
    ['quantity 0', [{ productId: dish.id, quantity: 0, modifiers: [] }]],
    ['quantity -3', [{ productId: dish.id, quantity: -3, modifiers: [] }]],
    ['quantity 51', [{ productId: dish.id, quantity: 51, modifiers: [] }]],
    ['quantity 1.5', [{ productId: dish.id, quantity: 1.5, modifiers: [] }]],
    ['other restaurant product', [{ productId: foreign.id, quantity: 1, modifiers: [] }]],
    ['made-up modifier', [{ productId: dish.id, quantity: 1, modifiers: [{ optionId: 'fake-option', quantity: 1 }] }]],
    ['empty cart', []],
  ];
  for (const [name, items] of cases) {
    const res = await order(request, { qrToken: qr, idempotencyKey: randomUUID(), language: 'pt', items }, ua);
    out[name] = { status: res.status(), error: (await res.json()).error };
    expect(res.status()).toBe(422);
  }
  expect(await orderCount()).toBe(1);
  ev.add('G1', out);
});

test('G2 duplicate submission: same idempotency key ×6 in parallel → one order; double-click in the UI → one order', async ({ request, browser }) => {
  const qr = tokenOf(r.tableHrefs[1]);
  const key = randomUUID();
  const responses = await Promise.all(Array.from({ length: 6 }, () => order(request, { qrToken: qr, idempotencyKey: key, language: 'pt', items: cart() }, { 'user-agent': 'g2-same-device' })));
  const bodies = await Promise.all(responses.map(async (x) => ({ status: x.status(), ...(await x.json()) })));
  expect(new Set(bodies.map((b) => b.orderNumber)).size).toBe(1);
  expect(await orderCount('02')).toBe(1);
  const ctx = await browser.newContext({ userAgent: `g2-ui-${runId()}` });
  const g = await ctx.newPage();
  await g.goto(r.tableHrefs[2]);
  await g.getByTestId('customer-product').filter({ hasText: 'Tajine SEC' }).click();
  await g.getByTestId('add-to-cart').click();
  await g.getByTestId('view-cart').click();
  await expect(g.getByTestId('cart-total')).toHaveText('15,00 €');
  await g.getByTestId('submit-order').dblclick({ force: true });
  await g.getByTestId('submit-order').click({ force: true, timeout: 2000 }).catch(() => undefined);
  await expect(g).toHaveURL(/\/o\//);
  expect(await orderCount('03')).toBe(1);
  ev.add('G2', { parallelSameKey: bodies.map((b) => `${b.status}:#${b.orderNumber}:dup=${b.duplicate}`), uiTripleClickOrdersOnTable03: await orderCount('03') });
  await ctx.close();
});

test('G4 rate limiting: per device, shared Wi-Fi false positives, X-Forwarded-For spoofing', async ({ request }) => {
  const qr = tokenOf(r.tableHrefs[4]);
  const out: Record<string, unknown> = {};
  // (a) one device, 9 orders in 10 minutes
  const one: number[] = [];
  for (let i = 0; i < 9; i++) one.push((await order(request, { qrToken: qr, idempotencyKey: randomUUID(), language: 'pt', items: cart() }, { 'user-agent': 'g4-one-device' })).status());
  out.sameDevice = one;
  expect(one.slice(0, 8).every((s) => s === 201)).toBe(true);
  expect(one[8]).toBe(429);
  // (b) 9 different guests on the restaurant Wi-Fi (same public IP) with the same phone model / browser version
  const qr2 = tokenOf(r.tableHrefs[5]);
  const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
  const shared: number[] = [];
  for (let i = 0; i < 9; i++) shared.push((await order(request, { qrToken: qr2, idempotencyKey: randomUUID(), language: 'pt', items: cart() }, { 'user-agent': iphoneUA, 'x-forwarded-for': '203.0.113.10' })).status());
  out.nineDifferentGuestsSameWifiSamePhoneModel = shared;
  // (c) one attacker rotating X-Forwarded-For
  const qr3 = tokenOf(r.tableHrefs[6]);
  const spoof: number[] = [];
  for (let i = 0; i < 12; i++) spoof.push((await order(request, { qrToken: qr3, idempotencyKey: randomUUID(), language: 'pt', items: cart() }, { 'user-agent': 'g4-attacker', 'x-forwarded-for': `198.51.100.${i + 1}` })).status());
  out.oneAttackerRotatingXForwardedFor = spoof;
  out.note = 'login limits verified by tests/integration/login.test.ts (8 failures lock an email, 30 an IP); the per-IP key also comes from the untrusted X-Forwarded-For header';
  ev.add('G4', out);
});

test('G5 input validation and safe errors (including the pickup form message)', async ({ request, browser }) => {
  const out: Record<string, unknown> = {};
  const bad = await request.post('/api/public/orders/table', { headers: { ...ORIGIN, 'content-type': 'application/json' }, data: '{"qrToken": "abc", oops' });
  out.malformedJson = { status: bad.status(), body: await bad.text() };
  const huge = await request.post('/api/public/orders/table', { headers: { ...ORIGIN, 'user-agent': 'g5' }, data: { qrToken: tokenOf(r.tableHrefs[7]), idempotencyKey: randomUUID(), language: 'pt', items: cart(), notes: 'x'.repeat(5000) } });
  out.notes5000chars = { status: huge.status(), error: (await huge.json()).error };
  const sqlish = await request.post('/api/public/orders/table', { headers: { ...ORIGIN, 'user-agent': 'g5' }, data: { qrToken: "x' OR '1'='1' --", idempotencyKey: randomUUID(), language: 'pt', items: cart() } });
  out.sqlInjectionToken = { status: sqlish.status(), body: await sqlish.text() };
  const unknownRoute = await request.get('/api/dashboard/does-not-exist/orders/live?location=x');
  out.unknownTenantApi = { status: unknownRoute.status(), body: await unknownRoute.text() };
  for (const v of Object.values(out) as { body?: string }[]) if (v.body) expect(v.body).not.toMatch(/at \w+ \(|node_modules|prisma|stack/i);
  // XSS in kitchen notes is shown as text on the staff board
  const xss = '<img src=x onerror="window.__xss=1">';
  const x = await request.post('/api/public/orders/table', { headers: { ...ORIGIN, 'user-agent': 'g5-xss' }, data: { qrToken: tokenOf(r.tableHrefs[7]), idempotencyKey: randomUUID(), language: 'pt', items: cart(), notes: xss } });
  expect(x.status()).toBe(201);
  await ownerPage.goto(`/dashboard/${r.slug}/orders`);
  await expect(ownerPage.getByText(xss)).toBeVisible();
  out.xssExecuted = await ownerPage.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? 0);
  expect(out.xssExecuted).toBe(0);
  // Takeaway checkout without name/phone: which message does the guest see?
  const ctx = await browser.newContext({ userAgent: `g5-pickup-${runId()}` });
  const g = await ctx.newPage();
  await g.goto(`/r/${r.slug}/order/pickup`);
  await g.getByTestId('customer-product').filter({ hasText: 'Tajine SEC' }).click();
  await g.getByTestId('add-to-cart').click();
  await g.getByTestId('view-cart').click();
  await expect(g.getByTestId('cart-total')).toHaveText('14,00 €');
  const resp = g.waitForResponse((rr) => rr.url().endsWith('/api/public/orders/pickup'));
  await g.getByTestId('submit-order').click();
  const rr = await resp;
  const body = await rr.json();
  const shown = await g.getByTestId('cart-sheet').getByRole('alert').last().innerText();
  await shot(g, 'g5-pickup-missing-contact');
  out.pickupWithoutContact = { status: rr.status(), error: body.error, issuePaths: (body.issues ?? []).map((i: { path: string[] }) => i.path.join('.')), messageShownToGuest: shown };
  await ctx.close();
  ev.add('G5', out);
});

test('G6 file upload safety: SVG/HTML disguised as PNG refused; media served with nosniff', async () => {
  await ownerPage.goto(`/dashboard/${r.slug}/settings/branding`);
  const form = ownerPage.getByTestId('branding-form');
  const out: Record<string, string> = {};
  for (const [name, buf] of [['evil-svg.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')], ['page.png', Buffer.from('<!doctype html><script>alert(1)</script>')], ['5.5MB.png', Buffer.concat([PNG_1x1, Buffer.alloc(5.5 * 1024 * 1024)])]] as const) {
    await ownerPage.reload();
    await form.locator('#logo').setInputFiles({ name, mimeType: 'image/png', buffer: buf });
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert').first()).toBeVisible();
    out[name] = await form.getByRole('alert').first().innerText();
  }
  // A 7 MB photo (above the 6 MB server-action body limit)
  await ownerPage.reload();
  await form.locator('#logo').setInputFiles({ name: '7MB.png', mimeType: 'image/png', buffer: Buffer.concat([PNG_1x1, Buffer.alloc(7 * 1024 * 1024)]) });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert').first().or(ownerPage.getByText('Something went wrong'))).toBeVisible();
  out['7MB.png'] = (await ownerPage.getByText('Something went wrong').count()) ? 'whole page replaced by the generic error page "Something went wrong" (no "file too large" message)' : await form.getByRole('alert').first().innerText();
  await shot(ownerPage, 'g6-7mb-upload');
  await ownerPage.goto(`/dashboard/${r.slug}/settings/branding`);
  await ownerPage.reload();
  await form.locator('#logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  await ownerPage.goto(`/r/${r.slug}`);
  const src = await ownerPage.getByTestId('storefront').locator('header img').first().getAttribute('src');
  const media = await ownerPage.request.get(src!);
  out.servedContentType = media.headers()['content-type'];
  out.nosniff = media.headers()['x-content-type-options'];
  const trav = await ownerPage.request.get('/media/..%2F..%2F.env');
  out.pathTraversal = `${trav.status()} ${(await trav.text()).slice(0, 40)}`;
  expect(await trav.text()).not.toContain('DATABASE_URL');
  ev.add('G6', out);
});

test('G7 password and session security', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, r.email, PASSWORD);
  const cookie = (await ctx.cookies()).find((c) => c.name === 'mn_session')!;
  const [u] = await sql<{ passwordHash: string }>(`SELECT "passwordHash" FROM "User" WHERE email = $1`, [r.email]);
  const sessions = await sql<{ tokenHash: string }>(`SELECT s."tokenHash" FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u.email = $1`, [r.email]);
  const out = {
    hashAlgorithm: u.passwordHash.split('$')[1],
    passwordStoredInClear: u.passwordHash.includes(PASSWORD),
    cookie: { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, secure: cookie.secure, expiresInDays: Math.round((cookie.expires * 1000 - Date.now()) / 86400_000) },
    rawTokenStoredInDb: sessions.some((s) => s.tokenHash === cookie.value),
    replayAfterLogout: 0,
    weakPasswordSignup: '',
  };
  await p.goto(`/dashboard/${r.slug}`);
  await p.getByRole('button', { name: /Sign out|Terminar sessão/ }).first().click();
  await expect(p).toHaveURL(/\/login/);
  const replay = await browser.newContext();
  await replay.addCookies([{ ...cookie }]);
  const rp = await replay.newPage();
  const res = await rp.request.get(`/api/dashboard/${r.slug}/orders/live?location=${r.locationId}`);
  out.replayAfterLogout = res.status();
  expect(res.status()).toBe(401);
  await rp.goto('/signup');
  await rp.getByLabel('Nome completo').fill('Weak');
  await rp.getByLabel('Email').fill(`weak.${runId()}@audit.menuniva.invalid`);
  await rp.getByLabel('Palavra-passe').fill('short');
  await rp.getByRole('button', { name: 'Criar conta' }).click();
  out.weakPasswordSignup = rp.url();
  await replay.close();
  await ctx.close();
  expect(out.hashAlgorithm).toBe('argon2id');
  expect(out.rawTokenStoredInDb).toBe(false);
  ev.add('G7', out);
});

test('G8 private customer data: tracking pages and public APIs expose no phone/address; tokens are not guessable', async ({ request, browser }) => {
  const ctx = await browser.newContext({ userAgent: `g8-${runId()}` });
  const g = await ctx.newPage();
  await g.goto(`/r/${r.slug}/order/pickup`);
  await g.getByTestId('customer-product').filter({ hasText: 'Tajine SEC' }).click();
  await g.getByTestId('add-to-cart').click();
  await g.getByTestId('view-cart').click();
  await g.getByLabel('O seu nome').fill('Audit Private Guest');
  await g.getByLabel('Telefone').fill('+351 966 000 208');
  await g.getByTestId('submit-order').click();
  await expect(g).toHaveURL(/\/o\//);
  const token = tokenOf(g.url());
  const html = await (await request.get(`/o/${token}`)).text();
  const api = await (await request.get(`/api/public/orders/${token}`)).text();
  const guess = await request.get(`/o/${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`);
  const out = { pageContainsPhone: /966\s?000\s?208/.test(html), apiContainsPhone: /966\s?000\s?208/.test(api), apiContainsName: api.includes('Audit Private Guest'), guessedTokenStatus: guess.status() };
  expect(out.pageContainsPhone || out.apiContainsPhone).toBe(false);
  ev.add('G8', out);
  await ctx.close();
});

test('G9 network interruption during ordering: never lost silently, never duplicated', async ({ browser }) => {
  const out: Record<string, unknown> = {};
  async function openCart(label: string, href: string) {
    const ctx = await browser.newContext({ userAgent: `g9-${label}-${runId()}` });
    const g = await ctx.newPage();
    await g.goto(href);
    await g.getByTestId('customer-product').filter({ hasText: 'Chá SEC' }).click();
    await g.getByTestId('add-to-cart').click();
    await g.getByTestId('view-cart').click();
    await expect(g.getByTestId('cart-total')).toHaveText('2,00 €');
    return { ctx, g };
  }
  // (a) request never reaches the server (all 3 automatic attempts fail) → clear error, nothing stored; retry later → exactly one order
  const tA = r.tableHrefs[8];
  const a = await openCart('a', tA);
  await a.g.route('**/api/public/orders/table', (route) => route.abort('internetdisconnected'));
  await a.g.getByTestId('submit-order').click();
  await expect(a.g.getByTestId('cart-sheet').getByRole('alert')).toBeVisible({ timeout: 20_000 });
  out.a_messageWhileOffline = await a.g.getByTestId('cart-sheet').getByRole('alert').innerText();
  out.a_ordersWhileOffline = await orderCount('09');
  expect(out.a_ordersWhileOffline).toBe(0);
  await a.g.unroute('**/api/public/orders/table');
  await a.g.getByTestId('submit-order').click();
  await expect(a.g).toHaveURL(/\/o\//);
  out.a_ordersAfterRetry = await orderCount('09');
  expect(out.a_ordersAfterRetry).toBe(1);
  await a.ctx.close();

  // (b) server commits the order but the response is lost → automatic retry with the same key → one order, guest reaches tracking
  const before = await orderCount('01');
  const b = await openCart('b', r.tableHrefs[0]);
  let first = true;
  await b.g.route('**/api/public/orders/table', async (route) => {
    if (!first) return route.continue();
    first = false;
    await route.fetch(); // reaches the server, order committed
    await route.abort('connectionreset'); // …but the phone never gets the answer
  });
  await b.g.getByTestId('submit-order').click();
  await expect(b.g).toHaveURL(/\/o\//, { timeout: 20_000 });
  out.b_ordersAdded = (await orderCount('01')) - before;
  expect(out.b_ordersAdded).toBe(1);
  await b.ctx.close();

  // (c) committed, then every response lost, guest reloads the page later and taps again
  const before2 = await orderCount('01');
  const c = await openCart('c', r.tableHrefs[0]);
  await c.g.route('**/api/public/orders/table', async (route) => {
    await route.fetch();
    await route.abort('connectionreset');
  });
  await c.g.getByTestId('submit-order').click();
  await expect(c.g.getByTestId('cart-sheet').getByRole('alert')).toBeVisible({ timeout: 20_000 });
  out.c_messageShown = await c.g.getByTestId('cart-sheet').getByRole('alert').innerText();
  out.c_ordersStoredMeanwhile = (await orderCount('01')) - before2;
  await c.g.unroute('**/api/public/orders/table');
  await c.g.reload();
  await c.g.getByTestId('view-cart').click();
  await c.g.getByTestId('submit-order').click();
  await expect(c.g).toHaveURL(/\/o\//);
  out.c_ordersAfterReloadAndRetry = (await orderCount('01')) - before2;
  await shot(c.g, 'g9-after-retry');
  await c.ctx.close();
  ev.add('G9', out);
  expect(out.c_ordersAfterReloadAndRetry).toBe(1);
});

test('G10 Uber Eats link message (checked alone)', async () => {
  await ownerPage.goto(`/dashboard/${r.slug}/import`);
  await ownerPage.getByTestId('new-import-form').getByRole('button', { name: 'Start a new import' }).click();
  const form = ownerPage.getByTestId('add-source-form');
  await form.getByLabel('Source').selectOption('UBER_EATS');
  await form.getByLabel('Store link (for reference)').fill('https://www.ubereats.com/pt/store/audit-demo');
  await form.getByRole('button', { name: 'Read this source' }).click();
  const msg = await form.getByRole('alert').innerText();
  ev.add('G10-uber-only', msg);
  expect(msg).toContain('Uber Eats');
});

test('G3 concurrent orders: 12 guests order on one fresh table at the same moment', async ({ request }) => {
  const qr = tokenOf(r.tableHrefs[3]);
  const res = await Promise.all(Array.from({ length: 12 }, (_, i) => order(request, { qrToken: qr, idempotencyKey: randomUUID(), language: 'pt', items: cart() }, { 'user-agent': `g3-phone-${i}` })));
  const statuses = res.map((x) => x.status());
  const numbers = await sql<{ number: number }>(`SELECT o.number FROM "Order" o JOIN "RestaurantTable" t ON t.id = o."tableId" WHERE t.label = '04' AND o."organizationId" = $1 ORDER BY 1`, [r.orgId]);
  const [all] = await sql<{ n: number; distinct: number }>(`SELECT count(*)::int AS n, count(DISTINCT number)::int AS distinct FROM "Order" WHERE "organizationId" = $1`, [r.orgId]);
  const sessions = await sql<{ id: string; orders: number }>(`SELECT s.id, (SELECT count(*)::int FROM "Order" o WHERE o."tableSessionId" = s.id) AS orders FROM "TableSession" s JOIN "RestaurantTable" t ON t.id = s."tableId" WHERE t.label = '04' AND s."organizationId" = $1 AND s.status = 'OPEN'`, [r.orgId]);
  ev.add('G3', { statuses, orderNumbersOnTable04: numbers.map((n) => n.number), allOrders: all, openSessionsForTable04: sessions });
  expect.soft(statuses.filter((s) => s === 201).length, '12 concurrent guests should all get their order').toBe(12);
  expect(all.n).toBe(all.distinct); // order numbers never collide
  expect.soft(numbers).toHaveLength(12);
  // One table should have exactly one open session (one bill). Recorded, asserted at the end.
  expect.soft(sessions.length, 'open table sessions for one table after concurrent first orders').toBe(1);
});
