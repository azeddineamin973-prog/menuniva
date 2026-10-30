import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { recordUpsellEvent } from '@/server/services/upsell';

// Public: anonymous SHOWN / ACCEPTED counters for cart suggestions.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    return NextResponse.json(await recordUpsellEvent(await req.json().catch(() => null), clientKeyFromRequest(req)), { status: 201 });
  } catch (e) {
    return handleRouteError('public-upsell', e);
  }
}
