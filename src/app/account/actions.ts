'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isLanguage } from '@/i18n/config';
import { toActionError } from '@/server/action';
import { setUiLanguageCookie } from '@/server/ui-language';
import { type ActionResult } from '@/lib/action-result';
import { currentSessionTokenHash, getCurrentUser } from '@/server/auth/session';
import { changePassword, deleteMyAccount, updateProfile } from '@/server/services/account';

async function withUser<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/account');
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateProfileAction(_p: ActionResult, form: FormData) {
  const r = await withUser((id) => updateProfile(id, { name: form.get('name'), preferredLanguage: form.get('preferredLanguage') }));
  // The new language (and its direction) applies at once on every page, not only in the dashboard.
  const lang = form.get('preferredLanguage');
  if (r.ok && isLanguage(lang)) {
    await setUiLanguageCookie(lang);
    revalidatePath('/', 'layout');
  }
  return r;
}

export async function changePasswordAction(_p: ActionResult, form: FormData) {
  return withUser(async (id) => changePassword(id, String(form.get('current') ?? ''), String(form.get('next') ?? ''), await currentSessionTokenHash()));
}

export async function deleteAccountAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const r = await withUser((id) => deleteMyAccount(id, String(form.get('password') ?? ''), String(form.get('confirm') ?? '')));
  if (r.ok) redirect('/login');
  return r;
}
