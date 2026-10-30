import 'server-only';
import { z } from 'zod';
import { audit } from '../audit';
import { db } from '../db';
import { env } from '../env';
import { UserFacingError } from '../errors';
import { createInvitationRecord } from './invitations';
import { createRestaurant } from './organizations';
import { isModuleKey, MODULES } from '@/lib/modules';
import { orgModuleState } from '../modules';

/**
 * Platform Super Admin operations. Every function here must be called only after
 * requirePlatformAdminAction(); every mutation is audited.
 * Cross-tenant metrics are aggregate counts only — no guest comments or contact data.
 */

export async function listTenants() {
  const orgs = await db.restaurantOrganization.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      subscription: { include: { plan: true } },
      _count: { select: { locations: true, memberships: true, products: true, orders: true } },
    },
  });
  return orgs;
}

export async function platformMetrics() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [tenants, active, suspended, trialing, users, orders30, errors7] = await Promise.all([
    db.restaurantOrganization.count({ where: { isDemo: false } }),
    db.restaurantOrganization.count({ where: { status: 'ACTIVE', isDemo: false } }),
    db.restaurantOrganization.count({ where: { status: 'SUSPENDED' } }),
    db.subscription.count({ where: { status: 'TRIALING' } }),
    db.user.count(),
    db.order.count({ where: { createdAt: { gte: since }, organization: { isDemo: false } } }),
    db.errorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } } }),
  ]);
  const soon = new Date(Date.now() + 7 * 86400_000);
  const [pastDue, trialsEndingSoon, newTenants30, openTickets, byPlan, billed30] = await Promise.all([
    db.subscription.count({ where: { status: 'PAST_DUE', organization: { isDemo: false } } }),
    db.subscription.count({ where: { status: 'TRIALING', trialEndsAt: { gte: new Date(), lte: soon }, organization: { isDemo: false } } }),
    db.restaurantOrganization.count({ where: { isDemo: false, createdAt: { gte: since } } }),
    db.supportTicket.count({ where: { status: { not: 'CLOSED' } } }),
    db.subscription.groupBy({ by: ['planId'], where: { organization: { isDemo: false } }, _count: { _all: true } }),
    db.billingRecord.aggregate({ where: { status: { not: 'VOIDED' }, createdAt: { gte: since } }, _sum: { amountCents: true } }),
  ]);
  const plans = await db.subscriptionPlan.findMany({ select: { id: true, name: true } });
  const tenantsByPlan = byPlan.map((b) => ({ plan: plans.find((p) => p.id === b.planId)?.name ?? b.planId, count: b._count._all }));
  return { tenants, active, suspended, trialing, users, orders30, errors7, pastDue, trialsEndingSoon, newTenants30, openTickets, tenantsByPlan, billedCents30: billed30._sum.amountCents ?? 0 };
}

export const adminCreateTenantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  country: z.enum(['PT', 'ES']),
  city: z.string().trim().max(80).optional(),
  ownerEmail: z.string().trim().toLowerCase().email().max(254),
});

export async function adminCreateTenant(adminId: string, input: unknown) {
  const data = adminCreateTenantSchema.parse(input);
  const owner = await db.user.findUnique({ where: { email: data.ownerEmail } });
  const { org } = await createRestaurant({ name: data.name, country: data.country, city: data.city || undefined }, { ownerUserId: owner?.id, actorUserId: adminId });
  let inviteLink: string | null = null;
  if (!owner) {
    inviteLink = await createInvitationRecord({ organizationId: org.id, email: data.ownerEmail, role: 'RESTAURANT_OWNER', locationIds: [], invitedById: adminId });
  }
  await audit({ organizationId: org.id, actorUserId: adminId, action: 'platform.tenant_created', entityType: 'RestaurantOrganization', entityId: org.id, metadata: { ownerEmail: data.ownerEmail } });
  return { org, inviteLink, ownerExisted: !!owner };
}

export const tenantStatusSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']),
  reason: z.string().trim().max(500).optional(),
});

export async function setTenantStatus(adminId: string, input: unknown) {
  const data = tenantStatusSchema.parse(input);
  if (data.status === 'SUSPENDED' && !data.reason) throw new UserFacingError('Please give a reason for suspending this account.');
  const org = await db.restaurantOrganization.findUnique({ where: { id: data.organizationId } });
  if (!org) throw new UserFacingError('Tenant not found.');
  await db.$transaction(async (tx) => {
    await tx.restaurantOrganization.update({ where: { id: org.id }, data: { status: data.status } });
    if (data.status === 'SUSPENDED') {
      await tx.subscription.updateMany({ where: { organizationId: org.id }, data: { status: 'SUSPENDED', suspendedReason: data.reason } });
    }
    await audit(
      { organizationId: org.id, actorUserId: adminId, action: 'platform.tenant_status_changed', entityType: 'RestaurantOrganization', entityId: org.id, metadata: { from: org.status, to: data.status, reason: data.reason ?? null } },
      tx,
    );
  });
}

export const subscriptionUpdateSchema = z.object({
  organizationId: z.string().min(1),
  planId: z.string().min(1),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']),
  billingPeriod: z.enum(['MONTHLY', 'YEARLY']),
  trialEndsAt: z.preprocess((v) => (v === '' || v == null ? null : new Date(String(v))), z.date().nullable()),
  currentPeriodEnd: z.preprocess((v) => (v === '' || v == null ? null : new Date(String(v))), z.date().nullable()),
});

/** Manual subscription management (no billing processor connected). */
export async function updateSubscription(adminId: string, input: unknown) {
  const data = subscriptionUpdateSchema.parse(input);
  const plan = await db.subscriptionPlan.findUnique({ where: { id: data.planId } });
  if (!plan) throw new UserFacingError('Plan not found.');
  const before = await db.subscription.findUnique({ where: { organizationId: data.organizationId } });
  await db.subscription.upsert({
    where: { organizationId: data.organizationId },
    update: { planId: plan.id, status: data.status, billingPeriod: data.billingPeriod, trialEndsAt: data.trialEndsAt, currentPeriodEnd: data.currentPeriodEnd, provider: 'manual' },
    create: { organizationId: data.organizationId, planId: plan.id, status: data.status, billingPeriod: data.billingPeriod, trialEndsAt: data.trialEndsAt, currentPeriodEnd: data.currentPeriodEnd },
  });
  await audit({
    organizationId: data.organizationId,
    actorUserId: adminId,
    action: 'platform.subscription_updated',
    entityType: 'Subscription',
    metadata: { before: before ? { planId: before.planId, status: before.status } : null, after: { planId: plan.id, status: data.status } },
  });
}

export { MODULES };

/**
 * Saves the modules Super Admin wants ON for a tenant. Only modules whose state changed are
 * recorded, relative to what the tenant gets anyway (plan, or everything during a trial):
 * switching on something outside that base makes it an add-on; switching off something in the
 * base marks it switched off. Untouched modules keep following the plan, so upgrades still work.
 */
export async function setTenantModules(adminId: string, organizationId: string, modules: string[]) {
  const wanted = new Set(modules.filter(isModuleKey));
  const state = await orgModuleState(organizationId);
  if (!state) throw new UserFacingError('Tenant not found.');
  const enabled = new Set(state.enabled.filter(isModuleKey));
  const disabled = new Set(state.disabled.filter(isModuleKey));
  for (const m of MODULES) {
    const on = wanted.has(m);
    if (on === state.effective.has(m)) continue;
    if (on) {
      disabled.delete(m);
      if (!state.base.has(m)) enabled.add(m);
    } else {
      enabled.delete(m);
      if (state.base.has(m)) disabled.add(m);
    }
  }
  const enabledModules = MODULES.filter((m) => enabled.has(m));
  const disabledModules = MODULES.filter((m) => disabled.has(m));
  await db.restaurantOrganization.update({ where: { id: organizationId }, data: { enabledModules, disabledModules } });
  await audit({ organizationId, actorUserId: adminId, action: 'platform.modules_updated', entityType: 'RestaurantOrganization', entityId: organizationId, metadata: { addOns: enabledModules, switchedOff: disabledModules } });
}

export const planUpdateSchema = z.object({
  planId: z.string().min(1),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  monthlyPriceCents: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(0).nullable()),
  limits: z.preprocess((v) => (typeof v === 'string' ? JSON.parse(v) : v), z.object({ locations: z.number().int().min(1), tables: z.number().int().min(0), staff: z.number().int().min(1), menuItems: z.number().int().min(1) })),
  isActive: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
});

export async function updatePlan(adminId: string, input: unknown) {
  const data = planUpdateSchema.parse(input);
  await db.subscriptionPlan.update({
    where: { id: data.planId },
    data: { name: data.name, description: data.description ?? null, monthlyPriceCents: data.monthlyPriceCents, limits: data.limits, isActive: data.isActive },
  });
  await audit({ actorUserId: adminId, action: 'platform.plan_updated', entityType: 'SubscriptionPlan', entityId: data.planId, metadata: { name: data.name, monthlyPriceCents: data.monthlyPriceCents } });
}

/** Honest integration status derived from configuration, never from assumptions. */
export function integrationHealth() {
  return [
    { name: 'PostgreSQL database', status: 'CONNECTED', note: 'Checked on every request' },
    { name: 'Machine translation', status: env.TRANSLATION_PROVIDER === 'none' ? 'NOT_CONFIGURED' : 'CONFIGURED (unverified until first call)', note: `Provider: ${env.TRANSLATION_PROVIDER}` },
    { name: 'Email (SMTP)', status: env.SMTP_URL ? 'CONFIGURED' : 'NOT_CONFIGURED', note: 'Invitations and resets are shown as links until configured' },
    { name: 'Glovo partner API', status: env.GLOVO_PARTNER_API_KEY ? 'CREDENTIALS PRESENT' : 'NOT_CONFIGURED', note: 'Requires Glovo partner approval' },
    { name: 'Uber Eats Menu API', status: env.UBER_EATS_CLIENT_ID ? 'CREDENTIALS PRESENT' : 'NOT_CONFIGURED', note: 'Requires Uber partner approval' },
    { name: 'SaaS billing processor', status: env.BILLING_PROVIDER === 'manual' ? 'MANUAL' : 'CONFIGURED', note: 'Subscriptions are managed manually' },
    { name: 'Online customer payments', status: 'NOT_CONFIGURED', note: 'Pay at counter / waiter / cash on delivery only' },
    { name: 'Certified invoicing', status: 'NOT_CONFIGURED', note: 'MenuNiva receipts are not legal invoices' },
    { name: 'Error monitoring', status: env.ERROR_MONITORING_DSN ? 'CONFIGURED' : 'BUILT-IN LOG ONLY', note: 'Errors are stored in the ErrorLog table' },
  ];
}
