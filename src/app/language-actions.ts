'use server';

import { revalidatePath } from 'next/cache';
import { isLanguage } from '@/i18n/config';
import { getCurrentUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { setUiLanguageCookie } from '@/server/ui-language';

/**
 * Interface language picked in a language menu outside the guest storefront. Sets the cookie for
 * this browser and, when someone is signed in, saves it to their account too, so the dashboard,
 * onboarding and My account follow the same choice. Unknown values change nothing.
 */
export async function setUiLanguageAction(lang: string): Promise<void> {
  if (!isLanguage(lang)) return;
  await setUiLanguageCookie(lang);
  const user = await getCurrentUser();
  if (user && user.preferredLanguage !== lang) await db.user.update({ where: { id: user.id }, data: { preferredLanguage: lang } });
  revalidatePath('/', 'layout');
}
