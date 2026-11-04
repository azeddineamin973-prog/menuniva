'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGE_NATIVE_NAME, LANGUAGES, LANG_COOKIE } from '@/i18n/config';
import { setUiLanguageAction } from '@/app/language-actions';
/**
 * Stores the visitor's language in a cookie and re-renders server components.
 *
 * When the address already names a language (`?lang=fr`, e.g. a shared link or the owner's
 * preview), that parameter wins over the cookie on the server, so the switcher changes the
 * parameter instead — otherwise picking a language would appear to do nothing.
 */
export function LanguageCookieSwitcher({
  current,
  available = LANGUAGES,
  className,
  saveToAccount = false,
  label = 'Language',
}: {
  current: LanguageCode;
  available?: readonly LanguageCode[];
  className?: string;
  /** Interface language (sign-in, onboarding, account, dashboard): also saved to the signed-in account. Not for the guest storefront. */
  saveToAccount?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={className}>
      <span className="sr-only">{label}</span>
      <select
        value={current}
        disabled={pending}
        data-testid="language-switcher"
        onChange={(e) => {
          const lang = e.target.value;
          // Read at change time (no useSearchParams: this also renders on static auth pages).
          const params = new URLSearchParams(window.location.search);
          if (params.has('lang')) {
            params.set('lang', lang);
            start(() => router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false }));
            return;
          }
          document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
          if (saveToAccount) {
            start(async () => {
              await setUiLanguageAction(lang);
              router.refresh();
            });
            return;
          }
          start(() => router.refresh());
        }}
        className="h-10 max-w-[9.5rem] rounded-xl border border-line bg-surface px-2 text-sm text-ink pointer-coarse:text-base"
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
