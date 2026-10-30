import { parseMoneyToCents } from '@/lib/money';
import { MAX_IMPORT_ITEMS, type ParsedMenuItem, type ParseResult } from './types';

/** RFC 4180 CSV parser with delimiter detection (`,` `;` tab `|`), quotes, CRLF and BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t', '|'].map((d) => {
    let n = 0;
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    return [d, n] as const;
  });
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '_')
    .replace(/^_|_$/g, '');

/** Column names recognised in the 5 supported languages and common platform exports. */
const SYNONYMS: Record<string, string[]> = {
  category: ['category', 'categoria', 'categorie', 'category_name', 'section', 'seccao', 'seccion', 'menu_section', 'فئة', 'القسم'],
  name: ['name', 'nome', 'nom', 'nombre', 'product', 'product_name', 'produto', 'producto', 'prato', 'plat', 'plato', 'item', 'item_name', 'dish', 'title', 'اسم', 'الطبق'],
  description: ['description', 'descricao', 'descripcion', 'desc', 'details', 'detalhes', 'الوصف'],
  price: ['price', 'preco', 'prix', 'precio', 'pvp', 'price_eur', 'valor', 'amount', 'السعر'],
  variant: ['variant', 'variante', 'size', 'tamanho', 'taille', 'tamano', 'الحجم'],
  image: ['image', 'image_url', 'imagem', 'foto', 'photo', 'photo_url', 'picture', 'img'],
  available: ['available', 'availability', 'disponivel', 'disponible', 'active', 'ativo', 'activo', 'متوفر'],
  externalId: ['id', 'external_id', 'sku', 'code', 'codigo', 'reference', 'ref', 'product_id', 'item_id'],
  currency: ['currency', 'moeda', 'devise', 'moneda'],
};

export function mapHeaders(header: string[]): Partial<Record<keyof typeof SYNONYMS, number>> {
  const out: Partial<Record<keyof typeof SYNONYMS, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(SYNONYMS)) {
      if (out[field as keyof typeof SYNONYMS] === undefined && names.includes(n)) out[field as keyof typeof SYNONYMS] = i;
    }
  });
  return out;
}

function parseBool(v: string): boolean | undefined {
  const n = norm(v);
  if (['1', 'true', 'yes', 'sim', 'oui', 'si', 'available', 'disponivel', 'disponible', 'ativo', 'activo', 'نعم'].includes(n)) return true;
  if (['0', 'false', 'no', 'nao', 'non', 'unavailable', 'indisponivel', 'inactivo', 'inativo', 'لا'].includes(n)) return false;
  return undefined;
}

/**
 * Turns spreadsheet rows (first row = headers) into menu items. Rows with the same category +
 * name and a variant column become one item with variants. Unreadable values become warnings,
 * never guesses.
 */
export function rowsToItems(rows: string[][]): ParseResult {
  if (rows.length < 2) return { status: 'FAILED', extractionMethod: 'STRUCTURED_FILE', items: [], warnings: [], error: 'The file has no data rows.' };
  const cols = mapHeaders(rows[0]);
  if (cols.name === undefined) {
    return {
      status: 'FAILED',
      extractionMethod: 'STRUCTURED_FILE',
      items: [],
      warnings: [],
      error: `No “name” column found. Recognised headers include: name, nome, nom, nombre. Found: ${rows[0].join(', ')}`,
    };
  }
  const warnings: string[] = [];
  if (cols.price === undefined) warnings.push('No price column found — prices must be entered during review.');
  const get = (r: string[], k: keyof typeof SYNONYMS) => (cols[k] === undefined ? '' : (r[cols[k]!] ?? '').trim());
  const byKey = new Map<string, ParsedMenuItem>();
  const items: ParsedMenuItem[] = [];
  rows.slice(1).forEach((r, idx) => {
    const rowNumber = idx + 2;
    const name = get(r, 'name');
    if (!name) {
      warnings.push(`Row ${rowNumber}: no name — skipped.`);
      return;
    }
    const w: string[] = [];
    const rawPrice = get(r, 'price');
    let priceCents: number | undefined;
    if (rawPrice) {
      const c = parseMoneyToCents(rawPrice);
      if (c === null) w.push(`Price “${rawPrice}” could not be read.`);
      else priceCents = c;
    } else if (cols.price !== undefined) w.push('No price.');
    const currency = get(r, 'currency').toUpperCase() || undefined;
    if (currency && currency !== 'EUR') w.push(`Currency ${currency} is not EUR.`);
    const category = get(r, 'category') || undefined;
    const variant = get(r, 'variant');
    const key = `${(category ?? '').toLowerCase()}|${name.toLowerCase()}`;
    if (variant) {
      const existing = byKey.get(key);
      if (existing) {
        existing.variants!.push({ name: variant, priceCents });
        existing.warnings.push(...w);
        return;
      }
    }
    const item: ParsedMenuItem = {
      categoryName: category,
      name: name.slice(0, 120),
      description: get(r, 'description').slice(0, 1000) || undefined,
      priceCents,
      currency,
      imageUrl: get(r, 'image') || undefined,
      available: get(r, 'available') ? parseBool(get(r, 'available')) : undefined,
      externalId: get(r, 'externalId') || undefined,
      variants: variant ? [{ name: variant, priceCents }] : undefined,
      rowNumber,
      warnings: w,
    };
    if (!item.categoryName) item.warnings.push('No category.');
    items.push(item);
    if (variant) byKey.set(key, item);
  });
  // Items with variants: the base price is the cheapest variant.
  for (const it of items) {
    if (it.variants?.length) {
      const prices = it.variants.map((v) => v.priceCents).filter((p): p is number => p !== undefined);
      it.priceCents = prices.length ? Math.min(...prices) : undefined;
      if (it.variants.length === 1) it.variants = undefined;
    }
  }
  if (items.length > MAX_IMPORT_ITEMS) return { status: 'FAILED', extractionMethod: 'STRUCTURED_FILE', items: [], warnings, error: `Too many items (${items.length}). The maximum per import is ${MAX_IMPORT_ITEMS}.` };
  if (items.length === 0) return { status: 'FAILED', extractionMethod: 'STRUCTURED_FILE', items: [], warnings, error: 'No menu items were found in the file.' };
  return { status: 'PARSED', extractionMethod: 'STRUCTURED_FILE', items, warnings };
}
