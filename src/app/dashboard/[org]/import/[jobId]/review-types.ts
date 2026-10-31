/** What the review screen knows about one extracted product (plain data, safe to send to the browser). */
export type ReviewDecision = 'CREATE' | 'SKIP' | 'MERGE_WITH_IMPORTED' | 'MERGE_INTO_EXISTING';

export type ReviewSize = { name: string; priceCents?: number };
export type ReviewExtraGroup = { name: string; minSelect?: number; maxSelect?: number; options: { name: string; priceDeltaCents?: number }[] };

export type ReviewItem = {
  id: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  /** The photo the source provided, kept so a changed or removed photo can be restored. */
  sourceImageUrl: string | null;
  /** false = sold out on the platform when it was read. */
  available: boolean | null;
  sizes: ReviewSize[];
  extras: ReviewExtraGroup[];
  warnings: string[];
  sourceType: string;
  /** Glovo/Uber Eats: the price is a platform reference price, never an in-house price. */
  platform: boolean;
  decision: ReviewDecision;
  targetProductId: string | null;
  mergeGroupKey: string | null;
  /** Name of the dish already on the menu that this item resembles, when it is skipped for that reason. */
  similarTo: string | null;
};

export const SOURCE_LABEL: Record<string, string> = { CSV: 'CSV', XLSX: 'Excel', PDF: 'PDF', TEXT: 'Text', GLOVO: 'Glovo', UBER_EATS: 'Uber Eats', IMAGE: 'Photo', MANUAL: 'Manual' };

export const DECISION_BADGE: Record<ReviewDecision, { label: string; tone: 'success' | 'neutral' | 'info' }> = {
  CREATE: { label: 'Import', tone: 'success' },
  SKIP: { label: 'Skip', tone: 'neutral' },
  MERGE_WITH_IMPORTED: { label: 'Merged', tone: 'info' },
  MERGE_INTO_EXISTING: { label: 'Linked', tone: 'info' },
};

/** How a group of extras will be offered to guests once saved. */
export function extrasRule(g: ReviewExtraGroup): string {
  const min = g.minSelect ?? 0;
  const max = Math.min(Math.max(g.maxSelect ?? 1, 1), Math.max(g.options.length, 1));
  if (min >= 1 && max === 1) return 'choose 1';
  if (min >= 1) return `choose ${min}–${max}`;
  return max === 1 ? 'optional, 1' : `optional, up to ${max}`;
}
