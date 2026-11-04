'use client';

import { fmt } from '@/i18n/config';
import type { Msg } from './cart-sheet';

export type SubmitResult = { kind: 'ok'; token: string } | { kind: 'refused'; status: number; data: Record<string, unknown> & { error?: string; issues?: unknown[]; minOrderCents?: number } } | { kind: 'unknown' };

/**
 * Posts an order with up to 3 attempts. Retries resend the SAME body (same idempotency key), so a
 * flaky connection can never create two orders: the server returns the original one.
 * `unknown` = no definitive answer (connection lost); the caller keeps the body for a safe retry.
 */
export async function postOrder(endpoint: string, body: string): Promise<SubmitResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.trackingToken) return { kind: 'ok', token: data.trackingToken };
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return { kind: 'refused', status: res.status, data };
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return { kind: 'unknown' };
}

/**
 * Enters the table PIN once for this phone. The server answers with an httpOnly authorisation cookie
 * for this seating only; the PIN is not stored anywhere in the browser.
 */
export async function joinTable(qrToken: string, pin: string): Promise<{ kind: 'ok' | 'not_required' | 'invalid' | 'locked' | 'closed' | 'busy' | 'error' }> {
  try {
    const res = await fetch('/api/public/table-session/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken, pin }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { kind: data.required === false ? 'not_required' : 'ok' };
    if (res.status === 429) return { kind: 'busy' };
    return { kind: data.error === 'pin_invalid' ? 'invalid' : data.error === 'pin_locked' ? 'locked' : data.error === 'table_not_open' ? 'closed' : 'error' };
  } catch {
    return { kind: 'error' };
  }
}

/** "Please open my table": a staff request from a table that is not open yet (merged if repeated). */
export async function requestOpenTable(qrToken: string): Promise<'ok' | 'open' | 'limited' | 'error'> {
  try {
    const res = await fetch('/api/public/table-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken, type: 'OPEN_TABLE' }) });
    if (res.status === 429) return 'limited';
    if (!res.ok) return 'error';
    const data = await res.json().catch(() => ({}));
    return data.alreadyOpen ? 'open' : 'ok';
  } catch {
    return 'error';
  }
}

/** What the guest reads when the restaurant's server refuses an order. */
export function refusalMessage(m: Msg, r: Extract<SubmitResult, { kind: 'refused' }>, country: 'PT' | 'ES', money: (c: number) => string) {
  const c = m.customer;
  const e = r.data.error;
  if (r.status === 422 && e === 'items_unavailable') return c.priceChanged;
  if (r.status === 429) return c.tooManyOrders;
  if (typeof e === 'string' && e.startsWith('ordering_')) return c.orderingPaused;
  switch (e) {
    case 'qr_invalid':
      return c.qrInvalid;
    case 'table_code_invalid':
      return c.tableCodeInvalid;
    case 'table_not_open':
      return c.tableNotOpen;
    case 'pin_required':
      return c.pinRequired;
    case 'session_ended':
      return c.sessionEnded;
    case 'too_many_pending':
      return c.tooManyPending;
    case 'below_minimum':
      return fmt(c.minimumOrder, { amount: money(r.data.minOrderCents ?? 0) });
    case 'pickup_unavailable':
      return c.pickupUnavailable;
    case 'outside_delivery_zone':
      return c.outsideDeliveryZone;
    case 'invalid_postal_code':
      return country === 'ES' ? m.validation.invalidPostalCodeES : m.validation.invalidPostalCodePT;
    case 'delivery_busy':
      return c.deliveryBusy;
    case 'payment_method_unavailable':
      return c.orderingPaused;
    case 'validation_failed':
      return m.validation.required;
    case 'coupon_invalid':
    case 'promotion_unavailable':
      return c.promoInvalid;
    default:
      return m.common.retry;
  }
}
