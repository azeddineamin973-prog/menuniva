'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { UserFacingError } from '@/server/errors';
import { assignDriver, deleteDeliveryZone, driverUpdate, saveDeliveryZone, updateDeliverySettings, updateTakeawaySettings } from '@/server/services/fulfilment';

const R = { revalidate: '/dashboard/[org]' };
const on = (f: FormData, k: string) => f.get(k) === 'on';

export async function saveTakeawaySettingsAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'takeaway.manage',
    (ctx) => updateTakeawaySettings(ctx, { locationId: form.get('locationId'), leadTimeMinutes: form.get('leadTimeMinutes'), slotMinutes: form.get('slotMinutes'), minOrder: form.get('minOrder'), paused: on(form, 'paused'), pickupHours: form.get('pickupHours'), pickupPoint: form.get('pickupPoint') }),
    R,
  );
}

export async function saveDeliverySettingsAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'delivery.manage',
    (ctx) =>
      updateDeliverySettings(ctx, {
        locationId: form.get('locationId'),
        prepEstimateMinutes: form.get('prepEstimateMinutes'),
        deliveryEstimateMinutes: form.get('deliveryEstimateMinutes'),
        maxActiveOrders: form.get('maxActiveOrders'),
        cashOnDeliveryEnabled: on(form, 'cashOnDeliveryEnabled'),
        cardOnDeliveryEnabled: on(form, 'cardOnDeliveryEnabled'),
        paused: on(form, 'paused'),
        deliveryHours: form.get('deliveryHours'),
      }),
    R,
  );
}

export async function saveZoneAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'delivery.manage',
    (ctx) =>
      saveDeliveryZone(ctx, {
        id: form.get('id') || undefined,
        locationId: form.get('locationId'),
        name: form.get('name'),
        patterns: form.get('patterns'),
        fee: form.get('fee'),
        minOrder: form.get('minOrder'),
        freeFrom: form.get('freeFrom'),
        estimatedMinutes: form.get('estimatedMinutes'),
        isActive: form.get('isActive') === null ? true : on(form, 'isActive'),
      }),
    R,
  );
}

export async function deleteZoneAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'delivery.manage', (ctx) => deleteDeliveryZone(ctx, String(form.get('id'))), R);
}

export async function assignDriverAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'delivery.manage', (ctx) => assignDriver(ctx, String(form.get('orderId')), (form.get('membershipId') as string) || null), R);
}

export async function driverUpdateAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'delivery.driver',
    (ctx) => {
      const to = String(form.get('to'));
      if (to !== 'OUT_FOR_DELIVERY' && to !== 'DELIVERED') throw new UserFacingError('Invalid status.');
      return driverUpdate(ctx, String(form.get('orderId')), to, on(form, 'cashCollected') || form.get('cashCollected') === 'true');
    },
    R,
  );
}
