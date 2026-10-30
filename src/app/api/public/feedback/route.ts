import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { submitFeedback } from '@/server/services/feedback';

// Public: private guest feedback. The response always has the same shape, whatever the rating.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    return NextResponse.json(await submitFeedback(await req.json().catch(() => null), clientKeyFromRequest(req)), { status: 201 });
  } catch (e) {
    return handleRouteError('public-feedback', e);
  }
}
