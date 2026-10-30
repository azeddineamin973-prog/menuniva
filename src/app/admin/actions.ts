'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { toActionError } from '@/server/action';
import { db } from '@/server/db';
import { audit } from '@/server/audit';
import { adminCreateTenant, setTenantModules, setTenantStatus, updatePlan, updateSubscription } from '@/server/services/admin';
import { createPasswordResetLink } from '@/server/auth/reset';
import { requirePlatformAdminAction } from '@/server/tenant';
import { UserFacingError } from '@/server/errors';
import { recordManualBilling, voidBillingRecord } from '@/server/billing';
import { updatePlatformConfig } from '@/server/services/platform-config';

async function adminRun<T>(fn: (adminId: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const admin = await requirePlatformAdminAction();
    const data = await fn(admin.id);
    revalidatePath('/admin', 'layout');
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createTenantAction(_p: ActionResult, form: FormData) {
  return adminRun(async (adminId) => {
    const r = await adminCreateTenant(adminId, Object.fromEntries(form));
    return { slug: r.org.slug, id: r.org.id, inviteLink: r.inviteLink, ownerExisted: r.ownerExisted };
  });
}

export async function setTenantStatusAction(_p: ActionResult, form: FormData) {
  return adminRun((adminId) => setTenantStatus(adminId, Object.fromEntries(form)));
}

export async function updateSubscriptionAction(_p: ActionResult, form: FormData) {
  return adminRun((adminId) => updateSubscription(adminId, Object.fromEntries(form)));
}

export async function setModulesAction(_p: ActionResult, form: FormData) {
  return adminRun((adminId) => setTenantModules(adminId, String(form.get('organizationId')), form.getAll('modules').map(String)));
}

export async function updatePlanAction(_p: ActionResult, form: FormData) {
  return adminRun((adminId) => updatePlan(adminId, Object.fromEntries(form)));
}

/** Generates a single-use reset link for a user (used while SMTP is not configured). */
export async function adminResetLinkAction(_p: ActionResult, form: FormData) {
  return adminRun(async (adminId) => {
    const user = await db.user.findUnique({ where: { email: String(form.get('email') ?? '').trim().toLowerCase() } });
    if (!user) throw new UserFacingError('No user with this email.');
    const link = await createPasswordResetLink(user.id);
    await audit({ actorUserId: adminId, action: 'platform.reset_link_created', entityType: 'User', entityId: user.id });
    return { link };
  });
}

export async function updateSupportTicketAction(_p: ActionResult, form: FormData) {
  return adminRun(async (adminId) => {
    const id = String(form.get('id'));
    const status = String(form.get('status'));
    if (!['OPEN', 'IN_PROGRESS', 'CLOSED'].includes(status)) throw new UserFacingError('Invalid status.');
    await db.supportTicket.update({ where: { id }, data: { status } });
    await audit({ actorUserId: adminId, action: 'platform.support_ticket_updated', entityType: 'SupportTicket', entityId: id, metadata: { status } });
  });
}
export async function recordBillingAction(_p: ActionResult, form: FormData) {
  return adminRun(async (adminId) => {
    await recordManualBilling(adminId, Object.fromEntries(form));
  });
}
export async function voidBillingAction(_p: ActionResult, form: FormData) {
  return adminRun((adminId) => voidBillingRecord(adminId, String(form.get('recordId')), String(form.get('reason') ?? '')));
}
export async function updatePlatformConfigAction(_p: ActionResult, form: FormData) {
  return adminRun((adminId) =>
    updatePlatformConfig(adminId, {
      signupsOpen: form.get('signupsOpen') === 'on',
      trialIncludesAllModules: form.get('trialIncludesAllModules') === 'on',
      defaultTrialDays: form.get('defaultTrialDays'),
      supportEmail: form.get('supportEmail'),
    }),
  );
}
