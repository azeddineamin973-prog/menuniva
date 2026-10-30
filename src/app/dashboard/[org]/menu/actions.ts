'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { UserFacingError } from '@/server/errors';
import {
  addProductImage,
  deleteCategory,
  moveCategory,
  moveProduct,
  removeProductImage,
  saveAllergens,
  saveCategory,
  saveProduct,
  saveProductOptions,
  setProductPrice,
  setCategoryStation,
  setProductStatus,
  setSoldOut,
} from '@/server/services/menu';
import { approveTranslation, bulkTranslateMissing, saveTranslation } from '@/server/services/translations';
import { markOnboardingFlag } from '@/server/services/settings';
import { storeTenantImage } from '@/server/storage';
import { createLocation, deleteTaxClass, saveLocationOverride, saveSchedule, saveTaxClass } from '@/server/services/menu-advanced';

const REVALIDATE = { revalidate: '/dashboard/[org]' };

function payload(form: FormData): unknown {
  const raw = form.get('payload');
  if (typeof raw !== 'string') throw new UserFacingError('Missing form data.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new UserFacingError('Invalid form data.');
  }
}

export async function saveCategoryAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => saveCategory(ctx, payload(form)), REVALIDATE);
}

export async function quickAddCategoryAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'menu.edit',
    (ctx) => saveCategory(ctx, { translations: { [String(form.get('lang'))]: { name: String(form.get('name') ?? '') } }, defaultStationId: (form.get('defaultStationId') as string) || null }),
    REVALIDATE,
  );
}

export async function setCategoryStationAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => setCategoryStation(ctx, String(form.get('categoryId')), (form.get('stationId') as string) || null), REVALIDATE);
}
export async function moveCategoryAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => moveCategory(ctx, String(form.get('id')), form.get('dir') === 'up' ? 'up' : 'down'), REVALIDATE);
}

export async function deleteCategoryAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => deleteCategory(ctx, String(form.get('id'))), REVALIDATE);
}

export async function saveProductAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => saveProduct(ctx, payload(form)), REVALIDATE);
}

export async function saveOptionsAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'menu.edit',
    async (ctx) => {
      const data = payload(form) as { variants: unknown; groups: unknown };
      await saveProductOptions(ctx, String(form.get('productId')), data.variants, data.groups);
    },
    REVALIDATE,
  );
}

export async function saveAllergensAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => saveAllergens(ctx, String(form.get('productId')), payload(form)), REVALIDATE);
}

export async function setPriceAction(_p: ActionResult, form: FormData) {
  const channel = String(form.get('channel'));
  if (!['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(channel)) return { ok: false as const, error: 'Invalid channel.' };
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => setProductPrice(ctx, String(form.get('productId')), channel as 'DINE_IN', String(form.get('price') ?? '')), REVALIDATE);
}

export async function toggleSoldOutAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.availability', (ctx) => setSoldOut(ctx, String(form.get('productId')), form.get('soldOut') === 'true'), REVALIDATE);
}

export async function setProductStatusAction(_p: ActionResult, form: FormData) {
  const status = String(form.get('status'));
  if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) return { ok: false as const, error: 'Invalid status.' };
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => setProductStatus(ctx, String(form.get('productId')), status as 'ACTIVE'), REVALIDATE);
}

export async function moveProductAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => moveProduct(ctx, String(form.get('productId')), form.get('dir') === 'up' ? 'up' : 'down'), REVALIDATE);
}

export async function uploadProductImageAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'menu.edit',
    async (ctx) => {
      const file = form.get('image');
      if (!(file instanceof File)) throw new UserFacingError('Please choose a photo.');
      const rights = form.get('rightsConfirmed') === 'on';
      if (!rights) throw new UserFacingError('Please confirm you have the right to publish this photo.');
      const url = await storeTenantImage(ctx.org.id, file, 'products');
      await addProductImage(ctx, String(form.get('productId')), url, rights);
    },
    REVALIDATE,
  );
}

export async function removeProductImageAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => removeProductImage(ctx, String(form.get('imageId'))), REVALIDATE);
}

export async function saveTranslationAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'menu.edit',
    (ctx) => saveTranslation(ctx, { kind: form.get('kind'), id: form.get('id'), language: form.get('language'), name: form.get('name') ?? '', description: form.get('description') ?? '' }),
    REVALIDATE,
  );
}

export async function approveTranslationAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => approveTranslation(ctx, form.get('kind') === 'category' ? 'category' : 'product', String(form.get('id')), String(form.get('language')) as 'pt'), REVALIDATE);
}

export async function bulkTranslateAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => bulkTranslateMissing(ctx), REVALIDATE);
}

export async function markTranslationsReviewedAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => markOnboardingFlag(ctx, 'translationsReviewedAt'), REVALIDATE);
}

export async function saveLocationOverrideAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'menu.edit',
    (ctx) =>
      saveLocationOverride(ctx, {
        productId: form.get('productId'),
        locationId: form.get('locationId'),
        isAvailable: form.get('isAvailable') === 'on',
        soldOut: form.get('soldOut') === 'on',
        dineIn: form.get('dineIn'),
        takeaway: form.get('takeaway'),
        delivery: form.get('delivery'),
      }),
    REVALIDATE,
  );
}

export async function saveScheduleAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'menu.edit', (ctx) => saveSchedule(ctx, payload(form)), REVALIDATE);
}

export async function saveTaxClassAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'settings.manage',
    (ctx) => saveTaxClass(ctx, { id: form.get('id') || undefined, name: form.get('name'), rate: form.get('rate'), approved: form.get('approved') === 'on' }),
    REVALIDATE,
  );
}

export async function deleteTaxClassAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => deleteTaxClass(ctx, String(form.get('id'))), REVALIDATE);
}

export async function createLocationAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => createLocation(ctx, { name: form.get('name'), city: form.get('city') || undefined }), REVALIDATE);
}
