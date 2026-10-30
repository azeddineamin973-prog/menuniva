import { beforeEach, describe, expect, it } from 'vitest';
import { attemptLogin, LOGIN_LIMITS } from '@/server/auth/login';
import { hashPassword } from '@/server/auth/password';
import { db } from '@/server/db';
import { resetDatabase } from '../support/db';

describe('M2-05 / M13-01 login brute-force protection', () => {
  beforeEach(resetDatabase);

  it('many successful sign-ins from one restaurant connection are never blocked', async () => {
    const passwordHash = await hashPassword('correct-horse-123');
    const users = await Promise.all(Array.from({ length: 5 }, (_, i) => db.user.create({ data: { name: `Staff ${i}`, email: `staff${i}@test.menuniva.local`, passwordHash } })));
    for (let round = 0; round < 8; round++) for (const u of users) expect((await attemptLogin(u.email, 'correct-horse-123', '10.0.0.1')).ok).toBe(true);
  });

  it('wrong passwords lock the email after 8 failures and the IP after 30; disabled and unknown users fail the same way', async () => {
    const passwordHash = await hashPassword('correct-horse-123');
    await db.user.create({ data: { name: 'Owner', email: 'owner@test.menuniva.local', passwordHash } });
    await db.user.create({ data: { name: 'Gone', email: 'gone@test.menuniva.local', passwordHash, disabledAt: new Date() } });
    expect(await attemptLogin('gone@test.menuniva.local', 'correct-horse-123', '10.0.0.9')).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(await attemptLogin('nobody@test.menuniva.local', 'x', '10.0.0.9')).toEqual({ ok: false, error: 'invalid_credentials' });
    for (let i = 0; i < LOGIN_LIMITS.perEmail; i++) expect((await attemptLogin('owner@test.menuniva.local', 'wrong', `10.1.0.${i}`)).ok).toBe(false);
    // Even the right password is refused while the email is locked.
    expect(await attemptLogin('owner@test.menuniva.local', 'correct-horse-123', '10.2.0.1')).toEqual({ ok: false, error: 'too_many_attempts' });
    for (let i = 0; i < LOGIN_LIMITS.perIp; i++) await attemptLogin(`x${i}@test.menuniva.local`, 'wrong', '10.3.0.1');
    expect(await attemptLogin('someone@test.menuniva.local', 'wrong', '10.3.0.1')).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(await attemptLogin('owner2@test.menuniva.local', 'wrong', '10.4.0.1')).toEqual({ ok: false, error: 'invalid_credentials' }); // other IPs unaffected
  });
});
