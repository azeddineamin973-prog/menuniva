import { describe, expect, it } from 'vitest';

/**
 * Vercel Cron entry point for the daily retention job: it runs only for a caller holding
 * CRON_SECRET and does not exist for anyone else (every test file has its own environment).
 */
process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
const { GET } = await import('@/app/api/cron/retention/route');
const call = (authorization?: string) => GET(new Request('http://localhost/api/cron/retention', { headers: authorization ? { authorization } : {} }));

describe('daily retention job over HTTP (Vercel Cron)', () => {
  it('is not found without the exact secret', async () => {
    for (const auth of [undefined, 'Bearer wrong', 'cron-secret-for-tests-0123456789', 'Bearer cron-secret-for-tests-01234567890']) {
      const res = await call(auth);
      expect(res.status, String(auth)).toBe(404);
    }
  });
  it('runs the retention job for Vercel Cron and returns counts only', async () => {
    const res = await call('Bearer cron-secret-for-tests-0123456789');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ guestData: { orders: expect.any(Number) }, failedRestaurants: 0, platform: { sessions: expect.any(Number) } });
  });
});
