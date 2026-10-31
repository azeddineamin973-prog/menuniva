import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';

export type WhatsAppLine = { quantity: number; name: string; detail?: string; notes?: string };
type Msg = Pick<Messages, 'customer'>;

/**
 * The message text prepared for WhatsApp.
 *
 * Opening WhatsApp does NOT send anything: the guest reads this text and presses send
 * themselves, which is why the storefront says so next to the button and never records an order
 * for this path.
 *
 * `total` must be the total the guest can see in the cart, discounts included. Quoting a
 * different number here would mean the restaurant receives a figure the guest never agreed to.
 */
export function buildWhatsAppText(m: Msg, restaurant: string, lines: WhatsAppLine[], total: string, opts: { name?: string; phone?: string; address?: string; pickup: boolean }): string {
  const c = m.customer;
  const out = [fmt(c.waIntro, { restaurant }), ...lines.map((l) => `• ${l.quantity} × ${l.name}${l.detail ? ` (${l.detail})` : ''}${l.notes ? ` — ${l.notes}` : ''}`), ''];
  out.push(opts.pickup ? c.waPickup : fmt(c.waDelivery, { address: opts.address ?? '' }));
  if (opts.name) out.push(fmt(c.waName, { name: opts.name }));
  // The guest is asked for a phone number on this screen; passing it on is the only reason to
  // collect it, since the restaurant cannot reply to a message that was never sent to them.
  if (opts.phone) out.push(fmt(c.waPhone, { phone: opts.phone }));
  out.push(fmt(c.waTotal, { total }));
  return out.join('\n');
}
