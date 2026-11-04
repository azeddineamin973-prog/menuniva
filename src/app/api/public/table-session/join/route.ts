import { NextResponse } from 'next/server';
import { clientIdentity } from '@/server/client-identity';
import { env } from '@/server/env';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { grantCookie, grantTokensFromRequest, joinTableSession, TableAccessError } from '@/server/services/table-access';

/**
 * Public: a guest phone enters the table's temporary PIN once per seating. On success the phone
 * receives an httpOnly cookie holding a random authorisation token (only its hash is stored),
 * valid for this table session only. The PIN itself is never returned or stored by the browser.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { identity } = clientIdentity(req);
    const existing = grantTokensFromRequest(req);
    const result = await joinTableSession(await req.json().catch(() => null), identity, existing);
    const res = NextResponse.json({ joined: result.joined, required: result.required, tableLabel: result.tableLabel }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    if (result.joined && result.token) {
      const c = grantCookie(result.token, existing, env.APP_BASE_URL.startsWith('https://') || new URL(req.url).protocol === 'https:');
      res.cookies.set(c.name, c.value, c.options);
    }
    return res;
  } catch (e) {
    if (e instanceof TableAccessError) return NextResponse.json({ error: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
    return handleRouteError('public-table-join', e);
  }
}
