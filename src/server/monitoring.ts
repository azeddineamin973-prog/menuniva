import 'server-only';
import { env } from './env';

/**
 * Error monitoring (M13-03). Errors are always stored in the ErrorLog table (Super Admin →
 * Integrations & errors). If ERROR_MONITORING_DSN is set to an https URL, a minimal JSON event
 * is also POSTed there (any webhook-style collector). Personal data is scrubbed first.
 */
const SENSITIVE = /pass(word)?|token|secret|cookie|authorization|phone|email|address|contact|name|birthday|notes?|comment/i;

/** Removes values of sensitive keys and long strings; keeps structure for debugging. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : scrub(v, depth + 1)]));
  }
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  return value;
}

/** Strips query strings (tokens, phone searches) from a path before it is logged. */
export function safePath(p: string | undefined | null) {
  if (!p) return null;
  return p.split('?')[0].replace(/\/(t|o|reservation|invite|reset-password)\/[^/]+/g, '/$1/[token]');
}

export function monitoringConfigured() {
  return !!env.ERROR_MONITORING_DSN && env.ERROR_MONITORING_DSN.startsWith('https://');
}

export async function forwardError(event: { source: string; message: string; stack?: string; context?: unknown }) {
  if (!monitoringConfigured()) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    await fetch(env.ERROR_MONITORING_DSN!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'menuniva', env: env.APP_ENV, at: new Date().toISOString(), ...event, stack: event.stack?.slice(0, 4000) }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    return true;
  } catch {
    return false; // monitoring must never break the request
  }
}
