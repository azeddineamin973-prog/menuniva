import { Tabs } from '@/components/ui';

export function SettingsTabs({ base, active }: { base: string; active: 'details' | 'branding' | 'channels' | 'tax' | 'privacy' }) {
  const tabs = [
    { key: 'details', label: 'Details & languages', href: `${base}/settings`, icon: 'building' },
    { key: 'branding', label: 'Branding', href: `${base}/settings/branding`, icon: 'sparkles' },
    { key: 'channels', label: 'Ordering channels & links', href: `${base}/settings/channels`, icon: 'bag' },
    { key: 'tax', label: 'Tax (IVA)', href: `${base}/settings/tax`, icon: 'bill' },
    { key: 'privacy', label: 'Privacy (GDPR)', href: `${base}/settings/privacy`, icon: 'shield' },
  ] as const;
  return <Tabs label="Settings" className="mb-6" items={tabs.map((t) => ({ href: t.href, label: t.label, icon: t.icon, active: t.key === active }))} />;
}
