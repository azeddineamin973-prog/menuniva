import { describe, expect, it } from 'vitest';
import { classifyResponse, connectionState, OFFLINE_AFTER_MS, retryDelay, timeoutFor } from '@/lib/poll-health';

describe('dashboard polling health (audit OPS-03, OPS-47)', () => {
  it('tells a signed-out session, removed access and a missing location apart from a temporary failure', () => {
    expect(classifyResponse(200, {})).toEqual({ kind: 'ok' });
    expect(classifyResponse(401, { error: 'access_denied' })).toEqual({ kind: 'problem', problem: 'expired' });
    expect(classifyResponse(403, { error: 'access_denied' })).toEqual({ kind: 'problem', problem: 'forbidden' });
    // tenantRoute answers 404 access_denied when the person is no longer a member of the restaurant.
    expect(classifyResponse(404, { error: 'access_denied' })).toEqual({ kind: 'problem', problem: 'forbidden' });
    // …and 404 with its own message when the location or station is gone: not "session expired".
    expect(classifyResponse(404, { error: 'Location not found.' })).toEqual({ kind: 'problem', problem: 'not_found' });
    expect(classifyResponse(404, null)).toEqual({ kind: 'problem', problem: 'not_found' });
    expect(classifyResponse(500, { error: 'server_error' })).toEqual({ kind: 'retry' });
    expect(classifyResponse(502, null)).toEqual({ kind: 'retry' });
    expect(classifyResponse(429, { error: 'rate_limited' }, '7')).toEqual({ kind: 'retry', retryAfterMs: 7000 });
    expect(classifyResponse(429, null, 'soon')).toEqual({ kind: 'retry' });
  });

  it('aborts a request after about two intervals (6–15 s)', () => {
    expect(timeoutFor(4000)).toBe(8000);
    expect(timeoutFor(5000)).toBe(10_000);
    expect(timeoutFor(10_000)).toBe(15_000);
    expect(timeoutFor(1000)).toBe(6000);
  });

  it('retries quickly once, then backs off (15 s at most for order boards, 30 s for the sidebar counts) with jitter', () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 10].map((n) => retryDelay(n, 5000, mid))).toEqual([2000, 5000, 10_000, 15_000, 15_000, 15_000, 15_000]);
    expect([1, 2, 3, 4, 5].map((n) => retryDelay(n, 4000, mid))).toEqual([2000, 4000, 8000, 15_000, 15_000]);
    expect([1, 2, 3, 4, 5].map((n) => retryDelay(n, 10_000, mid))).toEqual([2000, 10_000, 20_000, 30_000, 30_000]);
    expect(retryDelay(3, 5000, () => 0)).toBe(8000);
    expect(retryDelay(3, 5000, () => 1)).toBe(12_000);
  });

  it('only says Live while the latest answer is recent and nothing failed since', () => {
    const base = { lastOkAt: 100_000, failures: 0, browserOffline: false, intervalMs: 5000 };
    expect(connectionState({ ...base, lastOkAt: null, now: 100_000 })).toBe('connecting');
    expect(connectionState({ ...base, now: 104_000 })).toBe('live');
    // A request hanging since the last answer: not live after one interval + its timeout.
    expect(connectionState({ ...base, now: 100_000 + 5000 + 10_000 })).toBe('live');
    expect(connectionState({ ...base, now: 100_000 + 5000 + 10_001 })).toBe('reconnecting');
    expect(connectionState({ ...base, failures: 1, now: 101_000 })).toBe('reconnecting');
    expect(connectionState({ ...base, failures: 4, now: 100_000 + OFFLINE_AFTER_MS })).toBe('offline');
    expect(connectionState({ ...base, browserOffline: true, now: 101_000 })).toBe('offline');
    expect(connectionState({ ...base, lastOkAt: null, failures: 1, now: 1 })).toBe('reconnecting');
    expect(connectionState({ ...base, lastOkAt: null, failures: 3, now: 1 })).toBe('offline');
  });
});
