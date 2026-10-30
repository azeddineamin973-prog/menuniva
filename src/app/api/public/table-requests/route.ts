import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { createTableRequest } from '@/server/services/staff-tasks';

// Public: "Call waiter" / "Request the bill" from a table.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const result = await createTableRequest(await req.json().catch(() => null), clientKeyFromRequest(req));
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return handleRouteError('public-table-request', e);
  }
}
