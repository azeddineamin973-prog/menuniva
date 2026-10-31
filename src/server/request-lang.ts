import 'server-only';
import { cookies } from 'next/headers';
import type { LanguageCode } from '@/generated/prisma/enums';
import { isLanguage, LANG_COOKIE } from '@/i18n/config';

/**
 * Language chosen by the visitor (cookie). Without a choice the interface is English; a
 * restaurant storefront passes its own default language instead.
 */
export async function getRequestLang(fallback: LanguageCode = 'en'): Promise<LanguageCode> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLanguage(value) ? value : fallback;
}
