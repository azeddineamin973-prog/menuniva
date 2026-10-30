import Link from 'next/link';
import { cn } from '@/lib/cn';

export function SettingsTabs({ base, active }: { base: string; active: 'details' | 'branding' | 'channels' }) {
  const tabs = [
    ['details', 'Details & languages', `${base}/settings`],
    ['branding', 'Branding', `${base}/settings/branding`],
    ['channels', 'Ordering channels & links', `${base}/settings/channels`],
  ] as const;
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1">
      {tabs.map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          className={cn('rounded-xl px-4 py-2 text-sm whitespace-nowrap', active === key ? 'bg-graphite text-white dark:bg-lime dark:text-graphite' : 'text-muted hover:text-ink')}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
