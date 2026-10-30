import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { submitPickupOrder } from '@/server/services/fulfilment';
import { OrderRejectedError } from '@/server/services/orders';

// Public: takeaway / pickup order. Committed to PostgreSQL before 201 is returned.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const result = await submitPickupOrder(await req.json().catch(() => null), clientKeyFromRequest(req));
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof OrderRejectedError) return NextResponse.json({ error: e.code, issues: e.issues, ...e.extra }, { status: 422 });
    return handleRouteError('public-order-pickup', e);
  }
}
