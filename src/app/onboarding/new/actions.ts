'use server';

import { redirect } from 'next/navigation';
import { zodFieldErrors, type ActionResult } from '@/lib/action-result';
import { getCurrentUser, clientIp } from '@/server/auth/session';
import { rateLimit, RateLimitError } from '@/server/rate-limit';
import { createRestaurant, createRestaurantSchema } from '@/server/services/organizations';

export async function registerRestaurantAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/onboarding/new');
  try {
    await rateLimit(`register-restaurant:${user.id}:${await clientIp()}`, 5, 3600);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'Too many restaurants created. Please wait and try again.' };
    throw e;
  }
  const parsed = createRestaurantSchema.safeParse({
    name: form.get('name'),
    country: form.get('country'),
    defaultLanguage: form.get('defaultLanguage') || undefined,
    city: form.get('city') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: zodFieldErrors(parsed.error.issues) };
  const { org } = await createRestaurant(parsed.data, { ownerUserId: user.id, actorUserId: user.id });
  redirect(`/dashboard/${org.slug}/setup`);
}
