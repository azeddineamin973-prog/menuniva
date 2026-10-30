/**
 * Next.js instrumentation (M13-03): unhandled errors in pages, route handlers and server actions
 * are recorded in ErrorLog (and forwarded to ERROR_MONITORING_DSN when configured).
 * Paths are stored without query strings and with private tokens masked.
 */
export async function onRequestError(error: unknown, request: { path: string; method: string }, context: { routerKind: string; routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Expected control flow (redirect / notFound) is not an error.
  const digest = (error as { digest?: string } | null)?.digest ?? '';
  if (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')) return;
  try {
    const [{ logError }, { safePath }] = await Promise.all([import('./server/audit'), import('./server/monitoring')]);
    await logError(`request:${context.routeType}`, error, { method: request.method, path: safePath(request.path), route: context.routePath, digest: digest || null });
  } catch {
    // e.g. invalid configuration: the original error is already printed by Next.js
  }
}
