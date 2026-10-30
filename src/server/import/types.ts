import type { ExtractionMethod, ImportSourceType, IntegrationStatus } from '@/generated/prisma/enums';

/** One menu item as extracted from a source, before review. Missing data stays missing. */
export type ParsedMenuItem = {
  categoryName?: string;
  name: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  imageUrl?: string;
  variants?: { name: string; priceCents?: number }[];
  available?: boolean;
  externalId?: string;
  rowNumber?: number;
  warnings: string[];
};

export type ParseResult = {
  status: 'PARSED' | 'FAILED' | 'UNSUPPORTED';
  extractionMethod: ExtractionMethod | null;
  items: ParsedMenuItem[];
  warnings: string[];
  /** Plain-language explanation shown to the owner when nothing could be extracted. */
  error?: string;
};

export type ImportInput = { text?: string; bytes?: Uint8Array; fileName?: string; url?: string };

export interface MenuImportAdapter {
  readonly type: ImportSourceType;
  readonly label: string;
  /** Honest connection status. CONNECTED only for a genuinely working, verified connection. */
  connectionStatus(): { status: IntegrationStatus; note: string };
  parse(input: ImportInput): Promise<ParseResult>;
}

export const MAX_IMPORT_ITEMS = 1000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
