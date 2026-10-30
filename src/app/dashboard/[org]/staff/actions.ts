'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { createPasswordResetLink } from '@/server/auth/reset';
import { audit } from '@/server/audit';
import { db } from '@/server/db';
import { UserFacingError } from '@/server/errors';
import { inviteStaff, revokeInvitation, updateMember } from '@/server/services/invitations';
import { assignableRoles } from '@/lib/permissions';

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
  return runTenantAction(form.get('org'), 'staff.manage', async (ctx) => {
    const member = await db.restaurantMembership.findFirst({ where: { id: String(form.get('membershipId')), organizationId: ctx.org.id } });
    if (!member || !assignableRoles(ctx.role).includes(member.role) || member.userId === ctx.userId) throw new UserFacingError('You cannot reset this password.');
    // A user who belongs to other restaurants can only be reset by the platform admin.
    const otherOrgs = await db.restaurantMembership.count({ where: { userId: member.userId, organizationId: { not: ctx.org.id } } });
    if (otherOrgs > 0) throw new UserFacingError('This person also works for another restaurant. Ask MenuNiva support to reset the password.');
    const link = await createPasswordResetLink(member.userId);
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'staff.reset_link_created', entityType: 'RestaurantMembership', entityId: member.id });
    return { link };
  });
}
