'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { cancelPlanChangeRequest, createSupportRequest, requestPlanChange } from '@/server/services/support';

const R = { revalidate: '/dashboard/[org]' };

export async function supportRequestAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => createSupportRequest(ctx, { subject: form.get('subject'), body: form.get('body') }), R);
}

export async function planChangeAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'billing.view', (ctx) => requestPlanChange(ctx, String(form.get('planId')), String(form.get('note') ?? '')), R);
}

export async function cancelPlanChangeAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'billing.view', (ctx) => cancelPlanChangeRequest(ctx), R);
}
