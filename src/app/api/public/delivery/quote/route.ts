import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { clientKeyFromRequest } from '@/server/client-key';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { publicLocation, quoteDelivery } from '@/server/services/fulfilment';

const schema = z.object({ orgSlug: z.string().max(60), locationSlug: z.string().max(60).optional(), postalCode: z.string().max(12), language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]), items: z.unknown(), couponCode: z.string().trim().max(30).optional() });

// Public: delivery coverage + fee + totals for a postal code (no order is created).
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await rateLimit(`delivery-quote:${clientKeyFromRequest(req)}`, 120, 600);
    const d = schema.parse(await req.json().catch(() => null));
    const pl = await publicLocation(d.orgSlug, d.locationSlug);
    if (!pl || !pl.location.deliveryEnabled) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(await quoteDelivery(pl, d.postalCode, d.language, d.items, new Date(), d.couponCode));
  } catch (e) {
    return handleRouteError('public-delivery-quote', e);
  }
}
