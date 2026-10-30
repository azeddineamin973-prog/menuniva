import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { enrolFromOrder } from '@/server/services/loyalty';

// Public: voluntary loyalty enrolment from the guest's own order page (consent required).
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    return NextResponse.json(await enrolFromOrder(await req.json().catch(() => null), clientKeyFromRequest(req)), { status: 201 });
  } catch (e) {
    return handleRouteError('public-loyalty', e);
  }
}
