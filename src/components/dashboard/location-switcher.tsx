'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/cn';

/**
 * Chooses the location a page works on (the same choice as the sidebar's switcher: a cookie the
 * server reads, then the page reloads its data). Only the member's accessible locations are listed.
 */
export function LocationSwitcher({ orgSlug, current, locations, label = 'Location', className }: { orgSlug: string; current: string; locations: { id: string; name: string }[]; label?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={cn('inline-flex items-center gap-2 text-[13px] text-muted', className)}>
      <span>{label}</span>
      <select
        value={current}
        disabled={pending}
        data-testid="location-switcher"
        className="h-8 max-w-56 min-w-0 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink shadow-xs pointer-coarse:h-10 pointer-coarse:text-base"
        onChange={(e) => {
          document.cookie = `mn_loc_${orgSlug}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          start(() => router.refresh());
        }}
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
