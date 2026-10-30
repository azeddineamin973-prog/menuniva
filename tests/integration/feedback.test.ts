import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { submitTableOrder } from '@/server/services/orders';
import { addFeedbackNote, feedbackInbox, feedbackStats, setFeedbackStatus, submitFeedback, updateReviewSettings } from '@/server/services/feedback';
import { updateChannelSettings } from '@/server/services/settings';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const GOOGLE = 'https://g.page/r/test-review-link/review';

async function withGoogleLink(f: F) {
  await db.reviewSettings.upsert({ where: { locationId: f.location.id }, update: { googleReviewUrl: GOOGLE }, create: { locationId: f.location.id, googleReviewUrl: GOOGLE } });
}
const send = (f: F, extra: Record<string, unknown> = {}) =>
  submitFeedback({ orgSlug: f.org.slug, rating: 5, language: 'en', ...extra }, `k${Math.random()}`);

describe('M11-02/03 customer feedback (TEST 13, TEST 14)', () => {
  beforeEach(resetDatabase);

  it('TEST 13: a 1★ rating creates a private manager alert AND still returns the Google link', async () => {
    const f = await createOrderingFixture();
    await withGoogleLink(f);
    const res = await send(f, { rating: 1, categories: ['WAITING_TIME', 'FOOD_QUALITY'], comment: 'Cold food, long wait' });
    expect(res.googleReviewUrl).toBe(GOOGLE);
    const n = await db.notification.findMany({ where: { organizationId: f.org.id, type: 'LOW_RATING' } });
    expect(n).toHaveLength(1);
    expect(n[0].entityId).toBe(res.id);
    const fb = await db.customerFeedback.findUniqueOrThrow({ where: { id: res.id } });
    expect(fb).toMatchObject({ rating: 1, status: 'NEW', comment: 'Cold food, long wait' });
  });

  it('TEST 14: a 5★ rating gets exactly the same link and response shape; no alert', async () => {
    const f = await createOrderingFixture();
    await withGoogleLink(f);
    const low = await send(f, { rating: 1 });
    const high = await send(f, { rating: 5 });
    expect(Object.keys(high).sort()).toEqual(Object.keys(low).sort());
    expect(high.googleReviewUrl).toBe(low.googleReviewUrl);
    expect(await db.notification.count({ where: { type: 'LOW_RATING' } })).toBe(1); // only the 1★ one
  });

  it('every rating 1–5 receives the identical Google link (no review gating)', async () => {
    const f = await createOrderingFixture();
    await withGoogleLink(f);
    const links = [];
    for (const rating of [1, 2, 3, 4, 5]) links.push((await send(f, { rating })).googleReviewUrl);
    expect(new Set(links)).toEqual(new Set([GOOGLE]));
  });

  it('without a configured Google link, nobody gets one (null for every rating)', async () => {
    const f = await createOrderingFixture();
    expect((await send(f, { rating: 1 })).googleReviewUrl).toBeNull();
    expect((await send(f, { rating: 5 })).googleReviewUrl).toBeNull();
  });

  it('contact details are stored only when the guest asks for follow-up; follow-up requires contact', async () => {
    const f = await createOrderingFixture();
    const a = await send(f, { rating: 2, contactName: 'Ana', contactInfo: '+351 900 000 001', wantsFollowUp: false });
    expect(await db.customerFeedback.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ contactName: null, contactInfo: null });
    const b = await send(f, { rating: 2, contactName: 'Ana', contactInfo: '+351 900 000 001', wantsFollowUp: true });
    expect(await db.customerFeedback.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ contactName: 'Ana', contactInfo: '+351 900 000 001', wantsFollowUp: true });
    await expect(send(f, { rating: 2, wantsFollowUp: true })).rejects.toThrow();
  });

  it('threshold is configurable; feedback can be switched off', async () => {
    const f = await createOrderingFixture();
    await updateReviewSettings(f.ctx, f.location.id, { lowRatingThreshold: 2, feedbackEnabled: true });
    await send(f, { rating: 3 });
    expect(await db.notification.count({ where: { type: 'LOW_RATING' } })).toBe(0);
    await send(f, { rating: 2 });
    expect(await db.notification.count({ where: { type: 'LOW_RATING' } })).toBe(1);
    await updateReviewSettings(f.ctx, f.location.id, { lowRatingThreshold: 2, feedbackEnabled: false });
    await expect(send(f, { rating: 4 })).rejects.toMatchObject({ code: 'feedback_disabled' });
  });

  it('linked to an order through its tracking token; a second submission for the same order is refused', async () => {
    const f = await createOrderingFixture();
    const o = await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'en', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'ip');
    const res = await send(f, { rating: 4, orderToken: o.trackingToken });
    const order = await db.order.findFirstOrThrow();
    expect((await db.customerFeedback.findUniqueOrThrow({ where: { id: res.id } })).orderId).toBe(order.id);
    await expect(send(f, { rating: 1, orderToken: o.trackingToken })).rejects.toMatchObject({ code: 'already_submitted' });
  });

  it('rejects invalid ratings and unknown restaurants', async () => {
    const f = await createOrderingFixture();
    await expect(send(f, { rating: 0 })).rejects.toThrow();
    await expect(send(f, { rating: 6 })).rejects.toThrow();
    await expect(send(f, { orgSlug: 'no-such-restaurant' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('M11-01 review settings', () => {
  beforeEach(resetDatabase);
  it('only an https Google link is accepted as the official review link, per location', async () => {
    const f = await createOrderingFixture();
    await expect(updateChannelSettings(f.ctx, { locationId: f.location.id, googleReviewUrl: 'https://evil.example/review' })).rejects.toThrow();
    await expect(updateChannelSettings(f.ctx, { locationId: f.location.id, googleReviewUrl: 'http://g.page/r/x/review' })).rejects.toThrow();
    await updateChannelSettings(f.ctx, { locationId: f.location.id, googleReviewUrl: GOOGLE });
    expect((await send(f, { rating: 3 })).googleReviewUrl).toBe(GOOGLE);
  });
});

describe('M11-04/05 feedback inbox, statuses, notes, stats', () => {
  beforeEach(resetDatabase);

  it('status changes mark the alert read; notes are internal; stats count repeated issues', async () => {
    const f = await createOrderingFixture();
    const a = await send(f, { rating: 1, categories: ['WAITING_TIME'] });
    await send(f, { rating: 2, categories: ['WAITING_TIME', 'SERVICE'] });
    await send(f, { rating: 5, categories: ['WAITING_TIME'] }); // positive ratings don't count as issues
    await setFeedbackStatus(f.ctx, a.id, 'INVESTIGATING');
    expect(await db.notification.count({ where: { entityId: a.id, readAt: null } })).toBe(0);
    await addFeedbackNote(f.ctx, a.id, 'Called the guest, offered apology.');
    await setFeedbackStatus(f.ctx, a.id, 'RESOLVED');
    const inbox = await feedbackInbox(f.ctx, {});
    expect(inbox).toHaveLength(3);
    const item = inbox.find((x) => x.id === a.id)!;
    expect(item.status).toBe('RESOLVED');
    expect(item.resolvedAt).not.toBeNull();
    expect(item.notes.map((n) => n.body)).toEqual(['Called the guest, offered apology.']);
    expect(await feedbackInbox(f.ctx, { maxRating: 2 })).toHaveLength(2);
    expect(await feedbackInbox(f.ctx, { status: 'RESOLVED' })).toHaveLength(1);
    const s = await feedbackStats(f.ctx);
    expect(s).toMatchObject({ count: 3, average: 2.7, distribution: [1, 1, 0, 0, 1], open: 2, lowResolved: 1, lowTotal: 2 });
    expect(s.issues).toEqual([['WAITING_TIME', 2], ['SERVICE', 1]]);
    await expect(setFeedbackStatus(f.ctx, a.id, 'PUBLISHED')).rejects.toThrow(/Invalid status/);
    await setFeedbackStatus(f.ctx, a.id, 'ARCHIVED');
    expect(await feedbackInbox(f.ctx, {})).toHaveLength(2); // archived hidden by default
  });

  it('TEST 15 (feedback): another restaurant cannot read or change this feedback', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    const fb = await send(a, { rating: 1 });
    expect(await feedbackInbox(b.ctx, {})).toHaveLength(0);
    expect((await feedbackStats(b.ctx)).count).toBe(0);
    await expect(setFeedbackStatus(b.ctx, fb.id, 'RESOLVED')).rejects.toThrow(/not found/);
    await expect(addFeedbackNote(b.ctx, fb.id, 'sneaky note')).rejects.toThrow(/not found/);
    await expect(feedbackInbox(b.ctx, { locationId: a.location.id })).rejects.toThrow();
    await expect(updateReviewSettings(b.ctx, a.location.id, { lowRatingThreshold: 1, feedbackEnabled: true })).rejects.toThrow();
    expect(await db.customerFeedback.findUniqueOrThrow({ where: { id: fb.id } })).toMatchObject({ status: 'NEW' });
  });
});
