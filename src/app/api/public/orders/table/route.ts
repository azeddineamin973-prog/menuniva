import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { OrderRejectedError, submitTableOrder } from '@/server/services/orders';

// Public: guest submits a table order. The order is committed to PostgreSQL before 201 is returned.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await req.json().catch(() => null);
    const result = await submitTableOrder(body, clientKeyFromRequest(req));
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof OrderRejectedError) return NextResponse.json({ error: e.code, issues: e.issues }, { status: 422 });
    return handleRouteError('public-order-table', e);
  }
}
