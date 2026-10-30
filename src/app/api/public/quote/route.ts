import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { clientKeyFromRequest } from '@/server/client-key';
import { db } from '@/server/db';
import { assertSameOrigin, handleRouteError } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { resolveTableToken } from '@/server/services/orders';
import { cartSchema, quoteCart } from '@/server/services/pricing';
import { computeDiscounts } from '@/server/services/promotions';

const schema = z.object({
  qrToken: z.string().min(10).max(64).optional(),
  orgSlug: z.string().max(60).optional(),
  locationSlug: z.string().max(60).optional(),
  channel: z.enum(['TABLE', 'TAKEAWAY', 'DELIVERY']),
  language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]),
  items: cartSchema,
  couponCode: z.string().trim().max(30).optional(),
});

// Public: authoritative price check for the cart review screen (no order is created).
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await rateLimit(`quote:${clientKeyFromRequest(req)}`, 120, 600);
    const d = schema.parse(await req.json().catch(() => null));
    let locationId: string | null = null;
    if (d.channel === 'TABLE') {
      const table = d.qrToken ? await resolveTableToken(d.qrToken) : null;
      locationId = table?.locationId ?? null;
    } else if (d.orgSlug && d.locationSlug) {
      const loc = await db.restaurantLocation.findFirst({ where: { slug: d.locationSlug, organization: { slug: d.orgSlug } }, select: { id: true, isPublished: true } });
      locationId = loc?.isPublished ? loc.id : null;
    }
    if (!locationId) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const q = await quoteCart({ locationId, channel: d.channel, lang: d.language, items: d.items });
    const loc = await db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId }, select: { organizationId: true } });
    const promo = await computeDiscounts(db, { organizationId: loc.organizationId, locationId, channel: d.channel, couponCode: d.couponCode, lines: q.lines, subtotalCents: q.subtotalCents });
    return NextResponse.json({
      subtotalCents: q.subtotalCents,
      discountCents: promo.totalCents,
      discounts: promo.discounts.map((x) => ({ description: x.description, amountCents: x.amountCents })),
      couponStatus: promo.couponStatus,
      totalCents: q.subtotalCents - promo.totalCents,
      issues: q.issues,
      lines: q.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, lineTotalCents: l.lineTotalCents })),
    });
  } catch (e) {
    return handleRouteError('public-quote', e);
  }
}
