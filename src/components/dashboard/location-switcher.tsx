'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function LocationSwitcher({ orgSlug, current, locations }: { orgSlug: string; current: string; locations: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="mt-2 block">
      <span className="sr-only">Location</span>
      <select
        value={current}
        disabled={pending}
        data-testid="location-switcher"
        className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-xs"
        onChange={(e) => {
          document.cookie = `mn_loc_${orgSlug}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          start(() => router.refresh());
        }}
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
