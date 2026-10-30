import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { recordPayment, voidPayment } from '@/server/services/bills';
import { submitFeedback } from '@/server/services/feedback';
import { deleteLoyaltyAccount, earnAmount, enrolFromOrder, expireLoyalty, loyaltyForOrder, loyaltyMembers, normalizePhone, redeemReward, setMarketingOptIn, updateLoyaltyProgram } from '@/server/services/loyalty';
import { changeOrderStatus, submitTableOrder } from '@/server/services/orders';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const PROGRAM = { enabled: true, type: 'STAMPS', stampsForReward: 2, pointsPerEuro: 1, rewardText: 'Free mint tea', expiryDays: '' };

async function placeOrder(f: F) {
  const o = await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, `ip${Math.random()}`);
  const order = await db.order.findFirstOrThrow({ where: { number: o.orderNumber, organizationId: f.org.id } });
  return { token: o.trackingToken, order };
}
async function complete(f: F, orderId: string) {
  await changeOrderStatus(f.ctx, { orderId, expectedFrom: 'NEW', to: 'ACCEPTED' });
  await db.kitchenTicket.updateMany({ where: { orderId }, data: { status: 'READY' } });
  await changeOrderStatus(f.ctx, { orderId, expectedFrom: 'ACCEPTED', to: 'READY' });
  await changeOrderStatus(f.ctx, { orderId, expectedFrom: 'READY', to: 'COMPLETED' });
}
const pay = (f: F, orderId: string, amountCents = 1690) => recordPayment(f.ctx, { orderId, method: 'CASH', amountCents });
const enrol = (token: string, extra: Record<string, unknown> = {}) => enrolFromOrder({ orderToken: token, phone: '+351 912 345 678', consent: true, ...extra }, `k${Math.random()}`);
const balance = async (f: F) => (await db.loyaltyAccount.findFirstOrThrow({ where: { organizationId: f.org.id, deletedAt: null } })).balance;

describe('M11-06 loyalty program settings', () => {
  beforeEach(resetDatabase);
  it('validates settings; cannot be switched on without a reward; off by default', async () => {
    const f = await createOrderingFixture();
    const { token } = await placeOrder(f);
    expect(await loyaltyForOrder(token, 'pt')).toBeNull(); // no program → nothing shown
    await expect(updateLoyaltyProgram(f.ctx, { ...PROGRAM, rewardText: '' })).rejects.toThrow();
    await expect(updateLoyaltyProgram(f.ctx, { ...PROGRAM, expiryDays: 5 })).rejects.toThrow();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    expect(await loyaltyForOrder(token, 'en')).toMatchObject({ type: 'STAMPS', target: 2, reward: 'Free mint tea', joined: false });
    await updateLoyaltyProgram(f.ctx, { ...PROGRAM, enabled: false });
    expect(await loyaltyForOrder(token, 'pt')).toBeNull();
  });

  it('earn amounts: 1 stamp per order, or whole points for goods (delivery fee excluded)', () => {
    expect(earnAmount({ type: 'STAMPS', pointsPerEuro: 1 }, { totalCents: 4590, deliveryFeeCents: 250 })).toBe(1);
    expect(earnAmount({ type: 'POINTS', pointsPerEuro: 2 }, { totalCents: 4590, deliveryFeeCents: 250 })).toBe(86); // 43.40 € × 2
    expect(normalizePhone('00351 912-345-678')).toBe('+351912345678');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('M11-07 voluntary enrolment with consent', () => {
  beforeEach(resetDatabase);
  it('requires explicit consent; marketing and birthday are separate opt-ins', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    const { token } = await placeOrder(f);
    await expect(enrol(token, { consent: false })).rejects.toThrow();
    await expect(enrol(token, { phone: 'abc' })).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(enrol(token, { birthday: '07-14' })).rejects.toThrow(); // birthday without its consent
    await enrol(token);
    const a = await db.loyaltyAccount.findFirstOrThrow();
    expect(a).toMatchObject({ phone: '+351912345678', marketingOptIn: false, marketingOptInAt: null, birthday: null });
    expect(a.consentAt).toBeInstanceOf(Date);
    await expect(enrol(token)).rejects.toMatchObject({ code: 'already_joined' });

    const second = await placeOrder(f);
    await enrol(second.token, { phone: '+351 933 000 000', marketingOptIn: true, birthday: '07-14', birthdayConsent: true });
    expect(await db.loyaltyAccount.findFirstOrThrow({ where: { phone: '+351933000000' } })).toMatchObject({ marketingOptIn: true, birthday: '07-14' });
  });

  it('joining with an existing number links the order but never changes that member’s consents', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    await enrol((await placeOrder(f)).token);
    const other = await placeOrder(f);
    await enrol(other.token, { marketingOptIn: true, birthday: '01-01', birthdayConsent: true, name: 'Someone else' });
    expect(await db.loyaltyAccount.count()).toBe(1);
    expect(await db.loyaltyAccount.findFirstOrThrow()).toMatchObject({ marketingOptIn: false, birthday: null, name: null });
    expect((await db.order.findUniqueOrThrow({ where: { id: other.order.id } })).loyaltyAccountId).not.toBeNull();
  });
});

describe('M11-08 earn / redeem / expire', () => {
  beforeEach(resetDatabase);
  it('earns only when the order is completed AND fully paid, exactly once', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    const { token, order } = await placeOrder(f);
    await enrol(token);
    await pay(f, order.id, 1000); // partial
    await complete(f, order.id);
    expect(await balance(f)).toBe(0); // completed but not fully paid
    await pay(f, order.id, 690);
    expect(await balance(f)).toBe(1);
    expect(await loyaltyForOrder(token, 'pt')).toMatchObject({ joined: true, balance: 1, earnedForThisOrder: true });
    expect(await db.loyaltyTransaction.count({ where: { type: 'EARN', orderId: order.id } })).toBe(1);
  });

  it('paid first, completed later also earns once; voiding the payment reverses it', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    const { token, order } = await placeOrder(f);
    await enrol(token);
    const p = await pay(f, order.id);
    expect(await balance(f)).toBe(0); // paid but still NEW
    await complete(f, order.id);
    expect(await balance(f)).toBe(1);
    const payment = await db.paymentRecord.findFirstOrThrow({ where: { orderId: order.id } });
    expect(p).toBeDefined();
    await voidPayment(f.ctx, payment.id, 'Typed the wrong table');
    expect(await balance(f)).toBe(0);
    await pay(f, order.id);
    expect(await balance(f)).toBe(1);
    expect(await db.loyaltyTransaction.count({ where: { type: 'EARN', orderId: order.id } })).toBe(2);
    expect(await db.loyaltyTransaction.count({ where: { type: 'ADJUST', orderId: order.id } })).toBe(1);
  });

  it('enrolling after the order was already completed and paid earns immediately', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    const { token, order } = await placeOrder(f);
    await pay(f, order.id);
    await complete(f, order.id);
    await enrol(token);
    expect(await balance(f)).toBe(1);
  });

  it('staff redeem only with enough stamps; expired lots are removed oldest-first', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, { ...PROGRAM, expiryDays: 30 });
    for (let i = 0; i < 3; i++) {
      const { token, order } = await placeOrder(f);
      await enrol(token); // same phone each time → same member
      await pay(f, order.id);
      await complete(f, order.id);
    }
    const acc = await db.loyaltyAccount.findFirstOrThrow();
    expect(acc.balance).toBe(3);
    await redeemReward(f.ctx, acc.id); // uses the 2 oldest stamps
    expect(await balance(f)).toBe(1);
    await expect(redeemReward(f.ctx, acc.id)).rejects.toThrow(/Not enough stamps/);
    expect(await expireLoyalty(f.org.id, new Date(Date.now() + 10 * 86400_000))).toBe(0); // nothing due yet
    expect(await expireLoyalty(f.org.id, new Date(Date.now() + 31 * 86400_000))).toBe(1); // the remaining stamp
    expect(await balance(f)).toBe(0);
    expect(await expireLoyalty(f.org.id, new Date(Date.now() + 40 * 86400_000))).toBe(0); // idempotent
  });

  it('loyalty is never tied to reviews: feedback of any rating changes nothing', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    const { token } = await placeOrder(f);
    await enrol(token);
    await submitFeedback({ orgSlug: f.org.slug, orderToken: token, rating: 5, language: 'pt' }, 'k');
    expect(await balance(f)).toBe(0);
    expect(await db.loyaltyTransaction.count()).toBe(0);
  });

  it('member deletion erases personal data; staff can withdraw but never grant marketing consent', async () => {
    const f = await createOrderingFixture();
    await updateLoyaltyProgram(f.ctx, PROGRAM);
    const { token, order } = await placeOrder(f);
    await enrol(token, { marketingOptIn: true, birthday: '03-03', birthdayConsent: true, name: 'Ana' });
    await pay(f, order.id);
    await complete(f, order.id);
    const acc = await db.loyaltyAccount.findFirstOrThrow();
    await expect(setMarketingOptIn(f.ctx, acc.id, true)).rejects.toThrow(/only be given by the guest/);
    await setMarketingOptIn(f.ctx, acc.id, false);
    expect((await db.loyaltyAccount.findUniqueOrThrow({ where: { id: acc.id } })).marketingOptIn).toBe(false);
    expect(await loyaltyMembers(f.ctx, '912 345')).toHaveLength(1);
    await deleteLoyaltyAccount(f.ctx, acc.id);
    const gone = await db.loyaltyAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(gone).toMatchObject({ name: null, birthday: null, balance: 0 });
    expect(gone.phone).not.toContain('912');
    expect(gone.deletedAt).not.toBeNull();
    expect(await db.loyaltyTransaction.count()).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).loyaltyAccountId).toBeNull();
    expect(await loyaltyMembers(f.ctx)).toHaveLength(0);
    // The same guest can join again later with a fresh consent.
    await enrol((await placeOrder(f)).token);
    expect(await loyaltyMembers(f.ctx)).toHaveLength(1);
  });

  it('TEST 15 (loyalty): another restaurant cannot see, redeem or delete members', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await updateLoyaltyProgram(a.ctx, PROGRAM);
    await enrol((await placeOrder(a)).token);
    const acc = await db.loyaltyAccount.findFirstOrThrow();
    expect(await loyaltyMembers(b.ctx)).toHaveLength(0);
    await expect(redeemReward(b.ctx, acc.id)).rejects.toThrow();
    await expect(deleteLoyaltyAccount(b.ctx, acc.id)).rejects.toThrow(/not found/);
    await expect(setMarketingOptIn(b.ctx, acc.id, false)).rejects.toThrow(/not found/);
  });
});
