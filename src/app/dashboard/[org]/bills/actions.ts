'use server';

import { parseMoneyToCents } from '@/lib/money';
import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { UserFacingError } from '@/server/errors';
import { changeOrderItem, closeTableSession, openTableSession, recordPayment, transferSession, voidPayment } from '@/server/services/bills';
import { regeneratePin, revealPin, revokeDevice } from '@/server/services/table-access';

const R = { revalidate: '/dashboard/[org]' };

export async function recordPaymentAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'payments.record',
    (ctx) => {
      const itemIds = form.getAll('itemIds').map(String).filter(Boolean);
      const raw = String(form.get('amount') ?? '').trim();
      let amountCents: number | undefined;
      if (!itemIds.length) {
        const c = parseMoneyToCents(raw);
        if (c === null || c <= 0) throw new UserFacingError('Enter the amount received, e.g. 20,00 — or select items.');
        amountCents = c;
      }
      return recordPayment(ctx, { sessionId: form.get('sessionId') || undefined, orderId: form.get('orderId') || undefined, method: form.get('method'), amountCents, itemIds: itemIds.length ? itemIds : undefined, note: form.get('note') || undefined });
    },
    R,
  );
}

export async function voidPaymentAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'orders.modifyItems', (ctx) => voidPayment(ctx, String(form.get('paymentId')), String(form.get('reason') ?? '')), R);
}

export async function changeItemAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'orders.modifyItems',
    (ctx) => changeOrderItem(ctx, { itemId: form.get('itemId'), quantity: Number(form.get('quantity')), reason: String(form.get('reason') ?? ''), kitchenNotified: form.get('kitchenNotified') === 'on' }),
    R,
  );
}

export async function transferAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'tasks.manage', (ctx) => transferSession(ctx, String(form.get('sessionId')), String(form.get('toTableId'))), R);
}

export async function closeSessionAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'payments.record', (ctx) => closeTableSession(ctx, { sessionId: form.get('sessionId'), note: form.get('note') || undefined }), R);
}

/** Opens a table for a new party. Under SESSION_PIN the new PIN is returned once, to this member of staff only. */
export async function openTableAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'tables.sessions', (ctx) => openTableSession(ctx, String(form.get('tableId'))).then((s) => ({ pin: s.pin, sessionId: s.id })), { ...R, successMessage: 'Table opened' });
}

/** Shows the table's PIN to staff (audited; the PIN is never part of a page's HTML). */
export async function revealPinAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'tables.sessions', (ctx) => revealPin(ctx, String(form.get('sessionId'))));
}

/** New PIN for the seating (clears a lock). Phones already authorised keep ordering. */
export async function regeneratePinAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'tables.sessions', (ctx) => regeneratePin(ctx, String(form.get('sessionId'))), { ...R, successMessage: 'New PIN issued' });
}

export async function revokeDeviceAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'tables.sessions', (ctx) => revokeDevice(ctx, String(form.get('deviceId'))), { ...R, successMessage: 'Phone removed' });
}
