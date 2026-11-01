'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { createStaffResetLink, inviteStaff, revokeInvitation, updateMember } from '@/server/services/invitations';

export async function inviteStaffAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'staff.manage',
    (ctx) => inviteStaff(ctx, { email: form.get('email'), role: form.get('role'), locationIds: form.getAll('locationIds').map(String).filter(Boolean) }),
    { revalidate: '/dashboard/[org]/staff' },
  );
}

export async function updateMemberAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'staff.manage',
    (ctx) => updateMember(ctx, { membershipId: form.get('membershipId'), role: form.get('role'), status: form.get('status'), locationIds: form.getAll('locationIds').map(String).filter(Boolean) }),
    { revalidate: '/dashboard/[org]/staff' },
  );
}

export async function revokeInvitationAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'staff.manage', (ctx) => revokeInvitation(ctx, String(form.get('invitationId'))), { revalidate: '/dashboard/[org]/staff' });
}

/** Owner/manager generates a single-use reset link for a staff member of THIS restaurant. */
export async function staffResetLinkAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'staff.manage', async (ctx) => ({ link: await createStaffResetLink(ctx, String(form.get('membershipId'))) }));
}
