import { Tabs } from '@/components/ui';
import type { TenantContext } from '@/server/tenant';

export type MenuTab = 'dishes' | 'quick' | 'translations' | 'upsell';

/**
 * Sub-navigation shared by the menu tools, so they read as one area.
 * Only tools the current role may open are listed (kitchen staff only see availability).
 */
export function MenuTabs({ base, active, ctx }: { base: string; active: MenuTab; ctx: Pick<TenantContext, 'can'> }) {
  const items = [
    { key: 'dishes', href: `${base}/menu`, label: 'Dishes', icon: 'book', show: ctx.can('menu.view') },
    { key: 'quick', href: `${base}/menu/quick`, label: 'Prices & availability', icon: 'tag', show: ctx.can('menu.availability') },
    { key: 'translations', href: `${base}/menu/translations`, label: 'Translations', icon: 'globe', show: ctx.can('menu.edit') },
    { key: 'upsell', href: `${base}/menu/upsell`, label: 'Cart suggestions', icon: 'sparkles', show: ctx.can('menu.edit') },
  ] as const;
  const visible = items.filter((i) => i.show);
  if (visible.length < 2) return null;
  return <Tabs label="Menu tools" items={visible.map((i) => ({ href: i.href, label: i.label, icon: i.icon, active: i.key === active }))} />;
}
