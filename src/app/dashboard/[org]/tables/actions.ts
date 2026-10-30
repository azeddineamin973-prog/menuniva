'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { createTables, expandTableLabels, rotateTableQr, saveArea, saveStation, routeProducts, updateTable } from '@/server/services/tables';

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
