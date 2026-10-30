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
  await expect(page.getByTestId('unread-count')).toContainText('1');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chimes: number }).__chimes)).toBeGreaterThan(baseline);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notes: string[] }).__notes.length)).toBeGreaterThan(0);
  await expect(page).toHaveTitle(/^\(1\)/);

  // Still NEW and highlighted after a reload until someone acknowledges it
  await page.reload();
  await expect(page.getByTestId('unread-count')).toBeVisible();
  await card.getByRole('button', { name: 'Seen' }).click();
  await expect(page.getByTestId('unread-count')).toHaveCount(0);
  await expect(page.getByTestId('column-new').getByTestId('order-card')).toHaveCount(1); // still NEW, just acknowledged

  // Mute is remembered on this device
  await page.getByRole('button', { name: /Enable sound/ }).click();
  await page.getByRole('button', { name: /Mute alerts/ }).click();
  await page.reload();
  await page.getByRole('button', { name: /Enable sound/ }).click();
  await expect(page.getByRole('button', { name: /Alerts muted/ })).toBeVisible();
});

test('M7-10: connection loss is shown, and the board reloads authoritative state on reconnect', async ({ page, context, request }) => {
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/orders`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  const before = await page.getByTestId('order-card').count();
  await context.setOffline(true);
  await expect(page.getByTestId('connection-status')).toContainText('Connection lost', { timeout: 12_000 });
  expect((await guestOrder(request)).status()).toBe(201); // an order arrives while the tablet is offline
  await context.setOffline(false);
  await expect(page.getByTestId('connection-status')).toContainText('Live', { timeout: 12_000 });
  await expect(page.getByTestId('order-card')).toHaveCount(before + 1);
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
