import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RateLimitError } from './rate-limit';
import { AccessDeniedError, UserFacingError } from './errors';
import { logError } from './audit';

/**
 * CSRF protection for mutating route handlers: the browser always sends `Origin` on
 * cross-site POST/PUT/PATCH/DELETE. We require it to match the request host.
 * (Server Actions already get an equivalent built-in check from Next.js.)
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) throw new AccessDeniedError('forbidden');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AccessDeniedError('forbidden');
  }
  if (originHost !== host) throw new AccessDeniedError('forbidden');
}

export { UserFacingError };

/** Converts known errors into JSON responses without leaking internals. */
export async function handleRouteError(source: string, e: unknown) {
  if (e instanceof UserFacingError) return NextResponse.json({ error: e.code, details: e.details }, { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ error: 'validation_failed', issues: e.issues }, { status: 422 });
  if (e instanceof RateLimitError)
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: e.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(e.retryAfterSeconds) } },
    );
  if (e instanceof AccessDeniedError) {
    const status = e.reason === 'unauthenticated' ? 401 : e.reason === 'not_member' ? 404 : 403;
    return NextResponse.json({ error: 'access_denied' }, { status });
  }
  await logError(source, e);
  return NextResponse.json({ error: 'server_error' }, { status: 500 });
}
