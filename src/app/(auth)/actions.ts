'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath, zodFieldErrors, type ActionResult } from '@/lib/action-result';
import { audit } from '@/server/audit';
import { hashPassword, passwordSchema } from '@/server/auth/password';
import { clientIp, createSession, destroySession, revokeAllSessions } from '@/server/auth/session';
import { attemptLogin } from '@/server/auth/login';
import { hashToken } from '@/server/crypto';
import { db } from '@/server/db';
import { rateLimit, RateLimitError } from '@/server/rate-limit';

const emailSchema = z.string().trim().toLowerCase().email('invalid_email').max(254);

const signupSchema = z.object({
  name: z.string().trim().min(2, 'required').max(120),
  email: emailSchema,
  password: passwordSchema,
});

export async function signupAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: zodFieldErrors(parsed.error.issues) };
  try {
    const ip = await clientIp();
    // Per trusted IP; without a known IP (no proxy configured) a platform-wide ceiling applies.
    await (ip ? rateLimit(`signup:${ip}`, 10, 3600, true) : rateLimit('signup:unknown-ip', 100, 3600, true));
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'too_many_attempts' };
    throw e;
  }
  const { name, email, password } = parsed.data;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: 'email_taken', fieldErrors: { email: 'email_taken' } };
  const user = await db.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
  await audit({ actorUserId: user.id, action: 'user.signed_up', entityType: 'User', entityId: user.id });
  await createSession(user.id);
  redirect(safeNextPath(form.get('next'), '/onboarding/new'));
}

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

export async function loginAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'invalid_credentials' };
  const r = await attemptLogin(parsed.data.email, parsed.data.password, await clientIp());
  if (!r.ok) return { ok: false, error: r.error };
  await createSession(r.userId);
  redirect(safeNextPath(form.get('next'), '/dashboard'));
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}

/**
 * Password reset request. Without SMTP configured, MenuNiva cannot email the link; in that
 * case the link is NOT shown to the requester (that would allow account takeover). A
 * restaurant owner or platform admin can generate a reset link for staff instead.
 */
export async function requestPasswordResetAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(form.get('email'));
  if (!parsed.success) return { ok: false, error: 'invalid_email' };
  try {
    const ip = await clientIp();
    await (ip ? rateLimit(`reset:${ip}`, 5, 3600) : rateLimit('reset:unknown-ip', 50, 3600));
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'too_many_attempts' };
    throw e;
  }
  // No email sender exists yet (EMAIL_DELIVERY_AVAILABLE = false): no token is created that nobody
  // could receive. The page tells the person to ask the owner or MenuNiva support for a reset link.
  void parsed.data;
  return { ok: true, message: 'reset_sent' };
}

const resetSchema = z.object({ token: z.string().min(20).max(100), password: passwordSchema });

export async function resetPasswordAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: zodFieldErrors(parsed.error.issues) };
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return { ok: false, error: 'link_invalid' };
  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(parsed.data.password) } });
  });
  await revokeAllSessions(record.userId);
  await audit({ actorUserId: record.userId, action: 'user.password_reset', entityType: 'User', entityId: record.userId });
  return { ok: true, message: 'reset_done' };
}
