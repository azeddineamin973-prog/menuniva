import 'server-only';
import { z } from 'zod';
import type { FeedbackCategoryCode, LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { audit } from '../audit';
import { hashToken } from '../crypto';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { rateLimit } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';

/**
 * Smart Reviews (Part 15) — non-negotiable rules implemented here:
 * - the restaurant's Google review link is returned to EVERY guest, independent of rating
 *   (no review gating). The link is resolved without looking at the rating at all;
 * - feedback is private and never published automatically;
 * - no incentive (loyalty or discount) is ever connected to reviews;
 * - contact details are stored only when the guest asks to be contacted.
 */

export const FEEDBACK_CATEGORIES = ['FOOD_QUALITY', 'SERVICE', 'WAITING_TIME', 'CLEANLINESS', 'VALUE', 'DELIVERY', 'OTHER'] as const;

/** Official Google review link of a location. Takes no rating parameter by design. */
export async function googleReviewLinkFor(locationId: string): Promise<string | null> {
  const r = await db.reviewSettings.findUnique({ where: { locationId } });
  return r?.googleReviewUrl ?? null;
}

export async function feedbackLocation(orgSlug: string, locationSlug?: string | null, orderToken?: string | null) {
  const org = await db.restaurantOrganization.findUnique({ where: { slug: orgSlug }, include: { settings: true } });
  if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED') return null;
  let order: { id: string; locationId: string } | null = null;
  if (orderToken && /^[A-Za-z0-9_-]{20,64}$/.test(orderToken)) {
    order = await db.order.findFirst({ where: { trackingTokenHash: hashToken(orderToken), organizationId: org.id }, select: { id: true, locationId: true } });
  }
  const location = await db.restaurantLocation.findFirst({
    where: { organizationId: org.id, isPublished: true, ...(order ? { id: order.locationId } : locationSlug ? { slug: locationSlug } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  return location ? { org, location, order } : null;
}

export const feedbackSchema = z
  .object({
    orgSlug: z.string().max(60),
    locationSlug: z.string().max(60).optional(),
    orderToken: z.string().max(64).optional(),
    rating: z.coerce.number().int().min(1).max(5),
    categories: z.array(z.enum(FEEDBACK_CATEGORIES)).max(7).default([]),
    comment: z.string().trim().max(2000).optional(),
    wantsFollowUp: z.boolean().default(false),
    contactName: z.string().trim().max(80).optional(),
    contactInfo: z.string().trim().max(120).optional(),
    language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]),
  })
  .refine((d) => !d.wantsFollowUp || !!d.contactInfo, { path: ['contactInfo'], message: 'required' });

export async function submitFeedback(input: unknown, clientKey: string) {
  const d = feedbackSchema.parse(input);
  const target = await feedbackLocation(d.orgSlug, d.locationSlug, d.orderToken);
  if (!target) throw new UserFacingError('not_found', 404);
  const { org, location, order } = target;
  if (org.settings && !org.settings.feedbackEnabled) throw new UserFacingError('feedback_disabled', 422);
  await rateLimit(`feedback:${location.id}:${clientKey}`, 5, 3600);
  if (order && (await db.customerFeedback.findFirst({ where: { orderId: order.id } }))) throw new UserFacingError('already_submitted', 409);
  const settings = await db.reviewSettings.findUnique({ where: { locationId: location.id } });
  const fb = await db.customerFeedback.create({
    data: {
      organizationId: org.id,
      locationId: location.id,
      orderId: order?.id ?? null,
      rating: d.rating,
      categories: [...new Set(d.categories)] as FeedbackCategoryCode[],
      comment: d.comment || null,
      wantsFollowUp: d.wantsFollowUp,
      // Contact details are kept only when the guest explicitly asked to be contacted.
      contactName: d.wantsFollowUp ? d.contactName || null : null,
      contactInfo: d.wantsFollowUp ? d.contactInfo || null : null,
      language: d.language,
    },
  });
  if (d.rating <= (settings?.lowRatingThreshold ?? 3)) {
    await db.notification.create({
      data: { organizationId: org.id, locationId: location.id, type: 'LOW_RATING', title: `${d.rating}★ feedback${d.wantsFollowUp ? ' — guest asks to be contacted' : ''}`, body: d.comment?.slice(0, 200) ?? null, entityId: fb.id },
    });
  }
  // Same response shape for every rating: the Google link does not depend on the score.
  return { id: fb.id, googleReviewUrl: await googleReviewLinkFor(location.id) };
}

// ------------------------------------------------------------------ manager side (M11-03/04/05)

export async function feedbackInbox(ctx: TenantContext, filter: { status?: string; maxRating?: number; locationId?: string }) {
  if (filter.locationId) await assertLocationAccess(ctx, filter.locationId);
  return db.customerFeedback.findMany({
    where: {
      organizationId: ctx.org.id,
      ...(filter.locationId ? { locationId: filter.locationId } : ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}),
      ...(filter.status ? { status: filter.status as never } : { status: { not: 'ARCHIVED' } }),
      ...(filter.maxRating ? { rating: { lte: filter.maxRating } } : {}),
    },
    include: { notes: { orderBy: { createdAt: 'asc' } }, order: { select: { number: true, channel: true } } },
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
  });
}

async function ownedFeedback(ctx: TenantContext, id: string) {
  const f = await db.customerFeedback.findFirst({ where: { id, organizationId: ctx.org.id } });
  if (!f) throw new UserFacingError('Feedback not found.', 404);
  await assertLocationAccess(ctx, f.locationId);
  return f;
}

export async function setFeedbackStatus(ctx: TenantContext, id: string, status: string) {
  if (!['NEW', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED'].includes(status)) throw new UserFacingError('Invalid status.');
  const f = await ownedFeedback(ctx, id);
  await db.customerFeedback.update({ where: { id: f.id }, data: { status: status as never, resolvedAt: status === 'RESOLVED' ? new Date() : f.resolvedAt } });
  await db.notification.updateMany({ where: { organizationId: ctx.org.id, type: 'LOW_RATING', entityId: f.id, readAt: null }, data: { readAt: new Date() } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'feedback.status_changed', entityType: 'CustomerFeedback', entityId: f.id, metadata: { from: f.status, to: status } });
}

export async function addFeedbackNote(ctx: TenantContext, id: string, body: string) {
  const text = body.trim();
  if (text.length < 2 || text.length > 2000) throw new UserFacingError('Write a note (2–2000 characters).');
  const f = await ownedFeedback(ctx, id);
  await db.feedbackInternalNote.create({ data: { feedbackId: f.id, authorId: ctx.userId, body: text } });
}

/** Aggregates for the last N days: average, distribution, repeated issues among low ratings. */
export async function feedbackStats(ctx: TenantContext, days = 30, locationId?: string) {
  if (locationId) await assertLocationAccess(ctx, locationId);
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.customerFeedback.findMany({
    where: {
      organizationId: ctx.org.id,
      createdAt: { gte: since },
      ...(locationId ? { locationId } : ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}),
    },
    select: { rating: true, categories: true, status: true },
  });
  const distribution = [1, 2, 3, 4, 5].map((r) => rows.filter((x) => x.rating === r).length);
  const issues: Record<string, number> = {};
  for (const r of rows.filter((x) => x.rating <= 3)) for (const c of r.categories) issues[c] = (issues[c] ?? 0) + 1;
  const low = rows.filter((x) => x.rating <= 3);
  return {
    count: rows.length,
    average: rows.length ? Math.round((rows.reduce((s, x) => s + x.rating, 0) / rows.length) * 10) / 10 : null,
    distribution,
    issues: Object.entries(issues).sort((a, b) => b[1] - a[1]),
    open: rows.filter((x) => x.status === 'NEW' || x.status === 'INVESTIGATING').length,
    lowResolved: low.filter((x) => x.status === 'RESOLVED' || x.status === 'ARCHIVED').length,
    lowTotal: low.length,
  };
}

export async function updateReviewSettings(ctx: TenantContext, locationId: string, input: { lowRatingThreshold: number; feedbackEnabled: boolean }) {
  await assertLocationAccess(ctx, locationId);
  const t = z.number().int().min(1).max(4).parse(input.lowRatingThreshold);
  await db.reviewSettings.upsert({ where: { locationId }, update: { lowRatingThreshold: t }, create: { locationId, lowRatingThreshold: t } });
  await db.restaurantSettings.upsert({ where: { organizationId: ctx.org.id }, update: { feedbackEnabled: input.feedbackEnabled }, create: { organizationId: ctx.org.id, feedbackEnabled: input.feedbackEnabled } });
}
