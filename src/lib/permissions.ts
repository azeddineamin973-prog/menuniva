import type { MembershipRole } from '@/generated/prisma/enums';

/**
 * Single source of truth for staff permissions. The server enforces these on every
 * protected page, server action and API route (see src/server/tenant.ts). The UI uses the
 * same table only to decide which navigation items to show.
 */
export const PERMISSIONS = [
  'overview.view',
  'orders.view',
  'orders.manage', // accept, change status, cancel
  'orders.modifyItems', // void/modify items after submission (audited)
  'payments.record',
  'tasks.manage', // waiter calls & bill requests
  'tables.view',
  'tables.manage',
  'tables.sessions', // open a table for guests, see / issue its PIN, remove an authorised phone
  'kds.view',
  'kds.update',
  'stations.manage',
  'menu.view',
  'menu.edit',
  'menu.availability', // mark sold out / available
  'import.manage',
  'promotions.manage',
  'delivery.manage',
  'delivery.driver',
  'takeaway.manage',
  'reservations.manage',
  'reviews.view',
  'reviews.manage',
  'loyalty.manage',
  'analytics.view',
  'staff.manage',
  'settings.manage',
  'billing.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: Permission[] = PERMISSIONS.filter((p) => p !== 'billing.view' && p !== 'delivery.driver');

export const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  RESTAURANT_OWNER: PERMISSIONS.filter((p) => p !== 'delivery.driver'),
  RESTAURANT_MANAGER: MANAGER,
  WAITER: [
    'overview.view',
    'orders.view',
    'orders.manage',
    'payments.record',
    'tasks.manage',
    'tables.view',
    'tables.sessions',
    'menu.view',
    'menu.availability',
    'reservations.manage',
  ],
  KITCHEN_STAFF: ['kds.view', 'kds.update', 'menu.availability'],
  CAFE_STAFF: ['kds.view', 'kds.update', 'menu.availability', 'orders.view', 'tasks.manage'],
  DELIVERY_STAFF: ['delivery.driver'],
};

export function can(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles a given role may assign when inviting/editing staff. Owners are protected. */
export function assignableRoles(role: MembershipRole): MembershipRole[] {
  if (role === 'RESTAURANT_OWNER')
    return ['RESTAURANT_OWNER', 'RESTAURANT_MANAGER', 'WAITER', 'KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'];
  if (role === 'RESTAURANT_MANAGER') return ['WAITER', 'KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF'];
  return [];
}
