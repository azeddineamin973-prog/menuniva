import { parseMoneyToCents } from '@/lib/money';
import { MAX_IMPORT_ITEMS, type ParsedMenuItem, type ParseResult } from './types';

// "Tajine de Frango ........ 16,90 €"  /  "Chá de menta 2.50"  /  "Couscous - €12"
const PRICE_AT_END = /^(.*?\p{L}.*?)[\s.·…_\-–—:|]*(€\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(€|eur|euros?)?\s*$/iu;

function itemFromLine(line: string): { name: string; cents: number } | null {
  const m = PRICE_AT_END.exec(line);
  if (!m) return null;
  const [, rawName, eurBefore, num, eurAfter] = m;
  const cents = parseMoneyToCents(num);
  // "Menu 2024" or "Mesa 12" is not a price: require € or decimals, and a sane amount.
  if (cents === null || !(eurBefore || eurAfter || /[.,]\d{1,2}$/.test(num)) || cents > 500_00) return null;
  return { name: rawName.replace(/[\s.·…_\-–—:|]+$/, '').trim(), cents };
}

/**
 * Heuristic parser for pasted or PDF-extracted menu text. Lines ending in a price become
 * items; short lines without a price become categories; other lines after an item become its
 * description. Anything uncertain is flagged for review instead of guessed.
 */
export function parseMenuText(input: string, method: 'MANUAL_PASTE' | 'NATIVE_TEXT' = 'MANUAL_PASTE'): ParseResult {
  const lines = input
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const items: ParsedMenuItem[] = [];
  const warnings: string[] = [];
  let category: string | undefined;
  let last: ParsedMenuItem | null = null;
  lines.forEach((line, i) => {
    const item = itemFromLine(line);
    if (item) {
      last = { categoryName: category, name: item.name.slice(0, 120), priceCents: item.cents, rowNumber: i + 1, warnings: category ? [] : ['No category.'] };
      items.push(last);
      return;
    }
    const allCaps = line === line.toUpperCase() && /\p{L}/u.test(line);
    const words = line.split(' ').length;
    const next = lines[i + 1];
    const nextIsItem = !!next && itemFromLine(next) !== null;
    // After a dish, a mixed-case line is a description unless it is short (≤ 3 words) like "Sobremesas".
    const looksLikeHeading = line.length <= 40 && !/[.!?,]$/.test(line) && (allCaps || !last || (words <= 3 && /^\p{Lu}/u.test(line)));
    if (looksLikeHeading && (nextIsItem || allCaps)) {
      category = line.replace(/:$/, '');
      last = null;
    } else if (last) {
      last.description = `${last.description ? `${last.description} ` : ''}${line}`.slice(0, 1000);
    } else {
      warnings.push(`Line ${i + 1} was not understood: “${line.slice(0, 60)}”`);
    }
  });
  if (items.length > MAX_IMPORT_ITEMS) return { status: 'FAILED', extractionMethod: method, items: [], warnings, error: `Too many items (${items.length}).` };
  if (items.length === 0)
    return { status: 'FAILED', extractionMethod: method, items: [], warnings, error: 'No dishes with prices were recognised. Put one dish per line with its price at the end, e.g. “Tajine de frango 16,90 €”.' };
  return { status: 'PARSED', extractionMethod: method, items, warnings };
}
