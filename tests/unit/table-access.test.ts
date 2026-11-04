import { describe, expect, it } from 'vitest';
import { clientIdentity, networkKey } from '@/server/client-identity';
import { grantCookie, grantTokensFrom, newPin, openPin, sealPin } from '@/server/services/table-access';
import { ROLE_PERMISSIONS } from '@/lib/permissions';

describe('table access primitives', () => {
  it('T7 IPv6 limits key on the /64 network; IPv4 on the full address', () => {
    expect(networkKey('2001:db8:1:2::1')).toBe(networkKey('2001:db8:1:2::ffff'));
    expect(networkKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(networkKey('2001:db8:1:2::1'));
    expect(networkKey('2001:0db8:0001:0002::1')).toBe(networkKey('2001:db8:1:2::9'));
    expect(networkKey('2001:db8:1:3::1')).not.toBe(networkKey('2001:db8:1:2::1'));
    expect(networkKey('198.51.100.1')).not.toBe(networkKey('198.51.100.2'));
    // Rotating addresses inside one /64 (audit Q08) lands in one bucket behind a trusted proxy.
    const id = (ip: string) => clientIdentity(new Request('http://x/', { headers: { 'x-forwarded-for': ip } })).identity;
    expect(id('2001:db8:4d2:7::1').ip).toBe(id('2001:db8:4d2:7::abcd').ip);
  });

  it('a request without the guest cookie is marked cookieless', () => {
    expect(clientIdentity(new Request('http://x/')).identity.cookieless).toBe(true);
    expect(clientIdentity(new Request('http://x/', { headers: { cookie: 'mn_guest=AbCdEfGhIjKlMnOpQrStUv' } })).identity.cookieless).toBe(false);
  });

  it('PINs: 6 digits from the CSPRNG; sealed per session (AES-GCM, session id authenticated)', () => {
    const pins = Array.from({ length: 2000 }, newPin);
    expect(pins.every((p) => /^\d{6}$/.test(p))).toBe(true);
    expect(new Set(pins).size).toBeGreaterThan(1990);
    const c = sealPin('042137', 'session-a');
    expect(c).not.toContain('042137');
    expect(openPin(c, 'session-a')).toBe('042137');
    expect(openPin(c, 'session-b')).toBeNull(); // copied onto another session: does not open
    expect(openPin(c.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')), 'session-a')).toBeNull(); // tampered
    expect(sealPin('042137', 'session-a')).not.toBe(c); // random IV
  });

  it('grant cookie: httpOnly, newest first, bounded, junk ignored', () => {
    const t = (n: number) => String(n).repeat(43).slice(0, 43);
    const c = grantCookie(t(1), [t(2), t(3), t(4), t(5)], true);
    expect(c.options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
    expect(grantTokensFrom(c.value)).toEqual([t(1), t(2), t(3), t(4)]);
    expect(grantTokensFrom('short.<script>.' + t(7))).toEqual([t(7)]);
  });

  it('only staff who seat guests can open tables and see PINs (not kitchen, Café or drivers)', () => {
    expect(ROLE_PERMISSIONS.WAITER).toContain('tables.sessions');
    expect(ROLE_PERMISSIONS.RESTAURANT_MANAGER).toContain('tables.sessions');
    expect(ROLE_PERMISSIONS.RESTAURANT_OWNER).toContain('tables.sessions');
    for (const r of ['KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'] as const) expect(ROLE_PERMISSIONS[r]).not.toContain('tables.sessions');
  });
});
