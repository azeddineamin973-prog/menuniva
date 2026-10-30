import 'server-only';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Kitchen / café ticket printing (Additional requirement 2).
 * Works today: browser print and PDF (any printer the tablet can reach).
 * Thermal printers: an ESC/POS formatter is provided, but direct network printing is
 * NEEDS CONFIGURATION and has NOT been tested with real hardware.
 */
export type TicketData = {
  restaurant: string;
  station: string;
  orderNumber: number;
  where: string;
  createdAt: Date;
  timeZone: string;
  items: { quantity: number; name: string; detail?: string | null; notes?: string | null }[];
  orderNotes?: string | null;
};

export interface PrinterAdapter {
  readonly id: 'browser' | 'escpos-network';
  status(): { configured: boolean; tested: boolean; note: string };
}

export const BROWSER_PRINTING: PrinterAdapter = {
  id: 'browser',
  status: () => ({ configured: true, tested: true, note: 'Print or save as PDF from the browser.' }),
};

export const ESC_POS_NETWORK: PrinterAdapter = {
  id: 'escpos-network',
  status: () => ({ configured: false, tested: false, note: 'Direct thermal printing is prepared but untested with real hardware. Needs a printer IP and an on-site test.' }),
};

const time = (d: Date, tz: string) => new Intl.DateTimeFormat('pt-PT', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
const ascii = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');

/** ESC/POS byte stream (initialise, bold header, items, cut). Pure function — unit tested. */
export function toEscPos(t: TicketData, width = 42): Uint8Array {
  const ESC = 0x1b;
  const GS = 0x1d;
  const out: number[] = [ESC, 0x40]; // initialise
  const line = (s = '') => out.push(...Buffer.from(ascii(s).slice(0, width) + '\n', 'latin1'));
  out.push(ESC, 0x61, 1, ESC, 0x45, 1, GS, 0x21, 0x11); // center, bold, double size
  line(`#${t.orderNumber}`);
  out.push(GS, 0x21, 0x00);
  line(t.where);
  out.push(ESC, 0x45, 0);
  line(`${t.station} - ${time(t.createdAt, t.timeZone)}`);
  out.push(ESC, 0x61, 0);
  line('-'.repeat(width));
  for (const i of t.items) {
    out.push(ESC, 0x45, 1);
    line(`${i.quantity} x ${i.name}`);
    out.push(ESC, 0x45, 0);
    if (i.detail) line(`   ${i.detail}`);
    if (i.notes) line(`   ! ${i.notes}`);
  }
  if (t.orderNotes) {
    line('-'.repeat(width));
    line(`NOTA: ${t.orderNotes}`);
  }
  line('');
  line('');
  out.push(GS, 0x56, 0x42, 0x00); // partial cut
  return new Uint8Array(out);
}

/** 80 mm wide PDF ticket. */
export async function ticketPdf(t: TicketData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 226; // 80 mm
  const lines: { text: string; size: number; f: typeof font }[] = [
    { text: `#${t.orderNumber}`, size: 22, f: bold },
    { text: t.where, size: 14, f: bold },
    { text: `${t.station} · ${time(t.createdAt, t.timeZone)}`, size: 10, f: font },
    { text: '—', size: 10, f: font },
    ...t.items.flatMap((i) => [
      { text: `${i.quantity} × ${i.name}`, size: 12, f: bold },
      ...(i.detail ? [{ text: `   ${i.detail}`, size: 10, f: font }] : []),
      ...(i.notes ? [{ text: `   ! ${i.notes}`, size: 10, f: bold }] : []),
    ]),
    ...(t.orderNotes ? [{ text: `Nota: ${t.orderNotes}`, size: 10, f: bold }] : []),
  ];
  const safe = (s: string) => s.replace(/[^\x20-\x7E\u00A0-\u00FF—×·]/g, '?').replace(/—/g, '-').replace(/×/g, 'x').replace(/·/g, '-');
  const H = 40 + lines.reduce((h, l) => h + l.size + 6, 0);
  const page = pdf.addPage([W, H]);
  let y = H - 24;
  for (const l of lines) {
    page.drawText(safe(l.text).slice(0, 60), { x: 12, y, size: l.size, font: l.f });
    y -= l.size + 6;
  }
  return pdf.save();
}
