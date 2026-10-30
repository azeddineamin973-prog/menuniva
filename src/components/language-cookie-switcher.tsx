'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGE_NATIVE_NAME, LANGUAGES, LANG_COOKIE } from '@/i18n/config';

/** Stores the visitor's language in a cookie and re-renders server components. */
export function LanguageCookieSwitcher({
  current,
  available = LANGUAGES,
  className,
}: {
  current: LanguageCode;
  available?: readonly LanguageCode[];
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={className}>
      <span className="sr-only">Language</span>
      <select
        value={current}
        disabled={pending}
        data-testid="language-switcher"
        onChange={(e) => {
          document.cookie = `${LANG_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          start(() => router.refresh());
        }}
        className="h-9 rounded-xl border border-line bg-surface px-2 text-sm text-ink"
      >
        {available.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_NATIVE_NAME[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
