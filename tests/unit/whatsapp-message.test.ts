import { describe, expect, it } from 'vitest';
import { getMessages } from '@/i18n';
import { buildWhatsAppText } from '@/lib/whatsapp';

const m = { customer: getMessages('en').customer };
const lines = [
  { quantity: 2, name: 'Tajine de frango', detail: 'Para dois', notes: 'sem coentros' },
  { quantity: 1, name: 'Chá de menta' },
];

describe('the WhatsApp message prepared for the guest', () => {
  it('lists what was chosen, with sizes, extras and notes', () => {
    const text = buildWhatsAppText(m, 'Casa de Marrocos', lines, '€24,50', { pickup: true });
    expect(text).toContain('Hello Casa de Marrocos');
    expect(text).toContain('• 2 × Tajine de frango (Para dois) — sem coentros');
    expect(text).toContain('• 1 × Chá de menta');
    expect(text).toContain('For pickup');
    expect(text).toContain('Estimated total: €24,50');
  });

  it('includes the phone number the guest was asked for', () => {
    // It is a required field on this screen; the restaurant cannot reply to a message it never
    // received, so the number has to travel in the text or not be collected at all.
    const text = buildWhatsAppText(m, 'Casa', lines, '€10,00', { pickup: true, name: 'Ana', phone: '+351 935 413 677' });
    expect(text).toContain('Name: Ana');
    expect(text).toContain('Phone: +351 935 413 677');
  });

  it('leaves out name and phone when the guest did not fill them in', () => {
    const text = buildWhatsAppText(m, 'Casa', lines, '€10,00', { pickup: true, name: '', phone: '' });
    expect(text).not.toContain('Name:');
    expect(text).not.toContain('Phone:');
  });

  it('uses the delivery address when the guest chose delivery', () => {
    const text = buildWhatsAppText(m, 'Casa', lines, '€10,00', { pickup: false, address: 'R. de Santa Margarida 13' });
    expect(text).toContain('Delivery to: R. de Santa Margarida 13');
    expect(text).not.toContain('For pickup');
  });

  it('quotes exactly the total it is given, so it cannot disagree with the cart', () => {
    // The caller passes the discounted total; quoting a pre-discount subtotal here would send
    // the restaurant a figure the guest never saw.
    expect(buildWhatsAppText(m, 'Casa', lines, '€18,00', { pickup: true })).toContain('Estimated total: €18,00');
  });

  it('writes the message in the guest language, including Arabic', () => {
    const ar = { customer: getMessages('ar').customer };
    const text = buildWhatsAppText(ar, 'كازا', lines, '١٠', { pickup: true, phone: '+351900000000' });
    expect(text).toContain('كازا');
    expect(text).toContain('الهاتف: +351900000000');
  });
});
