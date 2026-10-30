import 'server-only';
import { NextResponse } from 'next/server';
import type { Permission } from '@/lib/permissions';
import { assertSameOrigin, handleRouteError } from './http';
import { requireTenantAction, type TenantContext } from './tenant';

/**
 * Wrapper for dashboard JSON route handlers: CSRF origin check on mutations, session +
 * membership + permission check on every call, uniform error responses.
 */
export async function tenantRoute(
  req: Request,
  orgSlug: string,
  permission: Permission,
  fn: (ctx: TenantContext) => Promise<unknown>,
  source: string,
) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
    const ctx = await requireTenantAction(orgSlug, permission);
    const data = await fn(ctx);
    return NextResponse.json(data ?? { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return handleRouteError(source, e);
  }
}
