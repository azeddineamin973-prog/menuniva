import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { seed, sql, type Seed } from './helpers';

/**
 * Audit BUG-05 (browser): 12 guests on the same restaurant Wi-Fi with the same phone model order at
 * the same time — every order goes through. A spoofed X-Forwarded-For header does not help one
 * client get around its limit (this server trusts no proxy: TRUST_PROXY_HOPS unset).
 */
let s: Seed;
test.beforeAll(() => {
  s = seed(`wifi${Date.now()}`);
});
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const ORIGIN = { Origin: 'http://localhost:3100' };

test('12 phones of the same model on one Wi-Fi order at the same moment; each gets its own guest cookie', async ({ browser }) => {
  const guests = await Promise.all(Array.from({ length: 12 }, () => browser.newContext({ userAgent: IPHONE, viewport: { width: 390, height: 844 } })));
  const pages = await Promise.all(guests.map((c) => c.newPage()));
  await Promise.all(pages.map((p) => p.goto(`/t/${s.qrToken}`)));
  const cookies = await Promise.all(guests.map(async (c) => (await c.cookies()).find((k) => k.name === 'mn_guest')));
  expect(cookies.every((c) => c?.httpOnly && c.sameSite === 'Lax')).toBe(true);
  expect(new Set(cookies.map((c) => c!.value)).size).toBe(12);
  for (const p of pages) {
    await p.getByTestId('customer-product').filter({ hasText: 'Seed harira' }).click();
    await p.getByTestId('add-to-cart').click();
    await p.getByTestId('view-cart').click();
    await expect(p.getByTestId('cart-total')).toHaveText('6,50 €');
  }
  await Promise.all(pages.map((p) => p.getByTestId('submit-order').click()));
  await Promise.all(pages.map((p) => expect(p).toHaveURL(/\/o\//)));
  const [n] = await sql<{ n: number; sessions: number }>(`SELECT count(*)::int AS n, count(DISTINCT "tableSessionId")::int AS sessions FROM "Order" WHERE "organizationId" = $1`, [s.orgId]);
  expect(n).toEqual({ n: 12, sessions: 1 });
  await Promise.all(guests.map((c) => c.close()));
});

test('rotating X-Forwarded-For does not reset one client’s limit', async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: 'http://localhost:3100', extraHTTPHeaders: { Cookie: 'mn_guest=SpoofTestGuestCookie00', 'User-Agent': IPHONE } });
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await api.post('/api/public/orders/table', { headers: { ...ORIGIN, 'X-Forwarded-For': `198.51.100.${i + 1}` }, data: { qrToken: s.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: s.plainDishId, quantity: 1, modifiers: [] }] } });
    statuses.push(r.status());
  }
  expect(statuses.slice(0, 10).every((x) => x === 201)).toBe(true);
  expect(statuses.slice(10)).toEqual([429, 429]);
  await api.dispose();
});
