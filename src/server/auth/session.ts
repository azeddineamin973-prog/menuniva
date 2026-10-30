import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { db } from '../db';
import { hashToken, newSecretToken } from '../crypto';
import { isProduction } from '../env';

export const SESSION_COOKIE = 'mn_session';
const SESSION_DAYS = 30;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export async function clientIp(): Promise<string> {
  const h = await headers();
  // Behind a trusted reverse proxy configure it to set x-forwarded-for; first hop is the client.
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
}

/** Creates a DB session and sets the httpOnly cookie. Call only from server actions / route handlers. */
export async function createSession(userId: string) {
  const token = newSecretToken();
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
      ip: await clientIp(),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  platformRole: 'USER' | 'PLATFORM_SUPER_ADMIN';
  preferredLanguage: 'pt' | 'en' | 'fr' | 'ar' | 'es';
  sessionId: string;
};

/** Returns the signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || session.user.disabledAt) return null;

  // Sliding expiry: refresh at most once per day to limit writes.
  if (Date.now() - session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) },
    });
  }
  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    platformRole: u.platformRole,
    preferredLanguage: u.preferredLanguage,
    sessionId: session.id,
  };
});
