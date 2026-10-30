import { NextResponse } from 'next/server';
import { handleRouteError } from '@/server/http';
import { trackOrder } from '@/server/services/orders';

// Public: order status for the guest who holds the unguessable tracking token.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const order = await trackOrder(token);
    if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(
      { number: order.number, channel: order.channel, status: order.status, totalCents: order.totalCents, events: order.events, cancelReason: order.status === 'CANCELLED' ? order.cancelReason : null },
      { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
    );
  } catch (e) {
    return handleRouteError('public-order-track', e);
  }
}
