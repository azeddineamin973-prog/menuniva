'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { assignReservationTable, changeReservationStatus, unassignReservationTable, updateGuestTableChoice, updateReservationSettings } from '@/server/services/reservations';

const R = { revalidate: '/dashboard/[org]' };

export async function reservationStatusAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'reservations.manage', (ctx) => changeReservationStatus(ctx, { reservationId: form.get('reservationId'), to: form.get('to'), expectedFrom: form.get('expectedFrom'), note: form.get('note') || undefined }), R);
}

export async function assignTableAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'reservations.manage', (ctx) => assignReservationTable(ctx, String(form.get('reservationId')), String(form.get('tableId'))), R);
}

export async function unassignTableAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'reservations.manage', (ctx) => unassignReservationTable(ctx, String(form.get('reservationId')), String(form.get('tableId'))), R);
}

/** Shows (or hides) the floor plan to guests when they request a reservation. */
export async function guestTableChoiceAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) => updateGuestTableChoice(ctx, { locationId: form.get('locationId'), enabled: form.get('enabled') === 'on' }), R);
}
export async function saveReservationSettingsAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'settings.manage',
    (ctx) =>
      updateReservationSettings(ctx, {
        locationId: form.get('locationId'),
        slotMinutes: form.get('slotMinutes'),
        durationMinutes: form.get('durationMinutes'),
        bufferMinutes: form.get('bufferMinutes'),
        maxPartySize: form.get('maxPartySize'),
        maxCoversPerSlot: form.get('maxCoversPerSlot'),
        minNoticeMinutes: form.get('minNoticeMinutes'),
        maxDaysAhead: form.get('maxDaysAhead'),
        bookableHours: form.get('bookableHours'),
      }),
    R,
  );
}
