import type { IconName } from '@/components/ui/icons';
import type { Messages } from '@/i18n';
import type { ModuleKey } from './modules';
import type { Permission } from './permissions';

export type NavKey = keyof Messages['nav'];

/**
 * Where a section lives in the shell:
 * - `sidebar`: main navigation (grouped);
 * - `account`: the account menu (subscription, help) — still one click away, but out of the way
 *   of daily work;
 * - `setup`: the setup wizard, shown in the sidebar only while setup is unfinished.
 */
export type NavPlacement = 'sidebar' | 'account' | 'setup';

export type NavItem = {
  key: NavKey;
  path: string;
  permission: Permission;
  group: 'operate' | 'menu' | 'grow' | 'manage';
  module?: ModuleKey;
  icon: IconName;
  placement?: NavPlacement;
};

/** Dashboard sections (Part 20). Visibility is filtered by permission; the server re-checks every page. */
export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', path: '', permission: 'overview.view', group: 'operate', icon: 'home' },
  { key: 'liveOrders', path: '/orders', permission: 'orders.view', group: 'operate', icon: 'orders' },
  { key: 'tasks', path: '/tasks', permission: 'tasks.manage', group: 'operate', icon: 'bell' },
  { key: 'kitchen', path: '/kitchen', permission: 'kds.view', group: 'operate', module: 'kds', icon: 'kitchen' },
  { key: 'myDeliveries', path: '/driver', permission: 'delivery.driver', group: 'operate', module: 'delivery', icon: 'truck' },
  { key: 'tables', path: '/tables', permission: 'tables.view', group: 'operate', icon: 'qr' },
  { key: 'bills', path: '/bills', permission: 'payments.record', group: 'operate', icon: 'bill' },
  { key: 'reservations', path: '/reservations', permission: 'reservations.manage', group: 'operate', module: 'reservations', icon: 'calendar' },
  { key: 'menu', path: '/menu', permission: 'menu.view', group: 'menu', icon: 'book' },
  { key: 'importStudio', path: '/import', permission: 'import.manage', group: 'menu', module: 'import', icon: 'import' },
  { key: 'stations', path: '/stations', permission: 'stations.manage', group: 'menu', icon: 'station' },
  { key: 'promotions', path: '/promotions', permission: 'promotions.manage', group: 'grow', module: 'promotions', icon: 'tag' },
  { key: 'takeaway', path: '/takeaway', permission: 'takeaway.manage', group: 'grow', module: 'takeaway', icon: 'bag' },
  { key: 'delivery', path: '/delivery', permission: 'delivery.manage', group: 'grow', module: 'delivery', icon: 'truck' },
  { key: 'reviews', path: '/reviews', permission: 'reviews.view', group: 'grow', module: 'feedback', icon: 'star' },
  { key: 'loyalty', path: '/loyalty', permission: 'loyalty.manage', group: 'grow', module: 'loyalty', icon: 'heart' },
  { key: 'analytics', path: '/analytics', permission: 'analytics.view', group: 'manage', icon: 'chart' },
  { key: 'staff', path: '/staff', permission: 'staff.manage', group: 'manage', icon: 'users' },
  { key: 'settings', path: '/settings', permission: 'settings.manage', group: 'manage', icon: 'settings' },
  { key: 'setup', path: '/setup', permission: 'settings.manage', group: 'manage', icon: 'wand', placement: 'setup' },
  { key: 'subscription', path: '/subscription', permission: 'billing.view', group: 'manage', icon: 'card', placement: 'account' },
  { key: 'support', path: '/support', permission: 'settings.manage', group: 'manage', icon: 'help', placement: 'account' },
];

/**
 * Titles of pages below a section, for breadcrumbs ("Menu › Translations"). Keys are path
 * segments after the section; `*` matches an id.
 */
export const SUB_PAGES: Record<string, Record<string, string>> = {
  menu: { quick: 'Prices & availability', translations: 'Translations', upsell: 'Cart suggestions', products: 'Dishes', 'products/new': 'New dish', 'products/*': 'Edit dish', 'categories/*': 'Category' },
  import: { '*': 'Review import' },
  kitchen: { '*': 'Station display', 'tickets/*/print': 'Print ticket' },
  bills: { '*': 'Table bill', '*/receipt': 'Receipt' },
  tables: { print: 'Printable QR sheet' },
  settings: { branding: 'Branding', channels: 'Ordering channels', tax: 'Tax (IVA)', privacy: 'Privacy (GDPR)' },
  setup: { preview: 'Preview', publish: 'Publish' },
};
