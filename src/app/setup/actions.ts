'use server';

import { redirect } from 'next/navigation';
import { zodFieldErrors, type ActionResult } from '@/lib/action-result';
import { createSession, clientIp } from '@/server/auth/session';
import { rateLimit, RateLimitError } from '@/server/rate-limit';
import { bootstrapAdminSchema, bootstrapPlatformAdmin } from '@/server/services/platform-setup';

export async function bootstrapAdminAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  try {
    await rateLimit(`setup:${await clientIp()}`, 10, 3600);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'too_many_attempts' };
    throw e;
  }
  const parsed = bootstrapAdminSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: zodFieldErrors(parsed.error.issues) };
  let userId: string;
  try {
    userId = (await bootstrapPlatformAdmin(parsed.data)).id;
  } catch (e) {
    const code = e instanceof Error ? e.message : 'server_error';
    return { ok: false, error: code === 'email_taken' ? 'email_taken' : 'setup_token_invalid' };
  }
  await createSession(userId);
  redirect('/admin');
}
