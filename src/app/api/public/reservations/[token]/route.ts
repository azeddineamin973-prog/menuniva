import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { cancelReservationByToken } from '@/server/services/reservations';

/**
 * Public: the guest cancels their own reservation using the private link they were given.
 * DELETE rather than POST because it removes their booking, and the token in the path is the
 * only thing that can reach it.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(req);
    const { token } = await params;
    const res = await cancelReservationByToken(token, clientKeyFromRequest(req));
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.reason === 'not_found' ? 404 : 422 });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return handleRouteError('public-reservation-cancel', e);
  }
}
