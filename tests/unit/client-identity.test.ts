import { describe, expect, it } from 'vitest';
import { clientIdentity, trustedClientIp } from '@/server/client-identity';

/** Audit BUG-05: X-Forwarded-For is trusted only as far as the configured proxies vouch for it. */
const h = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

describe('trusted client IP (TRUST_PROXY_HOPS)', () => {
  it('ignores X-Forwarded-For completely when no proxy is configured (0)', () => {
    expect(trustedClientIp(h('203.0.113.7'), 0)).toBeNull();
    expect(trustedClientIp(h(), 0)).toBeNull();
  });
  it('with one proxy, takes the address the proxy appended (rightmost), not what the client wrote', () => {
    expect(trustedClientIp(h('198.51.100.9'), 1)).toBe('198.51.100.9');
    // client sends a fake first hop; the proxy appends the real address
    expect(trustedClientIp(h('1.2.3.4, 198.51.100.9'), 1)).toBe('198.51.100.9');
    expect(trustedClientIp(h('evil, 1.2.3.4, 198.51.100.9'), 1)).toBe('198.51.100.9');
  });
  it('with two proxies (CDN + load balancer), takes the second entry from the right', () => {
    expect(trustedClientIp(h('1.2.3.4, 198.51.100.9, 10.0.0.2'), 2)).toBe('198.51.100.9');
    expect(trustedClientIp(h('10.0.0.2'), 2)).toBeNull(); // chain shorter than the proxy count
  });
  it('accepts IPv6 and IPv4-mapped forms, rejects garbage', () => {
    expect(trustedClientIp(h('2001:db8::1'), 1)).toBe('2001:db8::1');
    expect(trustedClientIp(h('::ffff:198.51.100.9'), 1)).toBe('198.51.100.9');
    expect(trustedClientIp(h('not-an-ip'), 1)).toBeNull();
    expect(trustedClientIp(h("1.2.3.4' OR 1=1"), 1)).toBeNull();
  });
});

describe('guest identity', () => {
  const req = (cookie?: string, xff?: string) => new Request('http://localhost/api/public/quote', { headers: { ...(cookie ? { cookie } : {}), ...(xff ? { 'x-forwarded-for': xff } : {}) } });
  it('two guests with different cookies on the same network get different keys', () => {
    const a = clientIdentity(req('mn_guest=AAAAAAAAAAAAAAAAAAAAAA')).identity;
    const b = clientIdentity(req('mn_guest=BBBBBBBBBBBBBBBBBBBBBB')).identity;
    expect(a.guest).not.toBe(b.guest);
    expect(clientIdentity(req('mn_guest=AAAAAAAAAAAAAAAAAAAAAA')).identity.guest).toBe(a.guest); // stable
  });
  it('a missing or malformed cookie gives a one-off id (never a shared bucket)', () => {
    const x = clientIdentity(req());
    const y = clientIdentity(req('mn_guest=<script>'));
    expect(x.issued).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(x.identity.guest).not.toBe(y.identity.guest);
  });
  it('keys never contain the raw IP or cookie', () => {
    const { identity } = clientIdentity(req('mn_guest=AAAAAAAAAAAAAAAAAAAAAA', '198.51.100.9'));
    expect(JSON.stringify(identity)).not.toMatch(/198\.51|AAAAAAAA/);
  });
});
