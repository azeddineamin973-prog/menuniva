import 'server-only';
import { db } from './db';

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('rate_limited');
  }
}

/**
 * Fixed-window rate limiter stored in PostgreSQL, so it works across several app
 * instances without Redis. One atomic upsert per call.
 */
export type Limit = [limit: number, windowSeconds: number];

/**
 * Public-endpoint throttling (audit BUG-05). Every guest gets its own bucket (guest cookie), so
 * guests sharing one Wi-Fi and phone model are not blocked by each other. Shared buckets — the
 * trusted client IP (when the proxy setup makes it known) and the whole scope (table / location) —
 * only cap abuse and have much higher limits. The first time a shared bucket overflows in a
 * window an "abuse" entry is written for the Super Admin (System errors), without raw IPs.
 */
export async function limitPublic(
  prefix: string,
  identity: { guest: string; ip: string | null; cookieless?: boolean },
  limits: { guest: Limit; ip?: Limit; scope?: { key: string; limit: Limit }; cookieless?: Limit },
): Promise<() => Promise<void>> {
  const key = limits.scope && `${prefix}:all:${limits.scope.key}`;
  // Side by side, one database round trip instead of up to four in a row (each costs its full latency on
  // every guest request; final QA). Per-guest and per-IP buckets count every attempt either way.
  await Promise.all([
    rateLimit(`${prefix}:g:${identity.guest}`, ...limits.guest),
    // Requests without a guest cookie get a new id each time, so the per-guest cap above never bites:
    // they share one bucket instead (real guests always carry the cookie set by the menu page; V4, Q10).
    identity.cookieless && limits.cookieless ? rateLimit(`${prefix}:nocookie`, ...limits.cookieless, true) : null,
    identity.ip && limits.ip ? rateLimit(`${prefix}:ip:${identity.ip}`, ...limits.ip, true) : null,
    key && limits.scope ? assertBelowLimit(key, ...limits.scope.limit) : null,
  ]);
  if (!key || !limits.scope) return async () => {};
  const [limit, windowSeconds] = limits.scope.limit;
  return () => countSuccess(key, limit, windowSeconds);
}

/**
 * Shared caps (a whole location or table) count only what succeeded. The caller checks the cap
 * before the work and calls `countSuccess` once something was really created: refused or failed
 * attempts (unavailable dishes, wrong table codes, junk) must never let one client use up the
 * allowance of every guest of a restaurant. Per-guest and per-IP limits still count every attempt.
 */
export async function assertBelowLimit(key: string, limit: number, windowSeconds: number) {
  if (await isRateLimited(key, limit, windowSeconds)) {
    const now = Date.now();
    const windowEnd = (Math.floor(now / (windowSeconds * 1000)) + 1) * windowSeconds * 1000;
    throw new RateLimitError(Math.max(Math.ceil((windowEnd - now) / 1000), 1));
  }
}
export async function countSuccess(key: string, limit: number, windowSeconds: number) {
  // The thing is already created: going over the cap here only blocks the next attempts.
  await rateLimit(key, limit, windowSeconds, true).catch((e) => {
    if (!(e instanceof RateLimitError)) throw e;
  });
}

/** Gives back one attempt in the current window (e.g. a sign-in that turned out to be correct). */
export async function releaseRateLimit(key: string, windowSeconds: number) {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  await db.$executeRaw`UPDATE "RateLimitBucket" SET "count" = GREATEST("count" - 1, 0) WHERE "key" = ${key} AND "windowStart" = ${windowStart}`;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number, reportAbuse = false): Promise<void> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" = EXCLUDED."windowStart"
                     THEN "RateLimitBucket"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"`;
  const count = rows[0]?.count ?? 1;
  if (count > limit) {
    if (reportAbuse && count === limit + 1) {
      const { logError } = await import('./audit');
      await logError('abuse', new Error(`Rate limit exceeded: ${key.split(':').slice(0, 3).join(':')}`), { key, limit, windowSeconds });
    }
    const retry = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now) / 1000);
    throw new RateLimitError(Math.max(retry, 1));
  }
}

/** Read-only check: true when `key` already used up `limit` in the current window. */
export async function isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const row = await db.rateLimitBucket.findUnique({ where: { key } });
  return !!row && row.windowStart.getTime() === windowStart.getTime() && row.count >= limit;
}
