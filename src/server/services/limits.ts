import 'server-only';
import { db, type Tx } from '../db';
import { UserFacingError } from '../errors';

/** Plan limits (configurable per plan in Super Admin) and the tenant's real current usage. */
export const LIMIT_KEYS = ['locations', 'tables', 'staff', 'menuItems'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export const LIMIT_LABELS: Record<LimitKey, string> = { locations: 'Locations', tables: 'Active tables', staff: 'Staff accounts (incl. pending invitations)', menuItems: 'Dishes (not archived)' };

export async function planLimits(organizationId: string, tx: Tx | typeof db = db): Promise<Partial<Record<LimitKey, number>>> {
  const sub = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  const raw = (sub?.plan.limits ?? {}) as Record<string, unknown>;
  const out: Partial<Record<LimitKey, number>> = {};
  for (const k of LIMIT_KEYS) if (typeof raw[k] === 'number') out[k] = raw[k] as number;
  return out;
}

export async function planUsage(organizationId: string, tx: Tx | typeof db = db): Promise<Record<LimitKey, number>> {
  const [locations, tables, members, pending, menuItems] = await Promise.all([
    tx.restaurantLocation.count({ where: { organizationId } }),
    tx.restaurantTable.count({ where: { organizationId, isActive: true } }),
    tx.restaurantMembership.count({ where: { organizationId, status: { not: 'DISABLED' } } }),
    tx.invitation.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    tx.menuProduct.count({ where: { organizationId, status: { not: 'ARCHIVED' } } }),
  ]);
  return { locations, tables, staff: members + pending, menuItems };
}

/** Refuses an operation that would take the tenant above its plan's dish limit. */
export async function assertMenuItemCapacity(organizationId: string, adding: number, tx: Tx | typeof db = db) {
  const limit = (await planLimits(organizationId, tx)).menuItems;
  if (limit === undefined || adding <= 0) return;
  const current = await tx.menuProduct.count({ where: { organizationId, status: { not: 'ARCHIVED' } } });
  if (current + adding > limit) {
    throw new UserFacingError(`Your plan allows up to ${limit} dishes (you have ${current}). Archive dishes you no longer serve or change plan.`);
  }
}
