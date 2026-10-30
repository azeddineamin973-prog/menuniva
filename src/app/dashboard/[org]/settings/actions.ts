'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { eraseGuestData, findGuestData, updateRetention } from '@/server/services/privacy';
import { saveBrandingWithImages, updateChannelSettings, updateLocationDetails, updateOrganizationSettings } from '@/server/services/settings';

export async function saveOrganizationSettingsAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) =>
    updateOrganizationSettings(ctx, {
      name: form.get('name'),
      legalName: form.get('legalName'),
      taxId: form.get('taxId'),
      country: form.get('country'),
      defaultLanguage: form.get('defaultLanguage'),
      sourceLanguage: form.get('sourceLanguage'),
      enabledLanguages: form.getAll('enabledLanguages'),
    }),
    { revalidate: '/dashboard/[org]' },
  );
}

export async function saveLocationDetailsAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => updateLocationDetails(ctx, Object.fromEntries(form)), {
    revalidate: '/dashboard/[org]',
  });
}

export async function saveChannelSettingsAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => updateChannelSettings(ctx, Object.fromEntries(form)), {
    revalidate: '/dashboard/[org]',
  });
}

export async function saveBrandingAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  return runTenantAction(
    form.get('org'),
    'settings.manage',
    async (ctx) => {
      const { logo, cover, ...fields } = Object.fromEntries(form);
      await saveBrandingWithImages(ctx, fields, { logo, cover });
    },
    { revalidate: '/dashboard/[org]' },
  );
}
export async function saveRetentionAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => updateRetention(ctx, form.get('days')), { revalidate: '/dashboard/[org]' });
}
export async function findGuestDataAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => findGuestData(ctx, String(form.get('q') ?? '')));
}
export async function eraseGuestDataAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => eraseGuestData(ctx, String(form.get('q') ?? ''), String(form.get('confirm') ?? '')));
}
