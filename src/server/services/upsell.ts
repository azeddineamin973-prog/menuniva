import 'server-only';
import { z } from 'zod';
import type { UpsellRuleView } from '@/lib/upsell';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { rateLimit } from '../rate-limit';
import type { TenantContext } from '../tenant';

/** Upsell rules (M11-09/10): "when the cart has X (or something from category C), suggest Y". */

export const ruleSchema = z
  .object({
    trigger: z.string().regex(/^(product|category):[A-Za-z0-9_-]{1,40}$/),
    suggestedProductId: z.string().min(1).max(40),
    priority: z.coerce.number().int().min(0).max(100).default(0),
  })
  .transform((d) => {
    const [kind, id] = d.trigger.split(':');
    return { triggerProductId: kind === 'product' ? id : null, triggerCategoryId: kind === 'category' ? id : null, suggestedProductId: d.suggestedProductId, priority: d.priority };
  });

export async function createUpsellRule(ctx: TenantContext, input: unknown) {
  const d = ruleSchema.parse(input);
  const suggested = await db.menuProduct.findFirst({ where: { id: d.suggestedProductId, organizationId: ctx.org.id, status: { not: 'ARCHIVED' } } });
  if (!suggested) throw new UserFacingError('Choose a dish to suggest.');
  if (d.triggerProductId) {
    if (d.triggerProductId === d.suggestedProductId) throw new UserFacingError('A dish cannot suggest itself.');
    if (!(await db.menuProduct.findFirst({ where: { id: d.triggerProductId, organizationId: ctx.org.id } }))) throw new UserFacingError('Choose the dish that triggers the suggestion.');
  } else if (!(await db.menuCategory.findFirst({ where: { id: d.triggerCategoryId!, organizationId: ctx.org.id } }))) {
    throw new UserFacingError('Choose the category that triggers the suggestion.');
  }
  const dup = await db.upsellRule.findFirst({ where: { organizationId: ctx.org.id, triggerProductId: d.triggerProductId, triggerCategoryId: d.triggerCategoryId, suggestedProductId: d.suggestedProductId } });
  if (dup) throw new UserFacingError('This suggestion already exists.');
  const rule = await db.upsellRule.create({ data: { organizationId: ctx.org.id, ...d } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'upsell.rule_created', entityType: 'UpsellRule', entityId: rule.id });
  return rule;
}

async function ownedRule(ctx: TenantContext, id: string) {
  const r = await db.upsellRule.findFirst({ where: { id, organizationId: ctx.org.id } });
  if (!r) throw new UserFacingError('Suggestion not found.', 404);
  return r;
}

export async function setUpsellRuleActive(ctx: TenantContext, id: string, isActive: boolean) {
  const r = await ownedRule(ctx, id);
  await db.upsellRule.update({ where: { id: r.id }, data: { isActive } });
}

export async function deleteUpsellRule(ctx: TenantContext, id: string) {
  const r = await ownedRule(ctx, id);
  await db.upsellRule.delete({ where: { id: r.id } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'upsell.rule_deleted', entityType: 'UpsellRule', entityId: r.id });
}

export async function setUpsellEnabled(ctx: TenantContext, enabled: boolean) {
  await db.restaurantSettings.upsert({ where: { organizationId: ctx.org.id }, update: { upsellEnabled: enabled }, create: { organizationId: ctx.org.id, upsellEnabled: enabled } });
}

/** Rules with shown/accepted counts for the last 30 days. */
export async function upsellRulesAdmin(ctx: TenantContext) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [rules, counts] = await Promise.all([
    db.upsellRule.findMany({ where: { organizationId: ctx.org.id }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] }),
    db.upsellEvent.groupBy({ by: ['ruleId', 'eventType'], where: { organizationId: ctx.org.id, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const count = (ruleId: string, t: string) => counts.find((c) => c.ruleId === ruleId && c.eventType === t)?._count._all ?? 0;
  return rules.map((r) => ({ ...r, shown: count(r.id, 'SHOWN'), accepted: count(r.id, 'ACCEPTED') }));
}

/** Active rules for the guest menu; empty when the restaurant switched suggestions off. */
export async function upsellRulesFor(organizationId: string): Promise<UpsellRuleView[]> {
  const settings = await db.restaurantSettings.findUnique({ where: { organizationId } });
  if (settings && !settings.upsellEnabled) return [];
  const rules = await db.upsellRule.findMany({ where: { organizationId, isActive: true }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take: 100 });
  return rules.map((r) => ({ id: r.id, triggerProductId: r.triggerProductId, triggerCategoryId: r.triggerCategoryId, suggestedProductId: r.suggestedProductId }));
}

const eventSchema = z.object({ ruleId: z.string().min(1).max(40), type: z.enum(['SHOWN', 'ACCEPTED']) });

/** Public: records that a suggestion was shown or accepted. Anonymous; no personal data. */
export async function recordUpsellEvent(input: unknown, clientKey: string) {
  const d = eventSchema.parse(input);
  await rateLimit(`upsell:${clientKey}`, 120, 3600);
  const rule = await db.upsellRule.findFirst({ where: { id: d.ruleId, isActive: true } });
  if (!rule) throw new UserFacingError('not_found', 404);
  await db.upsellEvent.create({ data: { organizationId: rule.organizationId, ruleId: rule.id, eventType: d.type } });
  return { ok: true };
}
