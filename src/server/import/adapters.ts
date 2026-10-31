import 'server-only';
import type { ImportSourceType } from '@/generated/prisma/enums';
import { GLOVO_CAPTURE_SOURCE } from '@/lib/glovo-capture';
import { env } from '../env';
import { parseGlovoCapture } from './glovo';
import { importGlovoMenuFromUrl } from './glovo-fetch';
import { UnsafeUrlError, validatePublicUrl } from './safe-fetch';
import { parseCsv, rowsToItems } from './tabular';
import { parseMenuText } from './text';
import { MAX_IMPORT_BYTES, type ImportInput, type MenuImportAdapter, type ParseResult } from './types';
import { readXlsxRows } from './xlsx';

const failed = (error: string, method: ParseResult['extractionMethod'] = null): ParseResult => ({ status: 'FAILED', extractionMethod: method, items: [], warnings: [], error });
const unsupported = (error: string): ParseResult => ({ status: 'UNSUPPORTED', extractionMethod: null, items: [], warnings: [], error });

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Excel "CSV" files from Windows are often Latin-1: fall back if UTF-8 produced replacement chars.
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

function tooBig(input: ImportInput) {
  return (input.bytes?.length ?? 0) > MAX_IMPORT_BYTES || (input.text?.length ?? 0) > MAX_IMPORT_BYTES;
}

/** Structured spreadsheet parsing shared by CSV/XLSX and platform merchant exports. */
async function parseTabular(input: ImportInput): Promise<ParseResult> {
  if (tooBig(input)) return failed('The file is larger than 5 MB.');
  const name = input.fileName?.toLowerCase() ?? '';
  try {
    if (input.bytes && (name.endsWith('.xlsx') || (input.bytes[0] === 0x50 && input.bytes[1] === 0x4b))) return rowsToItems(readXlsxRows(input.bytes));
    const text = input.text ?? (input.bytes ? decodeText(input.bytes) : '');
    return rowsToItems(parseCsv(text));
  } catch (e) {
    return failed(e instanceof Error ? e.message : 'The file could not be read.', 'STRUCTURED_FILE');
  }
}

export class CSVImporter implements MenuImportAdapter {
  readonly type = 'CSV' as const;
  readonly label = 'CSV file';
  connectionStatus() {
    return { status: 'CONNECTED' as const, note: 'Built-in parser — no external service needed.' };
  }
  parse(input: ImportInput) {
    return parseTabular(input);
  }
}

export class ExcelImporter implements MenuImportAdapter {
  readonly type = 'XLSX' as const;
  readonly label = 'Excel (.xlsx)';
  connectionStatus() {
    return { status: 'CONNECTED' as const, note: 'Built-in parser — no external service needed.' };
  }
  async parse(input: ImportInput) {
    if (!input.bytes) return failed('Please upload an .xlsx file.');
    if (input.fileName?.toLowerCase().endsWith('.xls')) return failed('Old .xls files are not supported. In Excel choose “Save As → Excel Workbook (.xlsx)” or CSV.');
    return parseTabular({ ...input, fileName: input.fileName ?? 'menu.xlsx' });
  }
}

export class TextMenuImporter implements MenuImportAdapter {
  readonly type = 'TEXT' as const;
  readonly label = 'Pasted text';
  connectionStatus() {
    return { status: 'CONNECTED' as const, note: 'Built-in text recognition (rule-based, no AI).' };
  }
  async parse(input: ImportInput) {
    if (!input.text?.trim()) return failed('Paste the menu text first.');
    if (tooBig(input)) return failed('The text is too long.');
    return parseMenuText(input.text, 'MANUAL_PASTE');
  }
}

/** Native text extraction from digital PDFs. Scanned PDFs (images only) need OCR, which is not configured. */
export class PDFMenuImporter implements MenuImportAdapter {
  readonly type = 'PDF' as const;
  readonly label = 'PDF menu';
  connectionStatus() {
    return { status: 'LIMITED' as const, note: 'Digital PDFs: text is extracted directly. Scanned PDFs need OCR (not configured).' };
  }
  async parse(input: ImportInput) {
    if (!input.bytes) return failed('Please upload a PDF file.');
    if (tooBig(input)) return failed('The PDF is larger than 5 MB.');
    if (Buffer.from(input.bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return failed('This file is not a PDF.');
    let pages: string[];
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(input.bytes));
      pages = (await extractText(pdf, { mergePages: false })).text as string[];
    } catch {
      return failed('The PDF could not be opened. It may be damaged or password-protected.', 'NATIVE_TEXT');
    }
    const text = pages.join('\n').trim();
    if (text.replace(/\s/g, '').length < 10) {
      return failed('This PDF contains no selectable text (it is probably a scanned image). OCR is not configured, so nothing was extracted. Paste the menu text or use a CSV/Excel file instead.', 'NATIVE_TEXT');
    }
    return parseMenuText(text, 'NATIVE_TEXT');
  }
}

/** Photos of menus require OCR. No OCR engine is configured, so this adapter never fakes a result. */
export class ImageMenuImporter implements MenuImportAdapter {
  readonly type = 'IMAGE' as const;
  readonly label = 'Menu photo';
  connectionStatus() {
    return { status: 'NOT_CONFIGURED' as const, note: 'Requires an OCR engine. Not configured — use PDF, CSV, Excel or pasted text.' };
  }
  async parse() {
    return unsupported('Reading text from photos needs an OCR service, which is not configured. Nothing was extracted. Type or paste the menu text instead.');
  }
}

/**
 * Glovo / Uber Eats.
 *
 * MenuNiva never crawls their store pages from the server: the pages carry `noindex, nofollow`
 * and serve no menu data to a non-browser client anyway, and their menu endpoints reject
 * requests without an app session. A partner API connection needs the provider's approval
 * (BLOCKED BY EXTERNAL APPROVAL).
 *
 * What does work, in order of data quality:
 * 1. the merchant export from the partner portal (CSV/XLSX) — includes every field the platform holds;
 * 2. a capture the owner makes in their own browser on their own store page (Glovo only) —
 *    includes categories, prices, photos, sizes and extras (see `./glovo.ts`);
 * 3. pasted menu text — names and prices only.
 *
 * Prices from these sources are stored as platform reference prices, never as in-house prices.
 */
class PlatformAdapter implements MenuImportAdapter {
  constructor(
    readonly type: 'GLOVO' | 'UBER_EATS',
    readonly label: string,
    private hosts: RegExp,
    private hasCredentials: () => boolean,
    /** Parser for a capture made in the owner's browser, where one exists for this platform. */
    private capture?: (raw: string) => ParseResult,
    /** Reads the menu straight from a public store page, where that platform serves one. */
    private fromUrl?: (url: string, organizationId: string) => Promise<ParseResult>,
  ) {}
  connectionStatus() {
    if (this.fromUrl)
      return { status: 'LIMITED' as const, note: `Paste your ${this.label} store link and the menu is read from your public store page. No ${this.label} partner API access (that needs ${this.label} approval).` };
    if (this.hasCredentials())
      return { status: 'LIMITED' as const, note: `Credentials are configured but the ${this.label} partner API connection has not been verified. Use your merchant export.` };
    return { status: 'NOT_CONFIGURED' as const, note: `No ${this.label} partner API access (requires ${this.label} approval). Upload your merchant export or paste your menu.` };
  }
  async parse(input: ImportInput) {
    if (input.url) {
      try {
        validatePublicUrl(input.url, this.hosts);
      } catch (e) {
        return failed(e instanceof UnsafeUrlError ? e.message : 'Invalid link.');
      }
    }
    // An uploaded file or pasted content is what the owner explicitly supplied: use it first.
    if (input.bytes) return parseTabular(input);
    if (input.text?.trim()) {
      const text = input.text;
      // A browser capture is JSON; a merchant export is delimited; anything else is menu text.
      if (this.capture && looksLikeCapture(text)) return this.capture(text);
      const looksTabular = /[,;\t]/.test(text.split('\n', 1)[0] ?? '') && text.split('\n').length > 1;
      return looksTabular ? parseTabular(input) : parseMenuText(text, 'MANUAL_PASTE');
    }
    if (input.url) {
      if (this.fromUrl && input.organizationId) return this.fromUrl(input.url, input.organizationId);
      return unsupported(
        `MenuNiva does not copy menus from ${this.label} store pages: this requires authorisation from ${this.label}. Your link was saved for reference. Download your menu export from the ${this.label} partner portal (CSV/Excel) and upload it here, or paste the menu text.`,
      );
    }
    return failed('Paste your store link, upload your menu export, or paste the menu.');
  }
}

/** True when the pasted text is a MenuNiva browser capture or a raw platform JSON payload. */
function looksLikeCapture(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[') || t.includes(GLOVO_CAPTURE_SOURCE) || /self\.__next_f\.push|<script/i.test(t);
}

export const ADAPTERS: Record<Exclude<ImportSourceType, 'MANUAL'>, MenuImportAdapter> = {
  CSV: new CSVImporter(),
  XLSX: new ExcelImporter(),
  TEXT: new TextMenuImporter(),
  PDF: new PDFMenuImporter(),
  IMAGE: new ImageMenuImporter(),
  GLOVO: new PlatformAdapter('GLOVO', 'Glovo', /(^|\.)glovoapp\.com$/, () => !!env.GLOVO_PARTNER_API_KEY, parseGlovoCapture, (url, organizationId) =>
    importGlovoMenuFromUrl(url, { organizationId }),
  ),
  UBER_EATS: new PlatformAdapter('UBER_EATS', 'Uber Eats', /(^|\.)ubereats\.com$/, () => !!(env.UBER_EATS_CLIENT_ID && env.UBER_EATS_CLIENT_SECRET)),
};

export const PLATFORM_SOURCES: ImportSourceType[] = ['GLOVO', 'UBER_EATS'];
