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
  identity: { guest: string; ip: string | null },
  limits: { guest: Limit; ip?: Limit; scope?: { key: string; limit: Limit } },
) {
  await rateLimit(`${prefix}:g:${identity.guest}`, ...limits.guest);
  if (identity.ip && limits.ip) await rateLimit(`${prefix}:ip:${identity.ip}`, ...limits.ip, true);
  if (limits.scope) await rateLimit(`${prefix}:all:${limits.scope.key}`, ...limits.scope.limit, true);
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
