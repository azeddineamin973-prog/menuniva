import { after, NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { OrderRejectedError, submitTableOrder } from '@/server/services/orders';
import { grantTokensFromRequest } from '@/server/services/table-access';

// Public: guest submits a table order. The order is committed to PostgreSQL before 201 is returned.
// The phone's table authorisation (if the location requires one) travels in its httpOnly cookie.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await req.json().catch(() => null);
    // Rate-limit success counts and the phone's "last used" time are written after the answer (after()).
    const result = await submitTableOrder(body, clientKeyFromRequest(req), { grantTokens: grantTokensFromRequest(req), afterResponse: (work) => after(work) });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof OrderRejectedError) return NextResponse.json({ error: e.code, issues: e.issues }, { status: 422 });
    return handleRouteError('public-order-table', e);
  }
}
