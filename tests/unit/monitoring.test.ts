import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/env', () => ({ env: { APP_ENV: 'test', ERROR_MONITORING_DSN: undefined } }));
const { safePath, scrub, monitoringConfigured, forwardError } = await import('@/server/monitoring');

describe('M13-03 error monitoring', () => {
  it('scrubs personal data and secrets from error context', () => {
    expect(scrub({ orderId: 'o1', phone: '+351912345678', customer: { name: 'Ana', email: 'a@b.c', city: 'Braga' }, password: 'x', headers: { authorization: 'Bearer y' } })).toEqual({
      orderId: 'o1',
      phone: '[redacted]',
      customer: { name: '[redacted]', email: '[redacted]', city: 'Braga' },
      password: '[redacted]',
      headers: { authorization: '[redacted]' },
    });
    expect((scrub('x'.repeat(500)) as string).length).toBe(301);
  });
  it('masks private tokens and drops query strings from logged paths', () => {
    expect(safePath('/o/abcDEF123_-xyz?lang=pt')).toBe('/o/[token]');
    expect(safePath('/t/qr_token_1/x')).toBe('/t/[token]/x');
    expect(safePath('/dashboard/casa/orders?q=912345678')).toBe('/dashboard/casa/orders');
  });
  it('without a DSN nothing is sent anywhere', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(monitoringConfigured()).toBe(false);
    expect(await forwardError({ source: 's', message: 'm' })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('M13-03 forwarding with a DSN', () => {
  it('POSTs a scrubbed JSON event to the https DSN', async () => {
    vi.resetModules();
    vi.doMock('@/server/env', () => ({ env: { APP_ENV: 'production', ERROR_MONITORING_DSN: 'https://collector.example.test/hook' } }));
    const m = await import('@/server/monitoring');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    expect(await m.forwardError({ source: 'route', message: 'boom', context: { path: '/x' } })).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://collector.example.test/hook');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ app: 'menuniva', env: 'production', source: 'route', message: 'boom', context: { path: '/x' } });
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await m.forwardError({ source: 'route', message: 'boom' })).toBe(false); // never throws
  });
});
