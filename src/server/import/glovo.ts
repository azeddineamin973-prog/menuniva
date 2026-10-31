import { sizedImageUrl } from '@/lib/image-url';
import { parseMoneyToCents } from '@/lib/money';
import { normalizeName } from './dedupe';
import { MAX_IMPORT_ITEMS, type ParsedMenuItem, type ParsedModifierGroup, type ParsedModifierOption, type ParseResult } from './types';

/**
 * Glovo store menu extraction.
 *
 * Glovo store pages render their menu in the browser: the HTML served to a plain HTTP client
 * contains no dish, price or image (verified: the page carries `noindex, nofollow, nocache`
 * and the menu endpoint on api.glovoapp.com refuses requests without an app session header).
 * MenuNiva therefore never crawls those pages from the server. Instead the restaurant owner
 * captures the menu in their own browser, on their own store page, and pastes it here — see
 * `src/lib/glovo-capture.ts` for the snippet they run.
 *
 * The payload that comes back is undocumented and versioned by Glovo, so this parser does not
 * depend on one fixed shape: it walks whatever JSON it is given and recognises menu items by
 * their characteristic fields. It handles both the raw store payload (which carries the full
 * extras/customisation tree) and the simplified structure produced from the rendered page.
 *
 * Nothing is invented. Values that cannot be read become warnings for the review screen.
 */

const HOST = /(^|\.)glovoapp\.com$/;

export type GlovoStoreRef = {
  /** Store slug, e.g. "casa-de-marrocos-braga". */
  slug: string;
  city?: string;
  /** The URL with query string and fragment removed. */
  url: string;
};

/**
 * Reads a Glovo store link in any of its public forms, e.g.
 * `https://glovoapp.com/pt/en/braga/casa-de-marrocos-braga/` or
 * `https://glovoapp.com/en/pt/braga/stores/casa-de-marrocos-braga`.
 * Throws for anything that is not a Glovo store link.
 */
export function parseGlovoStoreUrl(raw: string): GlovoStoreRef {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('This is not a valid link. Copy the address of your Glovo store page from the browser.');
  }
  if (url.protocol !== 'https:') throw new Error('Only https:// links are accepted.');
  if (!HOST.test(url.hostname)) throw new Error('This is not a glovoapp.com link.');
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const storesAt = segments.findIndex((s) => s.toLowerCase() === 'stores');
  const slug = storesAt >= 0 ? segments[storesAt + 1] : segments[segments.length - 1];
  if (!slug || !/^[\w-]{2,120}$/.test(slug) || /^[a-z]{2}$/i.test(slug)) {
    throw new Error('This link does not point to a store page. Open your restaurant on Glovo and copy the address from the browser.');
  }
  const city = storesAt >= 1 ? segments[storesAt - 1] : segments.length >= 2 ? segments[segments.length - 2] : undefined;
  return { slug, city: city && !/^[a-z]{2}$/i.test(city) ? city : undefined, url: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
}

// --------------------------------------------------------------------------- field recognition

const NAME_KEYS = ['name', 'title', 'productname', 'displayname', 'label', 'heading'];
const DESC_KEYS = ['description', 'descriptiontext', 'subtitle', 'details', 'longdescription', 'summary'];
const PRICE_KEYS = ['price', 'baseprice', 'unitprice', 'finalprice', 'priceamount', 'amount', 'value', 'total'];
const PRICE_TEXT_KEYS = ['displaytext', 'displayprice', 'pricetext', 'formattedprice', 'pricedisplay', 'text', 'label'];
const PRICE_OBJECT_KEYS = ['priceinfo', 'pricing', 'pricedetail', 'pricedetails', 'priceformatted'];
const IMAGE_KEYS = ['imageurl', 'image', 'imageid', 'photourl', 'photo', 'picture', 'thumbnail', 'imagepath', 'imagesrc'];
const SOLD_OUT_KEYS = ['soldout', 'issoldout', 'outofstock', 'unavailable'];
const AVAILABLE_KEYS = ['available', 'isavailable', 'enabled', 'active', 'isactive', 'instock'];
const GROUP_KEYS = ['attributegroups', 'customizations', 'modifiergroups', 'optiongroups', 'choicegroups', 'extras', 'modifiers', 'options', 'attributes'];
const OPTION_KEYS = ['attributes', 'options', 'items', 'values', 'choices', 'children', 'elements', 'products'];
const MIN_KEYS = ['minselect', 'min', 'minimum', 'minselection', 'minchoices', 'minimumselection', 'required'];
const MAX_KEYS = ['maxselect', 'max', 'maximum', 'maxselection', 'maxchoices', 'maximumselection', 'limit'];
// `storeProductId` is Glovo's stable per-store identifier, so a re-import matches the same dish
// even after the restaurant renames it or changes its own SKU.
const EXTERNAL_ID_KEYS = ['storeproductid', 'externalid', 'productid', 'sku', 'code', 'reference', 'id'];
const DELTA_KEYS = ['priceimpact', 'extraprice', 'pricedelta', 'surcharge', 'additionalprice'];
/** Group names that describe a size rather than an extra, in the five supported languages. */
const SIZE_WORDS = /\b(size|sizes|tamanho|tamanhos|tamano|tamanos|tamaño|tamaños|taille|tailles|dimension|formato|porcao|porcion|portion|variant|variante)\b|الحجم|حجم/i;
/** Container keys that never hold a dish name worth using as a category label. */
const SKIP_KEYS = new Set(['tracking', 'analytics', 'metadata', 'seo', 'style', 'styles', 'theme', 'icon', 'icons', 'links', 'breadcrumbs', 'filters', 'promotion', 'promotions', 'banner', 'banners', 'ads']);

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Case/underscore-insensitive lookup: `max_select`, `maxSelect` and `MaxSelect` all match `maxselect`. */
function pick(o: Obj, keys: string[]): unknown {
  const flat = new Map<string, unknown>();
  for (const [k, v] of Object.entries(o)) {
    const n = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!flat.has(n) || flat.get(n) === null || flat.get(n) === undefined) flat.set(n, v);
  }
  for (const k of keys) {
    const v = flat.get(k);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function str(v: unknown, max = 1000): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

function nameOf(o: Obj): string | undefined {
  const v = pick(o, NAME_KEYS);
  // Glovo also returns localised names as { en: "...", pt: "..." }.
  if (isObj(v)) return str(Object.values(v).find((x) => typeof x === 'string'), 120);
  return str(v, 120);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

/**
 * Reads a price in euro cents. A human-readable string ("11,90 €") wins over a raw number,
 * because it is what the guest actually sees on Glovo and it carries the decimal separator.
 */
function priceOf(o: Obj): { cents?: number; currency?: string; warning?: string } {
  const candidates: unknown[] = [pick(o, PRICE_KEYS)];
  let currency: string | undefined;
  for (const k of PRICE_OBJECT_KEYS) {
    const nested = pick(o, [k]);
    if (!isObj(nested)) continue;
    currency = str(pick(nested, ['currencycode', 'currency']), 8) ?? currency;
    candidates.unshift(pick(nested, PRICE_TEXT_KEYS), pick(nested, PRICE_KEYS));
  }
  currency = currency ?? str(pick(o, ['currencycode', 'currency']), 8);
  // A display string anywhere on the node is the most reliable source.
  const display = candidates.find((c) => typeof c === 'string' && /\d/.test(c) && /[€$£]|eur/i.test(c));
  const ordered = display !== undefined ? [display, ...candidates] : candidates;
  for (const c of ordered) {
    if (c === undefined || c === null) continue;
    const n = num(c);
    // Numbers are major units (11.9 = 11,90 €); strings go through the shared money parser.
    const cents = n !== undefined ? parseMoneyToCents(n.toFixed(2)) : typeof c === 'string' ? parseMoneyToCents(c.replace(/[^\d.,]/g, '')) : null;
    if (cents === null || cents === undefined) continue;
    // A menu price above 500 € is almost certainly a unit mix-up; keep it but ask for a check.
    return { cents, currency, warning: cents > 500_00 ? `Unusual price read from Glovo (${(cents / 100).toFixed(2)}) — check it.` : undefined };
  }
  return { currency };
}

/**
 * Glovo dish photos are referenced as `dh:<path>` (Glovo is part of Delivery Hero) and served
 * from the Delivery Hero image CDN, which takes a width parameter.
 */
const DH_IMAGE_BASE = 'https://images.deliveryhero.io/image/';
export const GLOVO_IMAGE_WIDTH = 800;

/** Resolves an image reference to an https URL, or returns nothing. Never guesses a CDN path. */
function imageOf(o: Obj): string | undefined {
  let v = pick(o, IMAGE_KEYS);
  if (isObj(v)) v = pick(v, ['url', 'src', 'href', ...IMAGE_KEYS]);
  const s = str(v, 500);
  if (!s) return undefined;
  // Templated sizes, e.g. ".../{w}x{h}/image.jpg".
  const sized = s.replace(/\{w(idth)?\}/gi, '600').replace(/\{h(eight)?\}/gi, '600').replace(/\{q(uality)?\}/gi, '80');
  if (/^https:\/\//i.test(sized)) return sized;
  if (/^\/\//.test(sized)) return `https:${sized}`;
  // `dh:menus-glovo/products/<hash>` → a real CDN URL at a size worth storing.
  const dh = /^dh:(.+)$/i.exec(sized);
  if (dh) return sizedImageUrl(`${DH_IMAGE_BASE}${dh[1].replace(/^\/+/, '')}`, GLOVO_IMAGE_WIDTH) ?? undefined;
  return undefined;
}

function availabilityOf(o: Obj): boolean | undefined {
  const soldOut = pick(o, SOLD_OUT_KEYS);
  if (typeof soldOut === 'boolean') return !soldOut;
  const available = pick(o, AVAILABLE_KEYS);
  if (typeof available === 'boolean') return available;
  const text = str(available, 40)?.toLowerCase();
  if (text === 'available' || text === 'in_stock') return true;
  if (text === 'sold_out' || text === 'unavailable' || text === 'out_of_stock') return false;
  return undefined;
}

function intOf(o: Obj, keys: string[]): number | undefined {
  const v = pick(o, keys);
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= 0 && n <= 99 ? n : undefined;
}

// --------------------------------------------------------------------------- option groups

function optionsOf(group: Obj): ParsedModifierOption[] {
  for (const key of OPTION_KEYS) {
    const arr = pick(group, [key]);
    if (!Array.isArray(arr)) continue;
    const options = arr.filter(isObj).flatMap((o) => {
      const name = nameOf(o);
      if (!name) return [];
      const delta = priceOf({ ...o, ...(pick(o, DELTA_KEYS) !== undefined ? { price: pick(o, DELTA_KEYS) } : {}) });
      return [{ name, priceDeltaCents: delta.cents ?? 0, available: availabilityOf(o) }];
    });
    if (options.length) return options;
  }
  return [];
}

/** Title-cased fallback name for a group that the source left unnamed, e.g. "extras" → "Extras". */
const keyLabel = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** Extras/customisation groups declared on a product node. */
function groupsOf(product: Obj): ParsedModifierGroup[] {
  const out: ParsedModifierGroup[] = [];
  const seen = new Set<string>();
  const add = (name: string, source: Obj, options: ParsedModifierOption[]) => {
    if (!options.length) return;
    const key = `${normalizeName(name)}|${options.map((o) => normalizeName(o.name)).join('|')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, minSelect: intOf(source, MIN_KEYS), maxSelect: intOf(source, MAX_KEYS), options });
  };
  for (const key of GROUP_KEYS) {
    const arr = pick(product, [key]);
    if (!Array.isArray(arr)) continue;
    const objects = arr.filter(isObj);
    const groups = objects.filter((g) => optionsOf(g).length > 0);
    if (groups.length) {
      for (const g of groups) add(nameOf(g) ?? keyLabel(key), g, optionsOf(g));
      continue;
    }
    // A flat list of choices directly under the key, e.g. extras: [{ name, price }, …].
    const flat = objects.flatMap((o) => {
      const name = nameOf(o);
      if (!name) return [];
      const delta = priceOf({ ...o, ...(pick(o, DELTA_KEYS) !== undefined ? { price: pick(o, DELTA_KEYS) } : {}) });
      return [{ name, priceDeltaCents: delta.cents ?? 0, available: availabilityOf(o) }];
    });
    if (flat.length) add(keyLabel(key), product, flat);
  }
  return out;
}

/**
 * Splits captured groups into MenuNiva's two concepts:
 * - sizes (ProductVariant): a group whose name names a size, e.g. "Tamanho", "Size";
 * - extras (ModifierGroup): everything else, including single-choice groups like "Molho".
 *
 * Glovo states option prices as surcharges. MenuNiva variants carry absolute prices (as in
 * spreadsheet imports), so a size surcharge is added to the base price here.
 */
function splitGroups(groups: ParsedModifierGroup[], basePriceCents: number | undefined, warnings: string[]) {
  const sizes = groups.filter((g) => SIZE_WORDS.test(g.name));
  const extras = groups.filter((g) => !SIZE_WORDS.test(g.name));
  const variants = sizes.flatMap((g) =>
    g.options.map((o) => {
      const delta = o.priceDeltaCents ?? 0;
      // An option priced at or above the base price is already an absolute price.
      const absolute = basePriceCents === undefined ? delta || undefined : delta >= basePriceCents && delta > 0 ? delta : basePriceCents + delta;
      return { name: o.name, priceCents: absolute };
    }),
  );
  if (sizes.length > 1) warnings.push(`Several size groups were found (${sizes.map((s) => s.name).join(', ')}) — check the sizes.`);
  return { variants: variants.length ? variants : undefined, extras: extras.length ? extras : undefined };
}

// --------------------------------------------------------------------------- tree walking

/** A node is a dish when it is named and either priced or marked as a product by the source. */
function isProductNode(o: Obj): boolean {
  if (!nameOf(o)) return false;
  const marker = [str(pick(o, ['type']), 60), str(pick(o, ['__typename']), 60), str(pick(o, ['nodetype']), 60)].filter(Boolean).join(' ').toLowerCase();
  if (/collection|section|group|category|header|banner|carousel|filter|promo/.test(marker)) return false;
  // Either the node is priced, or the source explicitly types it as a product (sold-out dishes
  // sometimes arrive without a price; they are still dishes and are imported as unavailable).
  const priced = priceOf(o).cents !== undefined;
  if (!priced && !/product|item|dish|tile/.test(marker)) return false;
  // A node that lists several priced, named children is a container, not a dish.
  const hasProductChildren = Object.entries(o).some(
    ([k, v]) => !GROUP_KEYS.includes(k.toLowerCase().replace(/[^a-z0-9]/g, '')) && Array.isArray(v) && v.filter(isObj).filter((c) => nameOf(c) && priceOf(c).cents !== undefined).length >= 2,
  );
  return !hasProductChildren;
}

/** A node that only names a part of the menu, e.g. a collection or section heading. */
function categoryLabelOf(o: Obj): string | undefined {
  if (priceOf(o).cents !== undefined) return undefined;
  const label = nameOf(o);
  if (!label || label.length > 60) return undefined;
  const hasChildArray = Object.values(o).some((v) => Array.isArray(v) && v.some(isObj));
  return hasChildArray ? label : undefined;
}

function toItem(o: Obj, categoryName: string | undefined, rowNumber: number): ParsedMenuItem {
  const warnings: string[] = [];
  const { cents, currency, warning } = priceOf(o);
  if (warning) warnings.push(warning);
  const groups = groupsOf(o);
  const { variants, extras } = splitGroups(groups, cents, warnings);
  const available = availabilityOf(o);
  if (cents === undefined) warnings.push('No price found on Glovo.');
  if (!categoryName) warnings.push('No category.');
  if (available === false) warnings.push('Marked as sold out on Glovo.');
  if (currency && currency.toUpperCase() !== 'EUR') warnings.push(`Currency ${currency} is not EUR.`);
  // Glovo product ids arrive as numbers; keep them so re-imports can match the same dish.
  const rawId = pick(o, EXTERNAL_ID_KEYS);
  const externalId = typeof rawId === 'number' && Number.isFinite(rawId) ? String(rawId) : str(rawId, 60);
  return {
    categoryName,
    name: nameOf(o)!,
    description: str(pick(o, DESC_KEYS), 1000),
    priceCents: cents,
    currency: currency?.toUpperCase(),
    imageUrl: imageOf(o),
    variants,
    modifiers: extras,
    available,
    externalId,
    rowNumber,
    warnings,
  };
}

const MAX_DEPTH = 40;
const MAX_NODES = 400_000;

/** Collects every dish in an arbitrary JSON tree, remembering the nearest enclosing heading. */
function collectItems(root: unknown): ParsedMenuItem[] {
  const items: ParsedMenuItem[] = [];
  let nodes = 0;
  const walk = (node: unknown, categories: string[], depth: number) => {
    if (nodes++ > MAX_NODES || depth > MAX_DEPTH || items.length > MAX_IMPORT_ITEMS * 3) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, categories, depth + 1);
      return;
    }
    if (!isObj(node)) return;
    if (isProductNode(node)) {
      items.push(toItem(node, categories[categories.length - 1], items.length + 1));
      return; // never descend into a dish: its options are not dishes
    }
    const label = categoryLabelOf(node);
    const next = label ? [...categories, label] : categories;
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key.toLowerCase())) continue;
      if (isObj(value) || Array.isArray(value)) walk(value, next, depth + 1);
    }
  };
  walk(root, [], 0);
  return items;
}

// --------------------------------------------------------------------------- payload extraction

/**
 * Scans text for balanced JSON objects/arrays and returns those that parse. Used only when the
 * paste is not plain JSON (a saved page, or JSON wrapped in other output).
 *
 * Both the number of candidates and the total characters examined are capped: an import may be
 * up to 5 MB, and text full of unbalanced `{"` sequences would otherwise cost one full pass per
 * candidate. Hitting a cap means some payloads are not read, never that the request hangs.
 */
function scanJson(text: string, budget = 3000, workBudget = 20_000_000): unknown[] {
  const found: unknown[] = [];
  let attempts = 0;
  let work = workBudget;
  for (let i = 0; i < text.length && attempts < budget && work > 0; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    if (open === '{' && text[i + 1] !== '"') continue;
    attempts++;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let j = i; j < text.length && work > 0; j++) {
      work--;
      const c = text[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const slice = text.slice(i, end + 1);
    try {
      const parsed: unknown = JSON.parse(slice);
      if (isObj(parsed) || Array.isArray(parsed)) {
        found.push(parsed);
        i = end; // continue after this object
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  return found;
}

/**
 * Pulls every JSON payload out of what the owner pasted: the captured menu itself, JSON inside
 * <script> tags, or React streaming chunks (`self.__next_f.push`) from a saved page.
 */
export function extractJsonPayloads(raw: string): unknown[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return [JSON.parse(text)];
    } catch {
      // fall through to scanning: the paste may be truncated or wrapped in other output
    }
  }
  const payloads: unknown[] = [];
  for (const m of text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1].trim();
    if (!body) continue;
    if (body.startsWith('{') || body.startsWith('[')) {
      try {
        payloads.push(JSON.parse(body));
        continue;
      } catch {
        /* scanned below */
      }
    }
    // React server-component streams arrive as pushes of escaped JSON string chunks.
    const chunks = [...body.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g)].flatMap((c) => {
      try {
        return [JSON.parse(c[1]) as string];
      } catch {
        return [];
      }
    });
    if (chunks.length) payloads.push(...scanJson(chunks.join('')));
    else payloads.push(...scanJson(body));
  }
  if (!payloads.length) payloads.push(...scanJson(text));
  return payloads;
}

// --------------------------------------------------------------------------- public parser

/** Same dish repeated across collections (Glovo does this) is imported once. */
function dedupe(items: ParsedMenuItem[]): ParsedMenuItem[] {
  const byKey = new Map<string, ParsedMenuItem>();
  for (const it of items) {
    const key = it.externalId ? `id:${it.externalId}` : `n:${normalizeName(it.name)}|${it.priceCents ?? ''}`;
    const existing = byKey.get(key);
    // Keep the richest version of a repeated dish.
    const score = (x: ParsedMenuItem) => (x.description ? 2 : 0) + (x.imageUrl ? 2 : 0) + (x.modifiers?.length ?? 0) + (x.variants?.length ?? 0) + (x.categoryName ? 1 : 0);
    if (!existing || score(it) > score(existing)) byKey.set(key, existing ? { ...it, categoryName: it.categoryName ?? existing.categoryName } : it);
  }
  return [...byKey.values()].map((it, i) => ({ ...it, rowNumber: i + 1 }));
}

const EMPTY =
  'No dishes were found in what was pasted. Make sure you ran the capture on your own Glovo store page while the menu was visible, then pasted the whole result. Your Glovo menu export (CSV/Excel) from the partner portal also works.';

/**
 * Parses a Glovo menu capture. Accepts the raw store payload, a simplified capture, or a saved
 * store page. Returns PARSED only when at least one dish was genuinely found.
 */
export function parseGlovoCapture(raw: string): ParseResult {
  const warnings: string[] = [];
  const payloads = extractJsonPayloads(raw);
  if (!payloads.length) {
    return {
      status: 'FAILED',
      extractionMethod: 'MANUAL_PASTE',
      items: [],
      warnings,
      error: 'No menu data could be read from what was pasted. Paste the full result of the capture snippet (it starts with "{").',
    };
  }
  const items = dedupe(payloads.flatMap(collectItems));
  if (!items.length) return { status: 'FAILED', extractionMethod: 'MANUAL_PASTE', items: [], warnings, error: EMPTY };
  if (items.length > MAX_IMPORT_ITEMS) {
    return { status: 'FAILED', extractionMethod: 'MANUAL_PASTE', items: [], warnings, error: `Too many items (${items.length}). The maximum per import is ${MAX_IMPORT_ITEMS}.` };
  }
  const withoutCategory = items.filter((i) => !i.categoryName).length;
  if (withoutCategory) warnings.push(`${withoutCategory} of ${items.length} dishes had no section heading — set their category during review.`);
  const soldOut = items.filter((i) => i.available === false).length;
  if (soldOut) warnings.push(`${soldOut} dishes are currently sold out on Glovo; they are imported as unavailable.`);
  warnings.push('Prices come from Glovo and are kept as reference prices only — your own dine-in prices are never changed.');
  return { status: 'PARSED', extractionMethod: 'MANUAL_PASTE', items, warnings };
}
