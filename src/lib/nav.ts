import type { Messages } from '@/i18n';
import type { Permission } from './permissions';

export type NavKey = keyof Messages['nav'];

export type NavItem = { key: NavKey; path: string; permission: Permission; group: 'operate' | 'menu' | 'grow' | 'manage' };

/** Dashboard sections (Part 20). Visibility is filtered by permission; the server re-checks every page. */
export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', path: '', permission: 'overview.view', group: 'operate' },
  { key: 'liveOrders', path: '/orders', permission: 'orders.view', group: 'operate' },
  { key: 'tasks', path: '/tasks', permission: 'tasks.manage', group: 'operate' },
  { key: 'kitchen', path: '/kitchen', permission: 'kds.view', group: 'operate' },
  { key: 'myDeliveries', path: '/driver', permission: 'delivery.driver', group: 'operate' },
  { key: 'tables', path: '/tables', permission: 'tables.view', group: 'operate' },
  { key: 'reservations', path: '/reservations', permission: 'reservations.manage', group: 'operate' },
  { key: 'menu', path: '/menu', permission: 'menu.view', group: 'menu' },
  { key: 'importStudio', path: '/import', permission: 'import.manage', group: 'menu' },
  { key: 'stations', path: '/stations', permission: 'stations.manage', group: 'menu' },
  { key: 'promotions', path: '/promotions', permission: 'promotions.manage', group: 'grow' },
  { key: 'takeaway', path: '/takeaway', permission: 'takeaway.manage', group: 'grow' },
  { key: 'delivery', path: '/delivery', permission: 'delivery.manage', group: 'grow' },
  { key: 'reviews', path: '/reviews', permission: 'reviews.view', group: 'grow' },
  { key: 'loyalty', path: '/loyalty', permission: 'loyalty.manage', group: 'grow' },
  { key: 'analytics', path: '/analytics', permission: 'analytics.view', group: 'manage' },
  { key: 'staff', path: '/staff', permission: 'staff.manage', group: 'manage' },
  { key: 'settings', path: '/settings', permission: 'settings.manage', group: 'manage' },
  { key: 'setup', path: '/setup', permission: 'settings.manage', group: 'manage' },
  { key: 'subscription', path: '/subscription', permission: 'billing.view', group: 'manage' },
];
