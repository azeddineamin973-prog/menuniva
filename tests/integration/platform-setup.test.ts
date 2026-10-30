import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken, newSecretToken } from '@/server/crypto';
import { db } from '@/server/db';
import { rateLimit, RateLimitError } from '@/server/rate-limit';
import { bootstrapPlatformAdmin, isSetupTokenUsable } from '@/server/services/platform-setup';
import { resetDatabase } from '../support/db';

async function issueToken(expiresInMs = 60_000) {
  const token = newSecretToken();
  await db.platformSetupToken.create({ data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + expiresInMs) } });
  return token;
}

describe('Super Admin one-time bootstrap', () => {
  beforeEach(resetDatabase);

  it('creates the admin once and consumes the token', async () => {
    const token = await issueToken();
    expect(await isSetupTokenUsable(token)).toBe(true);
    const user = await bootstrapPlatformAdmin({ token, name: 'Founder', email: 'founder@test.menuniva.local', password: 'a-long-password-123' });
    expect(user.platformRole).toBe('PLATFORM_SUPER_ADMIN');
    expect(user.passwordHash).not.toContain('a-long-password');
    expect(await isSetupTokenUsable(token)).toBe(false);
    await expect(
      bootstrapPlatformAdmin({ token, name: 'Attacker', email: 'x@test.menuniva.local', password: 'a-long-password-123' }),
    ).rejects.toThrow('setup_token_invalid');
    const log = await db.auditLog.findFirst({ where: { action: 'platform.admin_bootstrapped' } });
    expect(log?.actorUserId).toBe(user.id);
  });

  it('rejects expired and unknown tokens', async () => {
    const expired = await issueToken(-1000);
    expect(await isSetupTokenUsable(expired)).toBe(false);
    await expect(
      bootstrapPlatformAdmin({ token: expired, name: 'A', email: 'a@test.menuniva.local', password: 'a-long-password-123' }),
    ).rejects.toThrow();
    expect(await isSetupTokenUsable('x'.repeat(43))).toBe(false);
  });

  it('two concurrent attempts with the same token produce exactly one admin', async () => {
    const token = await issueToken();
    const results = await Promise.allSettled([
      bootstrapPlatformAdmin({ token, name: 'One', email: 'one@test.menuniva.local', password: 'a-long-password-123' }),
      bootstrapPlatformAdmin({ token, name: 'Two', email: 'two@test.menuniva.local', password: 'a-long-password-123' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.user.count({ where: { platformRole: 'PLATFORM_SUPER_ADMIN' } })).toBe(1);
  });
});

describe('PostgreSQL rate limiter', () => {
  beforeEach(resetDatabase);
  it('blocks after the limit within a window', async () => {
    for (let i = 0; i < 3; i++) await rateLimit('test:key', 3, 60);
    await expect(rateLimit('test:key', 3, 60)).rejects.toBeInstanceOf(RateLimitError);
    await expect(rateLimit('test:other', 3, 60)).resolves.toBeUndefined();
  });
});
