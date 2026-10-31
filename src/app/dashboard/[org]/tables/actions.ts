'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { createTables, expandTableLabels, rotateTableQr, saveArea, saveStation, routeProducts, updateTable } from '@/server/services/tables';
import { assignCategoryStations, createStations } from '@/server/services/station-assign';

const R = { revalidate: '/dashboard/[org]' };

export async function saveAreaAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'tables.manage', (ctx) => saveArea(ctx, { id: form.get('id') || undefined, locationId: form.get('locationId'), name: form.get('name'), floor: form.get('floor') || undefined }), R);
}

export async function createTablesAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'tables.manage',
    (ctx) =>
      createTables(ctx, {
        locationId: form.get('locationId'),
        areaId: form.get('areaId') || null,
        labels: expandTableLabels(String(form.get('labels') ?? '')),
        seats: form.get('seats') ? Number(form.get('seats')) : null,
      }),
    R,
  );
}

export async function updateTableAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'tables.manage',
    (ctx) =>
      updateTable(ctx, {
        tableId: form.get('tableId'),
        label: form.get('label'),
        seats: form.get('seats') ? Number(form.get('seats')) : null,
        areaId: form.get('areaId') || null,
        isActive: form.get('isActive') === 'on',
      }),
    R,
  );
}

export async function rotateQrAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'tables.manage', (ctx) => rotateTableQr(ctx, String(form.get('tableId'))), R);
}

export async function saveStationAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'stations.manage',
    (ctx) => saveStation(ctx, { id: form.get('id') || undefined, locationId: form.get('locationId'), name: form.get('name'), type: form.get('type'), isActive: form.get('isActive') !== 'off' }),
    R,
  );
}

export async function routeProductsAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'stations.manage', (ctx) => routeProducts(ctx, (form.get('stationId') as string) || null, form.getAll('productIds').map(String)), R);
}

/**
 * Sets the default station of many categories in one submit. The form posts one
 * `station:<categoryId>` field per row, so unchanged rows are still sent and the owner's review
 * is applied exactly as they left it.
 */
export async function assignCategoryStationsAction(_p: ActionResult, form: FormData) {
  const assignments: { categoryId: string; stationId: string | null }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('station:')) continue;
    assignments.push({ categoryId: key.slice('station:'.length), stationId: typeof value === 'string' && value ? value : null });
  }
  return runTenantAction(form.get('org'), 'stations.manage', (ctx) => assignCategoryStations(ctx, { assignments }), R);
}

export async function createStationsAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'stations.manage', (ctx) => createStations(ctx, { locationId: form.get('locationId'), types: form.getAll('types').map(String) }), R);
}
