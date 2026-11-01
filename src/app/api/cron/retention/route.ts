import { NextResponse } from 'next/server';
import { logError } from '@/server/audit';
import { safeEqual } from '@/server/crypto';
import { env } from '@/server/env';
import { applyRetention } from '@/server/services/privacy';

/**
 * Daily data-retention job for hosts without a cron daemon (`npm run retention` elsewhere).
 * Vercel Cron calls it (vercel.json) with `Authorization: Bearer $CRON_SECRET`. Without
 * CRON_SECRET, or with any other caller, the route does not exist.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return new NextResponse('Not found', { status: 404 });
  try {
    return NextResponse.json(await applyRetention(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    await logError('cron-retention', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
