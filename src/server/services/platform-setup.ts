import 'server-only';
import { z } from 'zod';
import { audit } from '../audit';
import { hashPassword, passwordSchema } from '../auth/password';
import { hashToken } from '../crypto';
import { db } from '../db';

export async function isSetupTokenUsable(token: string): Promise<boolean> {
  if (!token || token.length < 20) return false;
  const [record, admins] = await Promise.all([
    db.platformSetupToken.findUnique({ where: { tokenHash: hashToken(token) } }),
    db.user.count({ where: { platformRole: 'PLATFORM_SUPER_ADMIN' } }),
  ]);
  return !!record && !record.usedAt && record.expiresAt > new Date() && admins === 0;
}

export const bootstrapAdminSchema = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
});

/**
 * Creates the first PLATFORM_SUPER_ADMIN. The token is consumed atomically (UPDATE … WHERE
 * usedAt IS NULL) so two concurrent requests cannot both succeed.
 */
export async function bootstrapPlatformAdmin(input: z.infer<typeof bootstrapAdminSchema>) {
  const data = bootstrapAdminSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return db.$transaction(async (tx) => {
    const consumed = await tx.platformSetupToken.updateMany({
      where: { tokenHash: hashToken(data.token), usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new Error('setup_token_invalid');
    const admins = await tx.user.count({ where: { platformRole: 'PLATFORM_SUPER_ADMIN' } });
    if (admins > 0) throw new Error('setup_token_invalid');
    const existing = await tx.user.findUnique({ where: { email: data.email } });
    if (existing) throw new Error('email_taken');
    const user = await tx.user.create({
      data: { name: data.name, email: data.email, passwordHash, platformRole: 'PLATFORM_SUPER_ADMIN' },
    });
    await audit({ actorUserId: user.id, action: 'platform.admin_bootstrapped', entityType: 'User', entityId: user.id }, tx);
    return user;
  });
}
