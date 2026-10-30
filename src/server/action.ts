import 'server-only';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { zodFieldErrors, type ActionResult } from '@/lib/action-result';
import type { Permission } from '@/lib/permissions';
import { logError } from './audit';
import { UserFacingError } from './errors';
import { RateLimitError } from './rate-limit';
import { UploadError } from './storage';
import { AccessDeniedError, requireTenantAction, type TenantContext } from './tenant';

/**
 * Standard wrapper for dashboard server actions:
 * 1. authenticates the user and verifies membership + permission for the org slug,
 * 2. runs the operation with a tenant-scoped context,
 * 3. maps validation/authorization errors to form-friendly results.
 */
export async function runTenantAction<T>(
  orgSlug: unknown,
  permission: Permission,
  fn: (ctx: TenantContext) => Promise<T>,
  opts: { revalidate?: string; successMessage?: string } = {},
): Promise<ActionResult<T>> {
  try {
    if (typeof orgSlug !== 'string') throw new AccessDeniedError('not_member');
    const ctx = await requireTenantAction(orgSlug, permission);
    const data = await fn(ctx);
    if (opts.revalidate) revalidatePath(opts.revalidate.replace('[org]', ctx.org.slug), 'layout');
    return { ok: true, data, message: opts.successMessage ?? 'saved' };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toActionError(e: unknown): Promise<{ ok: false; error: string; fieldErrors?: Record<string, string> }> {
  if (e instanceof ZodError) return { ok: false, error: 'validation', fieldErrors: zodFieldErrors(e.issues) };
  if (e instanceof AccessDeniedError) return { ok: false, error: 'You do not have permission to do this.' };
  if (e instanceof UserFacingError) return { ok: false, error: e.code };
  if (e instanceof UploadError) {
    const map: Record<string, string> = {
      file_too_large: 'The file is too large (maximum 5 MB).',
      unsupported_type: 'Only PNG, JPEG or WebP images are accepted.',
      no_file: 'Please choose a file.',
    };
    return { ok: false, error: map[e.message] ?? 'Upload failed.' };
  }
  if (e instanceof RateLimitError) return { ok: false, error: 'Too many requests. Please wait a moment.' };
  // Next.js redirect()/notFound() throw special errors that must propagate.
  if (e && typeof e === 'object' && 'digest' in e && typeof (e as { digest: unknown }).digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_')) throw e;
  await logError('server-action', e);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}
