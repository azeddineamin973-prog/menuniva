'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { createUpsellRule, deleteUpsellRule, setUpsellEnabled, setUpsellRuleActive } from '@/server/services/upsell';

const R = { revalidate: '/dashboard/[org]' };

export async function createUpsellRuleAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => createUpsellRule(ctx, { trigger: form.get('trigger'), suggestedProductId: form.get('suggestedProductId'), priority: form.get('priority') || 0 }), R);
}

export async function toggleUpsellRuleAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => setUpsellRuleActive(ctx, String(form.get('ruleId')), form.get('active') === 'true'), R);
}

export async function deleteUpsellRuleAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => deleteUpsellRule(ctx, String(form.get('ruleId'))), R);
}

export async function upsellEnabledAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => setUpsellEnabled(ctx, form.get('enabled') === 'true'), R);
}
