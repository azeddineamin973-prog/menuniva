import 'server-only';
import { z } from 'zod';
import type { MembershipRole } from '@/generated/prisma/enums';
import { assignableRoles } from '@/lib/permissions';
import { audit } from '../audit';
import { createPasswordResetLink } from '../auth/reset';
import { hashToken, newSecretToken } from '../crypto';
import { db } from '../db';
import { env } from '../env';
import { UserFacingError } from '../errors';
import type { TenantContext } from '../tenant';

const INVITE_DAYS = 7;
export const ROLES = ['RESTAURANT_OWNER', 'RESTAURANT_MANAGER', 'WAITER', 'KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'] as const;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(ROLES),
  locationIds: z.array(z.string()).default([]),
});

/**
 * Creates an invitation and returns the acceptance link. Without SMTP the link is shown to
 * the inviter to share personally (honest: nothing is emailed).
 */
export async function createInvitationRecord(params: {
  organizationId: string;
  email: string;
  role: MembershipRole;
  locationIds: string[];
  invitedById: string;
}): Promise<string> {
  const token = newSecretToken();
  await db.invitation.updateMany({
    where: { organizationId: params.organizationId, email: params.email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await db.invitation.create({
    data: { ...params, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) },
  });
  return `${env.APP_BASE_URL}/invite/${token}`;
}

/**
 * Locations a member may be given: existing locations of this restaurant, and for a manager
 * restricted to some locations only those (never "all locations", which would be wider than theirs).
 */
async function assertAssignableLocations(ctx: TenantContext, locationIds: string[]) {
  if (ctx.locationIds.length && (!locationIds.length || locationIds.some((l) => !ctx.locationIds.includes(l)))) throw new UserFacingError('You can only give access to your own locations.');
  if (locationIds.length) {
    const count = await db.restaurantLocation.count({ where: { id: { in: [...new Set(locationIds)] }, organizationId: ctx.org.id } });
    if (count !== new Set(locationIds).size) throw new UserFacingError('Invalid location.');
  }
}

export async function inviteStaff(ctx: TenantContext, input: unknown) {
  const data = inviteSchema.parse(input);
  if (!assignableRoles(ctx.role).includes(data.role)) throw new UserFacingError('You cannot assign this role.');
  await assertAssignableLocations(ctx, data.locationIds);
  const existingMember = await db.restaurantMembership.findFirst({ where: { organizationId: ctx.org.id, user: { email: data.email } } });
  if (existingMember) throw new UserFacingError('This person is already a member of this restaurant.');
  await enforceStaffLimit(ctx.org.id);
  const link = await createInvitationRecord({ organizationId: ctx.org.id, email: data.email, role: data.role, locationIds: data.locationIds, invitedById: ctx.userId });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'staff.invited', entityType: 'Invitation', metadata: { email: data.email, role: data.role } });
  return { link };
}

export async function enforceStaffLimit(organizationId: string) {
  const sub = await db.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  const limit = (sub?.plan.limits as { staff?: number } | null)?.staff;
  if (!limit) return;
  const [members, pending] = await Promise.all([
    db.restaurantMembership.count({ where: { organizationId, status: { not: 'DISABLED' } } }),
    db.invitation.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  if (members + pending >= limit) throw new UserFacingError(`Your plan allows up to ${limit} staff accounts.`);
}

export async function findInvitation(token: string) {
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: { select: { name: true, slug: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Accepts an invitation for the signed-in user. The user's email must match the invited email. */
export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  return db.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new UserFacingError('This invitation is invalid or has expired.');
    if (inv.email !== user.email.toLowerCase()) throw new UserFacingError(`This invitation was sent to ${inv.email}. Sign in with that email.`);
    await tx.restaurantMembership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: inv.organizationId } },
      update: { role: inv.role, status: 'ACTIVE', locationIds: inv.locationIds },
      create: { userId: user.id, organizationId: inv.organizationId, role: inv.role, locationIds: inv.locationIds },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await audit({ organizationId: inv.organizationId, actorUserId: user.id, action: 'staff.invitation_accepted', entityType: 'Invitation', entityId: inv.id, metadata: { role: inv.role } }, tx);
    const org = await tx.restaurantOrganization.findUniqueOrThrow({ where: { id: inv.organizationId }, select: { slug: true } });
    return org.slug;
  });
}

export const updateMemberSchema = z.object({
  membershipId: z.string().min(1),
  role: z.enum(ROLES),
  status: z.enum(['ACTIVE', 'DISABLED']),
  locationIds: z.array(z.string()).default([]),
});

/** Role/status changes with guard rails: managers cannot touch owners/managers; the last owner is protected. */
export async function updateMember(ctx: TenantContext, input: unknown) {
  const data = updateMemberSchema.parse(input);
  const member = await db.restaurantMembership.findFirst({ where: { id: data.membershipId, organizationId: ctx.org.id } });
  if (!member) throw new UserFacingError('Staff member not found.');
  const allowed = assignableRoles(ctx.role);
  if (!allowed.includes(member.role) || !allowed.includes(data.role)) throw new UserFacingError('You cannot change this staff member.');
  // A manager restricted to some locations only manages staff of those locations.
  if (ctx.locationIds.length && !member.locationIds.some((l) => ctx.locationIds.includes(l))) throw new UserFacingError('You cannot change this staff member.');
  await assertAssignableLocations(ctx, data.locationIds);
  if (member.id === ctx.membershipId && data.status === 'DISABLED') throw new UserFacingError('You cannot disable your own account.');
  if (member.role === 'RESTAURANT_OWNER' && (data.role !== 'RESTAURANT_OWNER' || data.status === 'DISABLED')) {
    const owners = await db.restaurantMembership.count({ where: { organizationId: ctx.org.id, role: 'RESTAURANT_OWNER', status: 'ACTIVE' } });
    if (owners <= 1) throw new UserFacingError('A restaurant must keep at least one active owner.');
  }
  // Access ends immediately: every request re-reads the membership (resolveTenantAccess), so a
  // disabled member is refused on their next click without signing them out of other restaurants.
  await db.restaurantMembership.update({ where: { id: member.id }, data: { role: data.role, status: data.status, locationIds: data.locationIds } });
  await audit({
    organizationId: ctx.org.id,
    actorUserId: ctx.userId,
    action: 'staff.updated',
    entityType: 'RestaurantMembership',
    entityId: member.id,
    metadata: { from: { role: member.role, status: member.status }, to: { role: data.role, status: data.status } },
  });
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string) {
  const res = await db.invitation.updateMany({ where: { id: invitationId, organizationId: ctx.org.id, acceptedAt: null }, data: { revokedAt: new Date() } });
  if (res.count) await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'staff.invitation_revoked', entityType: 'Invitation', entityId: invitationId });
}

/**
 * Single-use reset link for a staff member of THIS restaurant, made by an owner or manager.
 * Never for the caller, a MenuNiva administrator (that would hand over the whole platform), another
 * owner, someone who also works for another restaurant, or (for a manager limited to some
 * locations) staff of other locations: those go through MenuNiva support.
 */
export async function createStaffResetLink(ctx: TenantContext, membershipId: string) {
  const member = await db.restaurantMembership.findFirst({ where: { id: membershipId, organizationId: ctx.org.id }, include: { user: { select: { platformRole: true } } } });
  if (!member || !assignableRoles(ctx.role).includes(member.role) || member.userId === ctx.userId) throw new UserFacingError('You cannot reset this password.');
  if (member.user.platformRole !== 'USER' || member.role === 'RESTAURANT_OWNER') throw new UserFacingError('Ask MenuNiva support to reset this password.');
  if (ctx.locationIds.length && !member.locationIds.some((l) => ctx.locationIds.includes(l))) throw new UserFacingError('You cannot reset this password.');
  const otherOrgs = await db.restaurantMembership.count({ where: { userId: member.userId, organizationId: { not: ctx.org.id } } });
  if (otherOrgs > 0) throw new UserFacingError('This person also works for another restaurant. Ask MenuNiva support to reset the password.');
  const link = await createPasswordResetLink(member.userId);
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'staff.reset_link_created', entityType: 'RestaurantMembership', entityId: member.id });
  return link;
}
