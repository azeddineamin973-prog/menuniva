'use server';

import { redirect } from 'next/navigation';
import { toActionError } from '@/server/action';
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
  return withUser((id) => updateProfile(id, { name: form.get('name'), preferredLanguage: form.get('preferredLanguage') }));
}

export async function changePasswordAction(_p: ActionResult, form: FormData) {
  return withUser(async (id) => changePassword(id, String(form.get('current') ?? ''), String(form.get('next') ?? ''), await currentSessionTokenHash()));
}

export async function deleteAccountAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const r = await withUser((id) => deleteMyAccount(id, String(form.get('password') ?? ''), String(form.get('confirm') ?? '')));
  if (r.ok) redirect('/login');
  return r;
}
