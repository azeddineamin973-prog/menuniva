import 'server-only';
import { cookies } from 'next/headers';
import type { LanguageCode } from '@/generated/prisma/enums';
import { isLanguage, LANG_COOKIE } from '@/i18n/config';

/**
 * Keeps the interface-language cookie (read by the root layout for `lang`/`dir` and by every page
 * outside the dashboard) equal to the signed-in person's saved language, so choosing Arabic once
 * makes sign-in, onboarding, My account and the dashboard Arabic and right-to-left alike.
 * Same attributes as the cookie the language switcher writes in the browser.
 */
export async function setUiLanguageCookie(lang: LanguageCode) {
  (await cookies()).set(LANG_COOKIE, lang, { path: '/', maxAge: 31_536_000, sameSite: 'lax' });
}

/** The language the visitor picked on the public pages before having an account, if any. */
export async function chosenUiLanguage(): Promise<LanguageCode | null> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLanguage(v) ? v : null;
}
