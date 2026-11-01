import 'server-only';
import { db } from '../db';
import { rateLimit, RateLimitError, releaseRateLimit } from '../rate-limit';
import { burnPasswordCheck, verifyPassword } from './password';

/**
 * Password check with brute-force protection. Only FAILED attempts count: 30 per IP and 8 per
 * email address in 15 minutes. Successful sign-ins never lock out a restaurant whose staff share
 * one internet connection. Unknown emails take as long as known ones.
 */
export const LOGIN_LIMITS = { perIp: 30, perEmail: 8, windowSeconds: 900 };

export async function attemptLogin(email: string, password: string, ip: string | null): Promise<{ ok: true; userId: string } | { ok: false; error: 'invalid_credentials' | 'too_many_attempts' }> {
  const { perIp, perEmail, windowSeconds } = LOGIN_LIMITS;
  // Every attempt takes its place in the count BEFORE the password is checked: many guesses sent
  // at the same moment cannot all pass while the counter still reads below the limit. A correct
  // sign-in gives its place back, so successful logins never count.
  // Without a trusted client IP only the per-email limit applies (a shared 'unknown' bucket would let
  // anyone lock everybody out).
  const keys = [...(ip ? [[`login:ip:${ip}`, perIp] as const] : []), [`login:email:${email}`, perEmail] as const];
  const taken: string[] = [];
  try {
    for (const [key, limit] of keys) {
      taken.push(key);
      await rateLimit(key, limit, windowSeconds);
    }
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'too_many_attempts' };
    throw e;
  }
  const user = await db.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : (await burnPasswordCheck(password), false);
  if (user && valid && !user.disabledAt) {
    for (const key of taken) await releaseRateLimit(key, windowSeconds);
    return { ok: true, userId: user.id };
  }
  return { ok: false, error: 'invalid_credentials' };
}
