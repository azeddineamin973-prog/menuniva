import 'server-only';
import { z } from 'zod';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { rateLimit } from '../rate-limit';
import type { TenantContext } from '../tenant';

/** Restaurant → MenuNiva support requests and plan change requests (handled in Super Admin). */

const requestSchema = z.object({ subject: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(4000) });

export async function createSupportRequest(ctx: TenantContext, input: unknown) {
  const d = requestSchema.parse(input);
  await rateLimit(`support:${ctx.org.id}`, 20, 86400);
  const t = await db.supportTicket.create({ data: { organizationId: ctx.org.id, subject: d.subject, body: d.body, createdById: ctx.userId } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'support.request_created', entityType: 'SupportTicket', entityId: t.id });
  return t;
}

export async function mySupportRequests(ctx: TenantContext) {
  return db.supportTicket.findMany({ where: { organizationId: ctx.org.id }, orderBy: { createdAt: 'desc' }, take: 50 });
}

/** Owner asks to move to another plan. Nothing changes until Super Admin applies it. */
export async function requestPlanChange(ctx: TenantContext, planId: string, note?: string) {
  const [sub, plan] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId: ctx.org.id }, include: { plan: true } }),
    db.subscriptionPlan.findFirst({ where: { id: planId, isActive: true } }),
  ]);
  if (!sub) throw new UserFacingError('No subscription yet. Contact support.');
  if (!plan) throw new UserFacingError('Choose an available plan.');
  if (plan.id === sub.planId) throw new UserFacingError('This is already your plan.');
  const direction = plan.sortOrder > sub.plan.sortOrder ? 'upgrade' : 'downgrade';
  await db.$transaction(async (tx) => {
    await tx.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: plan.id } });
    await tx.supportTicket.create({
      data: { organizationId: ctx.org.id, createdById: ctx.userId, subject: `Plan ${direction} request: ${sub.plan.name} → ${plan.name}`, body: note?.trim().slice(0, 2000) || `The owner asked to ${direction} to ${plan.name}.` },
    });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'subscription.change_requested', entityType: 'Subscription', entityId: sub.id, metadata: { from: sub.planId, to: plan.id, direction } }, tx);
  });
  return { direction };
}

export async function cancelPlanChangeRequest(ctx: TenantContext) {
  await db.subscription.updateMany({ where: { organizationId: ctx.org.id }, data: { pendingPlanId: null } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'subscription.change_request_cancelled', entityType: 'Subscription' });
}

/** Super Admin decision on a pending plan change. */
export async function decidePlanChange(adminId: string, organizationId: string, apply: boolean) {
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub?.pendingPlanId) throw new UserFacingError('There is no pending plan change.');
  await db.subscription.update({ where: { id: sub.id }, data: apply ? { planId: sub.pendingPlanId, pendingPlanId: null } : { pendingPlanId: null } });
  await audit({ organizationId, actorUserId: adminId, action: apply ? 'platform.plan_change_applied' : 'platform.plan_change_declined', entityType: 'Subscription', entityId: sub.id, metadata: { from: sub.planId, to: sub.pendingPlanId } });
}
