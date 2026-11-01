import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { LANGUAGES } from '@/i18n/config';
import type { LanguageCode } from '@/generated/prisma/enums';
import { audit } from '../audit';
import { hashPassword, passwordSchema, verifyPassword } from '../auth/password';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { rateLimit, RateLimitError } from '../rate-limit';

/**
 * Throttles checks of the current password (password change, account deletion): someone holding a
 * stolen session must not be able to guess the real password at full speed.
 */
async function checkCurrentPassword(userId: string, passwordHash: string, password: string) {
  try {
    await rateLimit(`pwcheck:${userId}`, 10, 900);
  } catch (e) {
    if (e instanceof RateLimitError) throw new UserFacingError('Too many attempts. Please wait 15 minutes and try again.');
    throw e;
  }
  return verifyPassword(passwordHash, password);
}

/** Self-service for staff/owner accounts: profile, password, GDPR export and deletion. */

const profileSchema = z.object({ name: z.string().trim().min(2).max(120), preferredLanguage: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]) });

export async function updateProfile(userId: string, input: unknown) {
  const d = profileSchema.parse(input);
  await db.user.update({ where: { id: userId }, data: d });
}

/** Changes the password and signs out every other device (the current session is kept). */
export async function changePassword(userId: string, current: string, next: string, keepSessionTokenHash?: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await checkCurrentPassword(userId, user.passwordHash, current))) throw new UserFacingError('The current password is not correct.');
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) throw new UserFacingError('The new password must have at least 10 characters.');
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(parsed.data) } });
  await db.session.deleteMany({ where: { userId, ...(keepSessionTokenHash ? { tokenHash: { not: keepSessionTokenHash } } : {}) } });
  await db.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
  await audit({ actorUserId: userId, action: 'user.password_changed', entityType: 'User', entityId: userId });
}

/** Everything MenuNiva stores about this person as a staff/owner user. */
export async function exportMyData(userId: string) {
  const [user, memberships, sessions, actions, tickets] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, preferredLanguage: true, platformRole: true, createdAt: true } }),
    db.restaurantMembership.findMany({ where: { userId }, select: { role: true, status: true, createdAt: true, locationIds: true, organization: { select: { name: true, slug: true } } } }),
    db.session.findMany({ where: { userId }, select: { createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true, ip: true } }),
    db.auditLog.findMany({ where: { actorUserId: userId }, orderBy: { createdAt: 'desc' }, take: 1000, select: { action: true, entityType: true, createdAt: true, organization: { select: { name: true } } } }),
    db.supportTicket.findMany({ where: { createdById: userId }, select: { subject: true, body: true, status: true, createdAt: true } }),
  ]);
  return { generatedAt: new Date().toISOString(), user, memberships, sessions, actions, supportRequests: tickets };
}

/**
 * Deletes the account: personal data is erased, sessions and memberships end. Refused while the
 * person is the only owner of a restaurant (ownership must be passed on first) or the only
 * Super Admin. Audit entries keep pointing to the anonymised account.
 */
export async function deleteMyAccount(userId: string, password: string, confirmation: string) {
  if (confirmation.trim().toUpperCase() !== 'DELETE') throw new UserFacingError('Type DELETE to confirm.');
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await checkCurrentPassword(userId, user.passwordHash, password))) throw new UserFacingError('The password is not correct.');
  const owned = await db.restaurantMembership.findMany({ where: { userId, role: 'RESTAURANT_OWNER', status: 'ACTIVE' }, select: { organizationId: true, organization: { select: { name: true } } } });
  for (const o of owned) {
    const others = await db.restaurantMembership.count({ where: { organizationId: o.organizationId, role: 'RESTAURANT_OWNER', status: 'ACTIVE', userId: { not: userId } } });
    if (others === 0) throw new UserFacingError(`You are the only owner of ${o.organization.name}. Invite another owner first, or contact support to close the restaurant.`);
  }
  if (user.platformRole === 'PLATFORM_SUPER_ADMIN' && (await db.user.count({ where: { platformRole: 'PLATFORM_SUPER_ADMIN', disabledAt: null } })) <= 1) {
    throw new UserFacingError('You are the only Super Admin. Create another administrator first.');
  }
  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.restaurantMembership.updateMany({ where: { userId }, data: { status: 'DISABLED' } });
    await tx.user.update({
      where: { id: userId },
      data: { name: 'Deleted user', email: `deleted+${userId}@deleted.menuniva.invalid`, passwordHash: await hashPassword(randomBytes(24).toString('base64url')), disabledAt: new Date(), platformRole: 'USER' },
    });
    await audit({ actorUserId: userId, action: 'user.account_deleted', entityType: 'User', entityId: userId }, tx);
  });
}
