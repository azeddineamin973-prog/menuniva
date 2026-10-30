import 'server-only';
import { db } from '../db';
import { isRateLimited, rateLimit, RateLimitError } from '../rate-limit';
import { burnPasswordCheck, verifyPassword } from './password';

/**
 * Password check with brute-force protection. Only FAILED attempts count: 30 per IP and 8 per
 * email address in 15 minutes. Successful sign-ins never lock out a restaurant whose staff share
 * one internet connection. Unknown emails take as long as known ones.
 */
export const LOGIN_LIMITS = { perIp: 30, perEmail: 8, windowSeconds: 900 };

export async function attemptLogin(email: string, password: string, ip: string | null): Promise<{ ok: true; userId: string } | { ok: false; error: 'invalid_credentials' | 'too_many_attempts' }> {
  const { perIp, perEmail, windowSeconds } = LOGIN_LIMITS;
  if ((ip && (await isRateLimited(`login:ip:${ip}`, perIp, windowSeconds))) || (await isRateLimited(`login:email:${email}`, perEmail, windowSeconds))) {
    return { ok: false, error: 'too_many_attempts' };
  }
  const user = await db.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : (await burnPasswordCheck(password), false);
  if (user && valid && !user.disabledAt) return { ok: true, userId: user.id };
  // Without a trusted client IP only the per-email limit applies (a shared 'unknown' bucket would let
  // anyone lock everybody out).
  for (const [key, limit] of [...(ip ? [[`login:ip:${ip}`, perIp] as const] : []), [`login:email:${email}`, perEmail] as const]) {
    await rateLimit(key, limit, windowSeconds).catch((e) => {
      if (!(e instanceof RateLimitError)) throw e;
    });
  }
  return { ok: false, error: 'invalid_credentials' };
}
