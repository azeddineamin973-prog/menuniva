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
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
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
    const retry = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now) / 1000);
    throw new RateLimitError(Math.max(retry, 1));
  }
}
