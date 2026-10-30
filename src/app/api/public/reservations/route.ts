import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { requestReservation, ReservationRejectedError } from '@/server/services/reservations';

// Public: reservation REQUEST (the restaurant confirms). Availability re-checked with a lock.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const r = await requestReservation(await req.json().catch(() => null), clientKeyFromRequest(req));
    return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof ReservationRejectedError) return NextResponse.json({ error: e.code }, { status: 422 });
    return handleRouteError('public-reservation', e);
  }
}
