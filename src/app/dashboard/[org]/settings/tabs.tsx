import { Tabs } from '@/components/ui';
import { getDashText } from '@/i18n/dash';
import { getCurrentUser } from '@/server/auth/session';

export async function SettingsTabs({ base, active }: { base: string; active: 'details' | 'branding' | 'channels' | 'alerts' | 'tax' | 'privacy' }) {
  const t = getDashText((await getCurrentUser())?.preferredLanguage ?? 'en').settingsTabs;
  const tabs = [
    { key: 'details', label: t.details, href: `${base}/settings`, icon: 'building' },
    { key: 'branding', label: t.branding, href: `${base}/settings/branding`, icon: 'sparkles' },
    { key: 'channels', label: t.channels, href: `${base}/settings/channels`, icon: 'bag' },
    { key: 'alerts', label: t.alerts, href: `${base}/settings/alerts`, icon: 'bell' },
    { key: 'tax', label: t.tax, href: `${base}/settings/tax`, icon: 'bill' },
    { key: 'privacy', label: t.privacy, href: `${base}/settings/privacy`, icon: 'shield' },
  ] as const;
  return <Tabs label={t.label} className="mb-6" items={tabs.map((x) => ({ href: x.href, label: x.label, icon: x.icon, active: x.key === active }))} />;
}
