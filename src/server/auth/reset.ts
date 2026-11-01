import 'server-only';
import { hashToken, newSecretToken } from '../crypto';
import { db } from '../db';
import { env } from '../env';

/** Creates a single-use 30-minute password reset link. Server-only: never expose as an action. */
export async function createPasswordResetLink(userId: string): Promise<string> {
  const token = newSecretToken();
  // Only the newest link works: an older one shared by mistake stops working.
  await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    db.passwordResetToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) } }),
  ]);
  return `${env.APP_BASE_URL}/reset-password/${token}`;
}
