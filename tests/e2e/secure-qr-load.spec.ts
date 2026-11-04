import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, seed, sql, type Seed } from './helpers';

/**
 * Twelve phones at one SESSION_PIN table send their first order at the same moment (final QA).
 *
 * Twelve real phones each render their own page on their own processor. Twelve rendered browser
 * pages on the test machine instead share its processor with the server and the database, and their
 * animations alone slowed the server several times over (IMPLEMENTATION-REPORT.md §0.2). So here every
 * phone is its own browser context (its own cookies, its own guest identity, its own PIN
 * authorisation), but only three phones are driven through the real page; the other nine send exactly
 * what the page sends (enter the PIN, then the order, with the page's retry policy) from their context's
 * network stack, without rendering. The server sees the same twelve simultaneous enrolments and orders.
 *
 * Checked for every phone: a definitive answer within the same 15 s as restaurant-wifi.spec.ts, the
 * confirmation (rendered phones) or its own order through the tracking API (the others), and in the
 * database exactly one correct order per phone, one seating, one authorised device per phone, and no
 * kitchen ticket before staff approve.
 */
const PHONE = { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' };
const ORIGIN = { Origin: 'http://localhost:3100' };
const BUDGET_MS = 15_000;
let s: Seed;
test.beforeAll(async () => {
  s = seed(`sqrl${Date.now()}`);
  await sql(`UPDATE "RestaurantLocation" SET "tableOrderingPolicy" = 'SESSION_PIN' WHERE id = $1`, [s.locationId]);
});

/** What cart-sheet.tsx does on "send": enter the PIN once, then post the order (3 attempts, same key). */
async function sendLikeThePage(api: APIRequestContext, pin: string) {
  const join = await api.post('/api/public/table-session/join', { headers: ORIGIN, data: { qrToken: s.qrToken, pin } });
  if (!join.ok()) return { kind: 'refused' as const, status: join.status(), statuses: [join.status()] };
  const body = { qrToken: s.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: s.plainDishId, quantity: 1, modifiers: [] }] };
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await api.post('/api/public/orders/table', { headers: ORIGIN, data: body, timeout: 60_000 }).catch(() => null);
    statuses.push(r?.status() ?? 0);
    if (r && r.ok()) return { kind: 'ok' as const, token: (await r.json()).trackingToken as string, statuses };
    if (r && r.status() < 500) return { kind: 'refused' as const, status: r.status(), statuses };
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  return { kind: 'unknown' as const, statuses };
}

test('12 phones at one SESSION_PIN table send at once: each one order, confirmed, nothing to the kitchen before approval', async ({ browser }) => {
  test.setTimeout(180_000);
  // Staff open the table and read its PIN.
  const staff = await browser.newContext();
  const waiter = await staff.newPage();
  await login(waiter, s.waiter, s.password);
  await waiter.goto(`/dashboard/${s.orgSlug}/tables`);
  await waiter.getByTestId('open-table').click();
  await waiter.getByTestId('table-pin-07-show').click();
  const pin = (await waiter.getByTestId('table-pin-07-value').innerText()).trim();
  expect(pin).toMatch(/^\d{6}$/);

  // Twelve phones scan the QR (each gets its own guest cookie from the menu page).
  const phones: BrowserContext[] = await Promise.all(Array.from({ length: 12 }, () => browser.newContext(PHONE)));
  const pages: Page[] = await Promise.all(phones.map((c) => c.newPage()));
  await Promise.all(pages.map((p) => p.goto(`/t/${s.qrToken}`)));
  expect(new Set((await Promise.all(phones.map(async (c) => (await c.cookies()).find((k) => k.name === 'mn_guest')?.value)))).size).toBe(12);
  const rendered = pages.slice(0, 3);
  // The other nine stop rendering; their context keeps its cookies and sends like the page.
  await Promise.all(pages.slice(3).map((p) => p.close()));
  for (const p of rendered) {
    await p.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
    await p.getByTestId('add-to-cart').click();
    await p.getByTestId('view-cart').click();
    await expect(p.getByTestId('cart-total')).toHaveText('6,50 €');
    await p.getByTestId('table-pin-input').fill(pin);
  }

  const t0 = Date.now();
  const [ui, net] = await Promise.all([
    Promise.all(
      rendered.map(async (p) => {
        await p.getByTestId('submit-order').click();
        await expect(p).toHaveURL(/\/o\//, { timeout: BUDGET_MS });
        await expect(p.getByTestId('order-status')).toHaveAttribute('data-status', 'NEW');
        await expect(p.getByTestId('order-number')).toBeVisible();
        return { ms: Date.now() - t0, token: new URL(p.url()).pathname.split('/').pop()! };
      }),
    ),
    Promise.all(phones.slice(3).map(async (c) => ({ ...(await sendLikeThePage(c.request, pin)), ms: Date.now() - t0 }))),
  ]);

  console.log(`[load] ${JSON.stringify({ renderedConfirmedMs: ui.map((r) => r.ms), networkAnsweredMs: net.map((r) => r.ms), networkStatuses: net.map((r) => r.statuses.join('>')) })}`);
  // Every phone got a definitive, correct answer within the budget.
  expect(net.map((r) => r.kind)).toEqual(Array(9).fill('ok'));
  expect(Math.max(...ui.map((r) => r.ms), ...net.map((r) => r.ms))).toBeLessThan(BUDGET_MS);
  const tokens = [...ui.map((r) => r.token), ...net.map((r) => (r.kind === 'ok' ? r.token : ''))];
  expect(new Set(tokens).size).toBe(12);
  // Each phone's tracking link shows its own order, waiting for staff.
  const tracked = await Promise.all(tokens.map(async (token, i) => (await phones[i].request.get(`/api/public/orders/${token}`)).json()));
  expect(tracked.map((o) => [o.status, o.totalCents])).toEqual(Array(12).fill(['NEW', 650]));
  expect(new Set(tracked.map((o) => o.number)).size).toBe(12);

  // Database: exactly one correct order per phone, one seating, one authorised phone each, no ticket yet.
  const [db] = await sql<{ n: number; sessions: number; devices: number; numbers: number; wrong: number; alerts: number; tickets: number; claims: number }>(
    `SELECT count(*)::int AS n, count(DISTINCT "tableSessionId")::int AS sessions, count(DISTINCT "tableSessionDeviceId")::int AS devices,
            count(DISTINCT number)::int AS numbers, count(*) FILTER (WHERE "totalCents" <> 650 OR status <> 'NEW')::int AS wrong,
            (SELECT count(*)::int FROM "Notification" n WHERE n."organizationId" = $1 AND n.type = 'NEW_ORDER') AS alerts,
            (SELECT count(*)::int FROM "KitchenTicket" k WHERE k."organizationId" = $1) AS tickets,
            (SELECT count(*)::int FROM "TablePendingClaim") AS claims
       FROM "Order" WHERE "organizationId" = $1`,
    [s.orgId],
  );
  expect(db).toEqual({ n: 12, sessions: 1, devices: 12, numbers: 12, wrong: 0, alerts: 12, tickets: 0, claims: 0 });
  await Promise.all([...phones, staff].map((c) => c.close()));
});
