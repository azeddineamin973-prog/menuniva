import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type { MembershipRole, OrganizationStatus } from '@/generated/prisma/enums';
import { can, type Permission } from '@/lib/permissions';
import { db } from './db';
import { getCurrentUser, type CurrentUser } from './auth/session';

import { AccessDeniedError } from './errors';

export { AccessDeniedError };

export type TenantContext = {
  userId: string;
  membershipId: string;
  role: MembershipRole;
  /** empty = access to all locations of the organization */
  locationIds: string[];
  org: { id: string; slug: string; name: string; status: OrganizationStatus; isDemo: boolean };
  can: (p: Permission) => boolean;
};

/**
 * Core authorization check, independent of Next.js request APIs so it can be tested
 * directly. Every protected operation goes through this function: the organization is
 * looked up by slug and the user's ACTIVE membership + role are verified server-side.
 */
export async function resolveTenantAccess(
  userId: string,
  orgSlug: string,
  permission?: Permission,
): Promise<TenantContext> {
  const membership = await db.restaurantMembership.findFirst({
    where: { userId, status: 'ACTIVE', organization: { slug: orgSlug } },
    include: { organization: true, user: { select: { disabledAt: true } } },
  });
  if (!membership || membership.user.disabledAt) throw new AccessDeniedError('not_member');
  const org = membership.organization;
  if (org.status === 'SUSPENDED' || org.status === 'ARCHIVED') throw new AccessDeniedError('suspended');
  if (permission && !can(membership.role, permission)) throw new AccessDeniedError('forbidden');
  const role = membership.role;
  return {
    userId,
    membershipId: membership.id,
    role,
    locationIds: membership.locationIds,
    org: { id: org.id, slug: org.slug, name: org.name, status: org.status, isDemo: org.isDemo },
    can: (p) => can(role, p),
  };
}

/** Throws unless the location belongs to the tenant and the member may access it. */
export async function assertLocationAccess(ctx: TenantContext, locationId: string) {
  const location = await db.restaurantLocation.findFirst({
    where: { id: locationId, organizationId: ctx.org.id },
    select: { id: true },
  });
  if (!location) throw new AccessDeniedError('location');
  if (ctx.locationIds.length > 0 && !ctx.locationIds.includes(locationId)) throw new AccessDeniedError('location');
}

/** Locations the member may access (always tenant-scoped). */
export async function accessibleLocations(ctx: TenantContext) {
  return db.restaurantLocation.findMany({
    where: {
      organizationId: ctx.org.id,
      ...(ctx.locationIds.length ? { id: { in: ctx.locationIds } } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** For server components/pages: redirects to login, 404s for non-members, 403 page for missing permission. */
export async function requireTenantPage(orgSlug: string, permission?: Permission): Promise<TenantContext & { user: CurrentUser }> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/dashboard/${encodeURIComponent(orgSlug)}`);
  try {
    const ctx = await resolveTenantAccess(user.id, orgSlug, permission);
    return { ...ctx, user };
  } catch (e) {
    if (e instanceof AccessDeniedError) {
      if (e.reason === 'not_member') notFound();
      if (e.reason === 'suspended') redirect('/suspended');
      redirect(`/dashboard/${encodeURIComponent(orgSlug)}/forbidden`);
    }
    throw e;
  }
}

/** For server actions: throws AccessDeniedError (caught by action wrappers). */
export async function requireTenantAction(orgSlug: string, permission?: Permission): Promise<TenantContext> {
  const user = await getCurrentUser();
  if (!user) throw new AccessDeniedError('unauthenticated');
  return resolveTenantAccess(user.id, orgSlug, permission);
}

export async function requirePlatformAdminPage(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/admin');
  if (user.platformRole !== 'PLATFORM_SUPER_ADMIN') notFound();
  return user;
}

export async function requirePlatformAdminAction(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.platformRole !== 'PLATFORM_SUPER_ADMIN') throw new AccessDeniedError('forbidden');
  return user;
}
