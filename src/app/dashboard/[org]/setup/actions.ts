'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { publishLocation, unpublishLocation } from '@/server/services/publish';
import { markOnboardingFlag } from '@/server/services/settings';

export async function markPreviewedAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => markOnboardingFlag(ctx, 'previewedAt'), { revalidate: '/dashboard/[org]' });
}

export async function publishAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => publishLocation(ctx, String(form.get('locationId')), form.get('confirm') === 'on'), { revalidate: '/dashboard/[org]' });
}

export async function unpublishAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => unpublishLocation(ctx, String(form.get('locationId'))), { revalidate: '/dashboard/[org]' });
}
