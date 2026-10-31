/**
 * The rate limiter counts in fixed wall-clock windows (see src/server/rate-limit.ts), so a test
 * that fills a window must not still be running when that window ends: the count would reset
 * mid-loop and the request that should have been refused would succeed.
 *
 * This waits for the next window to start when the current one has less than `needMs` left. It
 * only ever delays a test; it never changes what the limiter does.
 */
export async function awaitFreshWindow(windowSeconds: number, needMs: number): Promise<void> {
  const windowMs = windowSeconds * 1000;
  const left = windowMs - (Date.now() % windowMs);
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 50));
}
