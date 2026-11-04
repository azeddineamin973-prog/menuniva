import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { login, seed, type Seed } from './helpers';

let s: Seed;
test.beforeAll(() => {
  s = seed(`lo${Date.now()}`);
});

const ORIGIN = { Origin: 'http://localhost:3100' };

async function guestOrder(request: APIRequestContext) {
  const r = await request.post('/api/public/orders/table', {
    headers: ORIGIN,
    data: { qrToken: s.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: s.plainDishId, quantity: 1, modifiers: [] }] },
  });
  return r;
}

test('M7-05: new orders trigger visual + sound + browser notification; persistent until seen; mute persists', async ({ page, request }) => {
  // Record sound and notifications (they cannot be heard in a headless browser).
  await page.addInitScript(() => {
    const w = window as unknown as { __chimes: number; __notes: string[] };
    w.__chimes = 0;
    w.__notes = [];
    class FakeAudio {
      currentTime = 0;
      destination = {};
      createOscillator() {
        return { frequency: {}, type: '', connect: (g: unknown) => g, start: () => w.__chimes++, stop: () => {} };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
      }
      close() {}
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudio;
    (window as unknown as { Notification: unknown }).Notification = class {
      static permission = 'granted';
      static requestPermission() {
        return Promise.resolve('granted');
      }
      constructor(_t: string, o: { body: string }) {
        w.__notes.push(o.body);
      }
    };
  });
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  await page.getByRole('button', { name: /Enable sound/ }).click();
  const baseline = await page.evaluate(() => (window as unknown as { __chimes: number }).__chimes);

  const r = await guestOrder(request);
  expect(r.status()).toBe(201);
  const card = page.getByTestId('column-new').getByTestId('order-card');
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('sidebar').getByTestId('nav-badge-liveOrders')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chimes: number }).__chimes)).toBeGreaterThan(baseline);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notes: string[] }).__notes.length)).toBeGreaterThan(0);
  await expect(page).toHaveTitle(/^\(1\)/);

  // Still NEW, highlighted and counted after a reload: only Accept or Reject ends that (no "Seen").
  await page.reload();
  await expect(page.getByTestId('sidebar').getByTestId('nav-badge-liveOrders')).toHaveText('1');
  await expect(card).toHaveCount(1);
  await expect(page).toHaveTitle(/^\(1\)/);
  await expect(card.getByRole('button', { name: 'Seen' })).toHaveCount(0);
  await expect(card.getByTestId('action-ACCEPTED')).toBeVisible();

  // Mute is remembered on this device
  await page.getByRole('button', { name: /Enable sound/ }).click();
  await page.getByRole('button', { name: /Mute alerts/ }).click();
  await page.reload();
  await page.getByRole('button', { name: /Enable sound/ }).click();
  await expect(page.getByRole('button', { name: /Alerts muted/ })).toBeVisible();
});

test('M7-05b: a NEW order waits on every device until one person accepts it; the other device follows and the counts agree', async ({ browser, request }) => {
  const devices = await Promise.all([browser.newContext(), browser.newContext()]);
  const [owner, waiter] = await Promise.all(devices.map((c) => c.newPage()));
  await login(owner, s.owner, s.password);
  await login(waiter, s.waiter, s.password);
  for (const p of [owner, waiter]) {
    await p.goto(`/dashboard/${s.orgSlug}/orders`);
    await expect(p.getByTestId('connection-status')).toHaveAttribute('data-state', 'live');
  }
  const waitingBefore = await owner.getByTestId('column-new').getByTestId('order-card').count();
  const r = await guestOrder(request);
  expect(r.status()).toBe(201);
  const number = String((await r.json()).orderNumber);
  const waiting = waitingBefore + 1;
  for (const p of [owner, waiter]) {
    await expect(p.locator(`[data-testid=order-card][data-order-number="${number}"]`)).toHaveAttribute('data-status', 'NEW', { timeout: 15_000 });
    await expect(p.getByTestId('sidebar').getByTestId('nav-badge-liveOrders')).toHaveText(String(waiting), { timeout: 15_000 });
    await expect(p).toHaveTitle(new RegExp(`^\\(${waiting}\\)`));
  }
  // The waiter takes it on (Accept); the owner's tablet follows without anyone touching it.
  await waiter.locator(`[data-testid=order-card][data-order-number="${number}"]`).getByTestId('action-ACCEPTED').click();
  for (const p of [owner, waiter]) {
    await expect(p.locator(`[data-testid=order-card][data-order-number="${number}"]`)).toHaveAttribute('data-status', 'ACCEPTED', { timeout: 15_000 });
    if (waitingBefore) await expect(p.getByTestId('sidebar').getByTestId('nav-badge-liveOrders')).toHaveText(String(waitingBefore), { timeout: 15_000 });
    else await expect(p.getByTestId('sidebar').getByTestId('nav-badge-liveOrders')).toHaveCount(0, { timeout: 15_000 });
  }
  await Promise.all(devices.map((c) => c.close()));
});

test('M7-06: the attention summary is on every page and links straight to the waiting order (audit OPS-01)', async ({ page, request }) => {
  const r = await guestOrder(request);
  expect(r.status()).toBe(201);
  const number = (await r.json()).orderNumber as number;
  await login(page, s.waiter, s.password);
  for (const path of ['/tables', '/bills', '/menu']) {
    await page.goto(`/dashboard/${s.orgSlug}${path}`);
    await expect(page.getByTestId('attention-bar')).toBeVisible();
  }
  // The bell lists every item; this one opens Live Orders on that exact card.
  await page.getByTestId('notifications').getByRole('button').first().click();
  await page.getByRole('menuitem', { name: new RegExp(`Order #${number} not accepted`) }).click();
  await expect(page).toHaveURL(/\/orders\?focus=order-/);
  const card = page.locator(`[data-testid=order-card][data-order-number="${number}"]`);
  await expect(card).toHaveAttribute('data-focused', 'true');
  // Accepting resolves it: the item leaves the summary.
  await card.getByTestId('action-ACCEPTED').click();
  await expect(card).toHaveAttribute('data-status', 'ACCEPTED');
  await expect.poll(async () => (await page.request.get(`/api/dashboard/${s.orgSlug}/counts`).then((x) => x.json())).attention.items.some((i: { orderNumber?: number; kind: string }) => i.kind === 'order_unaccepted' && i.orderNumber === number)).toBe(false);
});

test('M7-10: connection loss is shown, and the board reloads authoritative state on reconnect', async ({ page, context, request }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  await expect(page.getByTestId('column-new')).toBeVisible(); // first poll rendered
  const before = await page.getByTestId('order-card').count();
  await context.setOffline(true);
  await expect(page.getByTestId('connection-status')).toContainText('Connection lost', { timeout: 12_000 });
  expect((await guestOrder(request)).status()).toBe(201); // an order arrives while the tablet is offline
  await context.setOffline(false);
  await expect(page.getByTestId('connection-status')).toContainText('Live', { timeout: 12_000 });
  await expect(page.getByTestId('order-card')).toHaveCount(before + 1);
});

test('M7-10b: a poll that never answers stops showing Live, says since when, and the board recovers by itself', async ({ page, request }) => {
  test.setTimeout(120_000);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('column-new')).toBeVisible();
  const before = await page.getByTestId('order-card').count();
  // Every Live Orders request from now on hangs (no answer, no error).
  const held: { abort: () => Promise<void> }[] = [];
  await page.route('**/orders/live?**', (route) => void held.push(route));
  await expect(page.getByTestId('connection-status')).not.toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await expect(page.getByTestId('connection-status')).not.toContainText('Live');
  await expect(page.getByTestId('stale-banner')).toContainText('Not updated since');
  expect((await guestOrder(request)).status()).toBe(201);
  // Network healthy again: the next try answers, with the order that came in meanwhile.
  await page.unroute('**/orders/live?**');
  await expect(page.getByTestId('order-card')).toHaveCount(before + 1, { timeout: 40_000 });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('stale-banner')).toHaveCount(0);
  // The hung request (still unanswered) was given up on instead of blocking the polls after it.
  expect(held.length).toBeGreaterThanOrEqual(1);
  for (const r of held) await r.abort().catch(() => undefined);
});

test('M8-04: waiter handles "call waiter" and "request bill" from the table', async ({ page, request }) => {
  for (const type of ['CALL_WAITER', 'REQUEST_BILL']) {
    const r = await request.post('/api/public/table-requests', { headers: ORIGIN, data: { qrToken: s.qrToken, type } });
    expect(r.status()).toBe(201);
  }
  await login(page, s.waiter, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/tasks`);
  const reqs = page.getByTestId('table-requests');
  await expect(reqs).toContainText('Waiter called');
  await expect(reqs).toContainText('Bill requested');
  await expect(reqs).toContainText('Table 07');
  await reqs.getByTestId('task-ack').first().click();
  await expect(reqs.getByTestId('task-ack')).toHaveCount(1);
  await reqs.getByTestId('task-done').first().click();
  await reqs.getByTestId('task-done').first().click();
  await expect(page.getByTestId('table-requests')).toHaveCount(0);
});

test('public APIs reject cross-site requests (CSRF) and unknown QR tokens', async ({ request }) => {
  const evil = await request.post('/api/public/orders/table', { headers: { Origin: 'https://evil.example' }, data: {} });
  expect(evil.status()).toBe(403);
  const bad = await request.post('/api/public/table-requests', { headers: ORIGIN, data: { qrToken: 'unknown-token-xxxxxxxx', type: 'CALL_WAITER' } });
  expect(bad.status()).toBe(404);
});
