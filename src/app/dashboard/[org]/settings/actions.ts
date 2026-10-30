'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { storeTenantImage } from '@/server/storage';
import { updateBranding, updateChannelSettings, updateLocationDetails, updateOrganizationSettings } from '@/server/services/settings';

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
      const logo = form.get('logo');
      const cover = form.get('cover');
      const files = {
        logo: logo instanceof File && logo.size > 0 ? await storeTenantImage(ctx.org.id, logo, 'branding') : undefined,
        cover: cover instanceof File && cover.size > 0 ? await storeTenantImage(ctx.org.id, cover, 'branding') : undefined,
      };
      await updateBranding(ctx, Object.fromEntries(form), files);
    },
    { revalidate: '/dashboard/[org]' },
  );
}
