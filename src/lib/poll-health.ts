/**
 * Connection health for dashboard polling (Live Orders, kitchen displays, sidebar counts).
 * Pure functions, shared by the polling hook and its tests (audit OPS-03, OPS-47).
 */

/** Answers that will not fix themselves by retrying soon: say so instead of "connection lost". */
export type PollProblem = 'expired' | 'forbidden' | 'not_found';
export type PollOutcome = { kind: 'ok' } | { kind: 'problem'; problem: PollProblem } | { kind: 'retry'; retryAfterMs?: number };
/** What staff are shown. `connecting`: no answer yet. */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** No successful answer for this long (several tries) means offline, even if the device thinks it is online. */
export const OFFLINE_AFTER_MS = 30_000;
/** Problems (signed out, access removed, location gone) are re-checked this often: they recover by themselves when fixed elsewhere. */
export const PROBLEM_RETRY_MS = 15_000;
/** Longest wait between tries (also the most a 429 Retry-After is honoured for). */
const MAX_BACKOFF_MS = 30_000;

/**
 * Status codes from `tenantRoute`: 401 = not signed in, 403 = no permission (or not this
 * location), 404 + `access_denied` = no longer a member of this restaurant, any other 404 = the
 * location / station itself is missing. 429 and 5xx are temporary.
 */
export function classifyResponse(status: number, body: unknown, retryAfter?: string | null): PollOutcome {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 401) return { kind: 'problem', problem: 'expired' };
  if (status === 403) return { kind: 'problem', problem: 'forbidden' };
  if (status === 404) return { kind: 'problem', problem: (body as { error?: unknown } | null)?.error === 'access_denied' ? 'forbidden' : 'not_found' };
  const seconds = Number(retryAfter);
  if (status === 429 && Number.isFinite(seconds) && seconds > 0) return { kind: 'retry', retryAfterMs: Math.min(seconds * 1000, MAX_BACKOFF_MS) };
  return { kind: 'retry' };
}

/** A request taking longer than this is aborted (≈ two intervals, between 6 and 15 s). */
export function timeoutFor(intervalMs: number) {
  return Math.min(15_000, Math.max(6_000, intervalMs * 2));
}

/**
 * Wait before the next try after `failures` failures in a row: the first retry comes quickly,
 * then the wait doubles, with ±20 % jitter so many tablets do not retry in step. The longest wait
 * is three intervals, between 15 and 30 s: an order board (4–5 s polling) notices within 15 s that
 * the server is back; the sidebar counts (10 s) wait up to 30 s.
 */
export function retryDelay(failures: number, intervalMs: number, random: () => number = Math.random) {
  const cap = Math.min(MAX_BACKOFF_MS, Math.max(15_000, intervalMs * 3));
  const base = failures <= 1 ? Math.min(2_000, intervalMs) : Math.min(cap, intervalMs * 2 ** (failures - 2));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Live only while the latest answer is recent and nothing failed since. A request that hangs
 * stops being "live" after one interval plus its timeout even before it is aborted.
 */
export function connectionState(f: { lastOkAt: number | null; failures: number; browserOffline: boolean; now: number; intervalMs: number }): ConnectionState {
  if (f.browserOffline) return 'offline';
  if (f.lastOkAt === null) return f.failures === 0 ? 'connecting' : f.failures >= 3 ? 'offline' : 'reconnecting';
  const age = f.now - f.lastOkAt;
  if (f.failures === 0 && age <= f.intervalMs + timeoutFor(f.intervalMs)) return 'live';
  return age >= OFFLINE_AFTER_MS ? 'offline' : 'reconnecting';
}
