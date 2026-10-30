import { NextResponse } from 'next/server';
import { getBillingProvider } from '@/server/billing';
import { handleRouteError } from '@/server/http';

// Billing processor webhooks. With manual billing (today) every call is refused with 501;
// a future processor must verify the signature inside verifyWebhook before any change is made.
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    await getBillingProvider().verifyWebhook(req, raw);
    return NextResponse.json({ error: 'not_implemented' }, { status: 501 });
  } catch (e) {
    return handleRouteError('billing-webhook', e);
  }
}
