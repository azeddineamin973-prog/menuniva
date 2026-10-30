import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getBillingProvider, recordManualBilling, voidBillingRecord } from '@/server/billing';
import { db } from '@/server/db';
import { hasModule, orgModules } from '@/server/modules';
import { platformMetrics, setTenantModules } from '@/server/services/admin';
import { submitFeedback } from '@/server/services/feedback';
import { submitPickupOrder } from '@/server/services/fulfilment';
import { planLimits, planUsage } from '@/server/services/limits';
import { loyaltyForOrder, updateLoyaltyProgram } from '@/server/services/loyalty';
import { saveProduct, setProductStatus } from '@/server/services/menu';
import { createRestaurant } from '@/server/services/organizations';
import { getPlatformConfig, updatePlatformConfig } from '@/server/services/platform-config';
import { savePromotion } from '@/server/services/promotions';
import { createUpsellRule, upsellRulesFor } from '@/server/services/upsell';
import { submitTableOrder } from '@/server/services/orders';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;
const PROMO = { channels: ['TABLE', 'TAKEAWAY', 'DELIVERY'], combinable: false, isActive: true, priority: 0, name: 'Test 10 %', type: 'PERCENTAGE', percent: '10' };
/** Moves the tenant from its trial to a paid ACTIVE subscription on `code`. */
async function activeOn(f: F, code: string) {
  const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code } });
  await db.subscription.update({ where: { organizationId: f.org.id }, data: { planId: plan.id, status: 'ACTIVE', trialEndsAt: null } });
}
const pickup = (f: F) =>
  submitPickupOrder({ orgSlug: f.org.slug, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }], pickup: 'asap', customerName: 'Test Guest', phone: '+351 900 000 002' }, `k${Math.random()}`);

describe('M12-09 module toggles (TEST 16: plan, trial, add-ons, switched off)', () => {
  beforeEach(resetDatabase);

  it('a new restaurant is on a trial with every module; after the trial only plan modules remain', async () => {
    const f = await createOrderingFixture();
    expect((await orgModules(f.org.id)).size).toBe(12);
    await db.subscription.update({ where: { organizationId: f.org.id }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    const m = await orgModules(f.org.id);
    expect([...m].sort()).toEqual(['feedback', 'import', 'kds', 'table_ordering', 'translations']);
  });

  it('starter plan: takeaway, promotions, upsell and loyalty are refused server-side; table ordering works', async () => {
    const f = await createOrderingFixture();
    await createUpsellRule(f.ctx, { trigger: `product:${f.dish.id}`, suggestedProductId: f.tea.id });
    await savePromotion(f.ctx, PROMO);
    await updateLoyaltyProgram(f.ctx, { enabled: true, type: 'STAMPS', stampsForReward: 5, pointsPerEuro: 1, rewardText: 'Test reward', expiryDays: '' });
    await activeOn(f, 'starter');
    await expect(pickup(f)).rejects.toMatchObject({ code: 'module_not_available' });
    await expect(savePromotion(f.ctx, { ...PROMO, name: 'Another' })).rejects.toMatchObject({ code: 'module_not_available' });
    await expect(createUpsellRule(f.ctx, { trigger: `product:${f.tea.id}`, suggestedProductId: f.dish.id })).rejects.toMatchObject({ code: 'module_not_available' });
    expect(await upsellRulesFor(f.org.id)).toEqual([]);
    // The promotion created during the trial no longer applies.
    const o = await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.dish.id, quantity: 1, modifiers: [] }] }, 'k');
    const stored = await db.order.findFirstOrThrow();
    expect(stored).toMatchObject({ totalCents: 1690, discountCents: 0 });
    expect(await loyaltyForOrder(o.trackingToken, 'pt')).toBeNull();
  });

  it('Super Admin add-ons and switch-offs are relative to the plan and survive plan changes', async () => {
    const f = await createOrderingFixture();
    await activeOn(f, 'starter');
    // Ticked: plan modules except feedback, plus loyalty as add-on.
    await setTenantModules(f.owner.id, f.org.id, ['table_ordering', 'kds', 'translations', 'import', 'loyalty', 'not_a_module']);
    expect(await db.restaurantOrganization.findUniqueOrThrow({ where: { id: f.org.id } })).toMatchObject({ enabledModules: ['loyalty'], disabledModules: ['feedback'] });
    expect(await hasModule(f.org.id, 'loyalty')).toBe(true);
    await expect(submitFeedback({ orgSlug: f.org.slug, rating: 5, language: 'pt' }, 'k')).rejects.toMatchObject({ code: 'module_not_available' });
    await activeOn(f, 'pro');
    const m = await orgModules(f.org.id);
    expect(m.has('feedback')).toBe(false); // still switched off by Super Admin
    expect(m.has('analytics_export')).toBe(true);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'platform.modules_updated' } });
    expect(log.metadata).toEqual({ addOns: ['loyalty'], switchedOff: ['feedback'] });
  });

  it('during a trial a module outside the plan can be switched off; it stays off after an upgrade until switched on', async () => {
    const f = await createOrderingFixture();
    const all = [...(await orgModules(f.org.id))];
    await setTenantModules(f.owner.id, f.org.id, all.filter((m) => m !== 'promotions'));
    expect(await db.restaurantOrganization.findUniqueOrThrow({ where: { id: f.org.id } })).toMatchObject({ enabledModules: [], disabledModules: ['promotions'] });
    expect(await hasModule(f.org.id, 'promotions')).toBe(false);
    await activeOn(f, 'growth');
    expect(await hasModule(f.org.id, 'promotions')).toBe(false);
    expect(await hasModule(f.org.id, 'reservations')).toBe(true); // untouched modules follow the new plan
    await setTenantModules(f.owner.id, f.org.id, [...(await orgModules(f.org.id)), 'promotions']);
    expect(await db.restaurantOrganization.findUniqueOrThrow({ where: { id: f.org.id } })).toMatchObject({ enabledModules: [], disabledModules: [] });
    expect(await hasModule(f.org.id, 'promotions')).toBe(true);
  });

  it('trials can be limited to plan modules by platform config', async () => {
    const f = await createOrderingFixture();
    await updatePlatformConfig(f.owner.id, { signupsOpen: true, defaultTrialDays: 14, trialIncludesAllModules: false, supportEmail: 'support@menuniva.example' });
    expect(await hasModule(f.org.id, 'takeaway')).toBe(false);
    expect(await getPlatformConfig()).toEqual({ signupsOpen: true, defaultTrialDays: 14, trialIncludesAllModules: false, supportEmail: 'support@menuniva.example' });
    const { org } = await createRestaurant({ name: 'Test Trial Length', country: 'PT' }, { actorUserId: null });
    const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(Math.round((sub.trialEndsAt!.getTime() - Date.now()) / 86400_000)).toBe(14);
    await expect(updatePlatformConfig(f.owner.id, { signupsOpen: true, defaultTrialDays: 900, trialIncludesAllModules: true, supportEmail: '' })).rejects.toThrow();
  });
});

describe('M12-05/06 plan limits and usage', () => {
  beforeEach(resetDatabase);

  it('dish limit refuses new dishes and un-archiving above the limit; usage is counted live', async () => {
    const f = await createOrderingFixture();
    const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: 'starter' } });
    await db.subscriptionPlan.update({ where: { id: plan.id }, data: { limits: { locations: 1, tables: 30, staff: 8, menuItems: 2 } } });
    expect(await planLimits(f.org.id)).toEqual({ locations: 1, tables: 30, staff: 8, menuItems: 2 });
    expect(await planUsage(f.org.id)).toMatchObject({ locations: 1, tables: 1, staff: 1, menuItems: 2 });
    await expect(saveProduct(f.ctx, { categoryId: f.dish.categoryId, status: 'DRAFT', translations: { pt: { name: 'Test extra' } }, prices: {} })).rejects.toThrow(/up to 2 dishes/);
    await setProductStatus(f.ctx, f.tea.id, 'ARCHIVED');
    expect((await planUsage(f.org.id)).menuItems).toBe(1);
    await saveProduct(f.ctx, { categoryId: f.dish.categoryId, status: 'DRAFT', translations: { pt: { name: 'Test extra' } }, prices: {} });
    await expect(setProductStatus(f.ctx, f.tea.id, 'DRAFT')).rejects.toThrow(/up to 2 dishes/);
  });
});

describe('M12-07 manual billing adapter', () => {
  beforeEach(resetDatabase);

  it('records genuine payments, voids with a reason; processor webhooks are refused', async () => {
    const f = await createOrderingFixture();
    await expect(recordManualBilling(f.owner.id, { organizationId: f.org.id, amount: 'abc', periodStart: '2026-11-01', periodEnd: '2026-11-30' })).rejects.toThrow(/amount/);
    await expect(recordManualBilling(f.owner.id, { organizationId: f.org.id, amount: '49,00', periodStart: '2026-11-30', periodEnd: '2026-11-01' })).rejects.toThrow();
    const r = await recordManualBilling(f.owner.id, { organizationId: f.org.id, amount: '49,00', periodStart: '2026-11-01', periodEnd: '2026-11-30', note: 'Transfer 123' });
    expect(r).toMatchObject({ amountCents: 4900, status: 'RECORDED_MANUALLY' });
    expect((await platformMetrics()).billedCents30).toBe(4900);
    await expect(voidBillingRecord(f.owner.id, r.id, '')).rejects.toThrow(/reason/);
    await voidBillingRecord(f.owner.id, r.id, 'Duplicate');
    expect((await db.billingRecord.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('VOIDED');
    expect((await platformMetrics()).billedCents30).toBe(0);
    const provider = getBillingProvider();
    expect(provider.status().mode).toBe('MANUAL');
    await expect(provider.verifyWebhook(new Request('http://x', { method: 'POST' }), '{"type":"payment_succeeded"}')).rejects.toMatchObject({ code: 'billing_provider_not_configured', status: 501 });
  });
});
