import type { ExtractionMethod, ImportSourceType, IntegrationStatus } from '@/generated/prisma/enums';

/** One choice inside an extracted option group, e.g. "Extra queijo +1,50 €". */
export type ParsedModifierOption = {
  name: string;
  /** Surcharge for this choice, in cents. 0 when the choice is free. */
  priceDeltaCents?: number;
  available?: boolean;
};

/**
 * An "extras"/customisation group as offered by the source, e.g. "Molhos (choose up to 2)".
 * `minSelect`/`maxSelect` are only set when the source states them; otherwise review decides.
 */
export type ParsedModifierGroup = {
  name: string;
  minSelect?: number;
  maxSelect?: number;
  options: ParsedModifierOption[];
};

/** One menu item as extracted from a source, before review. Missing data stays missing. */
export type ParsedMenuItem = {
  categoryName?: string;
  name: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  imageUrl?: string;
  /** Sizes. `priceCents` is the ABSOLUTE price of the size, as in spreadsheet imports. */
  variants?: { name: string; priceCents?: number }[];
  /** Extras/modifiers. Option prices are surcharges, not absolute prices. */
  modifiers?: ParsedModifierGroup[];
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

export type ImportInput = {
  text?: string;
  bytes?: Uint8Array;
  fileName?: string;
  url?: string;
  /** Tenant asking for the import; used to rate-limit adapters that fetch a remote page. */
  organizationId?: string;
};

export interface MenuImportAdapter {
  readonly type: ImportSourceType;
  readonly label: string;
  /** Honest connection status. CONNECTED only for a genuinely working, verified connection. */
  connectionStatus(): { status: IntegrationStatus; note: string };
  parse(input: ImportInput): Promise<ParseResult>;
}

export const MAX_IMPORT_ITEMS = 1000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
