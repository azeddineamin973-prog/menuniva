import 'server-only';
import { z } from 'zod';
import type { ImportDecisionType, ImportSourceType, LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { sizedImageUrl } from '@/lib/image-url';
import { parseMoneyToCents } from '@/lib/money';
import { audit } from '../audit';
import { db, type Tx } from '../db';
import { assertMenuItemCapacity } from '../services/limits';
import { assertModule } from '../modules';
import { UserFacingError } from '../errors';
import { newPublicToken } from '../crypto';
import { deleteTenantMedia } from '../media';
import { isOversizedPicture, mediaKeyFromPath, sniffImage, storage, storeTenantImage } from '../storage';
import type { TenantContext } from '../tenant';
import { ADAPTERS, PLATFORM_SOURCES } from './adapters';
import { DUPLICATE_THRESHOLD, groupDuplicates, normalizeName, similarity } from './dedupe';
import { safeFetch } from './safe-fetch';
import { MAX_IMPORT_ITEMS, type ParsedMenuItem } from './types';

const SYSTEM = 'system';
const isPlatform = (t: ImportSourceType) => PLATFORM_SOURCES.includes(t);

async function ownedJob(ctx: TenantContext, jobId: string, tx: Tx | typeof db = db) {
  const job = await tx.importJob.findFirst({ where: { id: jobId, organizationId: ctx.org.id } });
  if (!job) throw new UserFacingError('Import not found.', 404);
  return job;
}

export async function createImportJob(ctx: TenantContext) {
  await assertModule(ctx.org.id, 'import');
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true } });
  const job = await db.importJob.create({ data: { organizationId: ctx.org.id, createdById: ctx.userId, sourceLanguage: org.sourceLanguage } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.job_created', entityType: 'ImportJob', entityId: job.id });
  return job;
}

export const addSourceSchema = z.object({
  type: z.enum(['CSV', 'XLSX', 'PDF', 'IMAGE', 'TEXT', 'GLOVO', 'UBER_EATS']),
  text: z.string().max(5 * 1024 * 1024).optional(),
  url: z.string().max(500).optional(),
  fileName: z.string().max(200).optional(),
});

type SourceInput = z.infer<typeof addSourceSchema>;

/** Reads a source with its adapter. Network and file parsing only; writes nothing. */
function parseSource(ctx: TenantContext, d: SourceInput, bytes?: Uint8Array) {
  return ADAPTERS[d.type].parse({
    text: d.text?.trim() ? d.text : undefined,
    url: d.url?.trim() || undefined,
    fileName: d.fileName,
    bytes,
    organizationId: ctx.org.id,
  });
}

/** Parses one source into the job. Nothing reaches the menu until the owner publishes. */
export async function addImportSource(ctx: TenantContext, jobId: string, input: unknown, bytes?: Uint8Array) {
  await assertModule(ctx.org.id, 'import');
  const d = addSourceSchema.parse(input);
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'DRAFT' && job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import is closed.');
  return saveSource(ctx, job.id, d, await parseSource(ctx, d, bytes));
}

/**
 * One-step import ("paste the link, press Import"): the source is read first, and an import is
 * created only when dishes were found, so a mistyped link or an unreadable file leaves no empty
 * import behind. The error explains what to do instead.
 */
export async function startImport(ctx: TenantContext, input: unknown, bytes?: Uint8Array) {
  await assertModule(ctx.org.id, 'import');
  const d = addSourceSchema.parse(input);
  const result = await parseSource(ctx, d, bytes);
  if (result.status !== 'PARSED' || result.items.length === 0) throw new UserFacingError(result.error ?? 'No dishes could be read from this source.');
  const job = await createImportJob(ctx);
  const saved = await saveSource(ctx, job.id, d, result);
  return { jobId: job.id, items: saved.items };
}

async function saveSource(ctx: TenantContext, jobId: string, d: SourceInput, result: Awaited<ReturnType<typeof parseSource>>) {
  const job = { id: jobId };
  const conn = ADAPTERS[d.type].connectionStatus();
  const source = await db.$transaction(async (tx) => {
    const src = await tx.importSource.create({
      data: {
        jobId: job.id,
        type: d.type,
        url: d.url?.trim() || null,
        fileName: d.fileName ?? null,
        extractionMethod: result.extractionMethod,
        connectionStatus: conn.status,
        status: result.status,
        errorMessage: result.error ?? (result.warnings.length ? result.warnings.slice(0, 20).join('\n') : null),
      },
    });
    if (result.items.length) {
      await tx.importedProduct.createMany({ data: result.items.map((it) => toImported(job.id, src.id, it)) });
      await tx.importJob.update({ where: { id: job.id }, data: { status: 'NEEDS_REVIEW' } });
    }
    await recomputeSuggestions(tx, job.id, ctx.org.id);
    return src;
  });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.source_added', entityType: 'ImportJob', entityId: job.id, metadata: { type: d.type, status: result.status, items: result.items.length } });
  return { sourceId: source.id, status: result.status, items: result.items.length, error: result.error };
}

function toImported(jobId: string, sourceId: string, it: ParsedMenuItem) {
  return {
    jobId,
    sourceId,
    categoryName: it.categoryName?.slice(0, 120) ?? null,
    name: it.name.slice(0, 120),
    description: it.description ?? null,
    imageUrl: it.imageUrl ?? null,
    priceCents: it.priceCents ?? null,
    currency: it.currency ?? 'EUR',
    variants: it.variants ?? undefined,
    modifiers: it.modifiers ?? undefined,
    available: it.available ?? null,
    externalId: it.externalId ?? null,
    warnings: it.warnings,
    rowNumber: it.rowNumber ?? null,
  };
}

/** Rebuilds duplicate groups and default decisions. Decisions made by a person are kept. */
async function recomputeSuggestions(tx: Tx, jobId: string, organizationId: string) {
  const job = await tx.importJob.findUniqueOrThrow({ where: { id: jobId } });
  const products = await tx.importedProduct.findMany({ where: { jobId }, include: { source: true }, orderBy: [{ sourceId: 'asc' }, { rowNumber: 'asc' }] });
  await tx.importMapping.deleteMany({ where: { jobId } });
  await tx.importReviewDecision.deleteMany({ where: { jobId, decidedById: SYSTEM } });
  const manual = new Set((await tx.importReviewDecision.findMany({ where: { jobId }, select: { importedProductId: true } })).map((d) => d.importedProductId));

  const existing = await tx.menuProduct.findMany({
    where: { organizationId, status: { not: 'ARCHIVED' } },
    select: { id: true, translations: { where: { language: job.sourceLanguage }, select: { name: true } } },
  });
  const existingMatch = new Map<string, { productId: string; score: number }>();
  for (const p of products) {
    let best: { productId: string; score: number } | null = null;
    for (const e of existing) {
      const n = e.translations[0]?.name;
      if (!n) continue;
      const score = similarity(n, p.name);
      if (score >= DUPLICATE_THRESHOLD && (!best || score > best.score)) best = { productId: e.id, score };
    }
    if (best) existingMatch.set(p.id, best);
  }

  const decisions: { importedProductId: string; decision: ImportDecisionType; targetProductId?: string; mergeGroupKey?: string; isCanonical?: boolean }[] = [];
  for (const [pid, m] of existingMatch) {
    await tx.importMapping.create({ data: { jobId, importedProductIds: [pid], existingProductId: m.productId, confidence: Math.round(m.score * 100), reason: 'Similar to a dish already on your menu' } });
    decisions.push({ importedProductId: pid, decision: 'SKIP', targetProductId: m.productId });
  }
  const candidates = products.filter((p) => !existingMatch.has(p.id)).map((p) => ({ id: p.id, name: p.name, sourceId: p.sourceId, type: p.source.type }));
  const grouped = new Set<string>();
  for (const g of groupDuplicates(candidates)) {
    const mapping = await tx.importMapping.create({ data: { jobId, importedProductIds: g.ids, confidence: g.confidence, reason: 'Same dish found in several sources' } });
    const members = g.ids.map((id) => candidates.find((c) => c.id === id)!);
    const canonical = members.find((m) => !isPlatform(m.type)) ?? members[0];
    for (const m of members) {
      grouped.add(m.id);
      decisions.push(m.id === canonical.id ? { importedProductId: m.id, decision: 'CREATE', mergeGroupKey: mapping.id, isCanonical: true } : { importedProductId: m.id, decision: 'MERGE_WITH_IMPORTED', mergeGroupKey: mapping.id });
    }
  }
  for (const c of candidates) if (!grouped.has(c.id)) decisions.push({ importedProductId: c.id, decision: 'CREATE' });
  const auto = decisions.filter((d) => !manual.has(d.importedProductId));
  if (auto.length) await tx.importReviewDecision.createMany({ data: auto.map((d) => ({ jobId, decidedById: SYSTEM, isCanonical: false, ...d })) });
}

export const decisionSchema = z.object({
  importedProductId: z.string().min(1),
  decision: z.enum(['CREATE', 'MERGE_INTO_EXISTING', 'MERGE_WITH_IMPORTED', 'SKIP']),
  targetProductId: z.string().optional(),
});

export async function setImportDecision(ctx: TenantContext, jobId: string, input: unknown) {
  const d = decisionSchema.parse(input);
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import is closed.');
  const item = await db.importedProduct.findFirst({ where: { id: d.importedProductId, jobId } });
  if (!item) throw new UserFacingError('Item not found.', 404);
  const current = await db.importReviewDecision.findUnique({ where: { jobId_importedProductId: { jobId, importedProductId: item.id } } });
  if (d.decision === 'MERGE_INTO_EXISTING') {
    const target = d.targetProductId ? await db.menuProduct.findFirst({ where: { id: d.targetProductId, organizationId: ctx.org.id } }) : null;
    if (!target) throw new UserFacingError('Choose the existing dish to link to.');
  }
  if (d.decision === 'MERGE_WITH_IMPORTED' && !current?.mergeGroupKey) throw new UserFacingError('This item is not part of a duplicate group.');
  await db.importReviewDecision.upsert({
    where: { jobId_importedProductId: { jobId, importedProductId: item.id } },
    update: { decision: d.decision, targetProductId: d.decision === 'MERGE_INTO_EXISTING' ? d.targetProductId : current?.targetProductId ?? null, decidedById: ctx.userId, isCanonical: d.decision === 'CREATE' && !!current?.isCanonical },
    create: { jobId, importedProductId: item.id, decision: d.decision, targetProductId: d.targetProductId ?? null, decidedById: ctx.userId },
  });
}

/** Chooses which imported version of a duplicated dish becomes the menu dish. */
export async function chooseCanonical(ctx: TenantContext, jobId: string, mappingId: string, importedProductId: string) {
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import is closed.');
  const mapping = await db.importMapping.findFirst({ where: { id: mappingId, jobId } });
  if (!mapping || !mapping.importedProductIds.includes(importedProductId) || mapping.existingProductId) throw new UserFacingError('Invalid choice.');
  await db.$transaction(
    mapping.importedProductIds.map((id) =>
      db.importReviewDecision.upsert({
        where: { jobId_importedProductId: { jobId, importedProductId: id } },
        update: { decision: id === importedProductId ? 'CREATE' : 'MERGE_WITH_IMPORTED', isCanonical: id === importedProductId, mergeGroupKey: mapping.id, decidedById: ctx.userId },
        create: { jobId, importedProductId: id, decision: id === importedProductId ? 'CREATE' : 'MERGE_WITH_IMPORTED', isCanonical: id === importedProductId, mergeGroupKey: mapping.id, decidedById: ctx.userId },
      }),
    ),
  );
}

/** Everything the review screen shows: before/after counts, warnings, duplicates, translations. */
export async function getImportPreview(ctx: TenantContext, jobId: string) {
  const job = await ownedJob(ctx, jobId);
  const [sources, products, mappings, decisions, org, existingCategories, existingProducts, glovoLocation] = await Promise.all([
    db.importSource.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } }),
    db.importedProduct.findMany({ where: { jobId }, orderBy: [{ sourceId: 'asc' }, { rowNumber: 'asc' }], include: { source: { select: { type: true } } } }),
    db.importMapping.findMany({ where: { jobId } }),
    db.importReviewDecision.findMany({ where: { jobId } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } }),
    db.categoryTranslation.findMany({ where: { category: { organizationId: ctx.org.id }, language: job.sourceLanguage }, select: { name: true, category: { select: { id: true, defaultStationId: true } } } }),
    db.menuProduct.findMany({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } }, select: { id: true, translations: { where: { language: job.sourceLanguage }, select: { name: true } } } }),
    // The Glovo link the owner already saved under Settings → Channels, offered as a starting point.
    db.restaurantLocation.findFirst({ where: { organizationId: ctx.org.id, glovoUrl: { not: null } }, select: { glovoUrl: true } }),
  ]);
  const dec = new Map(decisions.map((d) => [d.importedProductId, d]));
  const toCreate = products.filter((p) => dec.get(p.id)?.decision === 'CREATE');
  const existingCats = new Set(existingCategories.map((c) => normalizeName(c.name)));
  const importedCats = [...new Set(products.map((p) => p.categoryName).filter((c): c is string => !!c))];
  const newCats = [...new Set(toCreate.map((p) => p.categoryName ?? 'Imported'))].filter((c) => !existingCats.has(normalizeName(c)));
  const otherLanguages = org.enabledLanguages.filter((l) => l !== job.sourceLanguage);
  const stations = await activeStations(ctx);
  return {
    job,
    stations,
    /** Categories that will receive new dishes but have no preparation station yet (new or existing). */
    stationTargets: stationTargets(toCreate, existingCategories),
    sources,
    products: products.map((p) => ({ ...p, decision: dec.get(p.id) ?? null })),
    mappings,
    glovoUrl: glovoLocation?.glovoUrl ?? null,
    /** Suggestions for the category box in the inline editor: existing menu + extracted names. */
    categoryOptions: [...new Set([...existingCategories.map((c) => c.name), ...importedCats])].sort((a, b) => a.localeCompare(b)),
    existingProducts: existingProducts.map((p) => ({ id: p.id, name: p.translations[0]?.name ?? '(no name)' })),
    summary: {
      items: products.length,
      categories: importedCats.length,
      images: products.filter((p) => p.imageUrl).length,
      missingPrice: products.filter((p) => p.priceCents === null).length,
      missingCategory: products.filter((p) => !p.categoryName).length,
      missingDescription: products.filter((p) => !p.description).length,
      duplicateGroups: mappings.filter((m) => !m.existingProductId).length,
      existingMatches: mappings.filter((m) => m.existingProductId).length,
      warnings: products.reduce((n, p) => n + p.warnings.length, 0),
      withSizes: products.filter((p) => Array.isArray(p.variants) && p.variants.length > 0).length,
      withExtras: products.filter((p) => Array.isArray(p.modifiers) && p.modifiers.length > 0).length,
      extraGroups: products.reduce((n, p) => n + (Array.isArray(p.modifiers) ? p.modifiers.length : 0), 0),
      soldOut: products.filter((p) => p.available === false).length,
      before: { products: existingProducts.length, categories: existingCategories.length },
      after: { products: existingProducts.length + toCreate.length, categories: existingCategories.length + newCats.length, newCategories: newCats },
      toCreate: toCreate.length,
      skipped: decisions.filter((d) => d.decision === 'SKIP').length,
      merged: decisions.filter((d) => d.decision === 'MERGE_WITH_IMPORTED' || d.decision === 'MERGE_INTO_EXISTING').length,
      translationRequired: otherLanguages.length ? toCreate.length * otherLanguages.length : 0,
      otherLanguages,
    },
  };
}

/**
 * Turns captured option groups into valid ModifierGroup rows. Sources state selection limits
 * loosely or not at all, so limits are clamped to something the order form can satisfy:
 * at most one choice unless the source says more, and never a minimum above the maximum.
 */
function normalizeModifierGroups(raw: unknown): { name: string; minSelect: number; maxSelect: number; options: { name: string; priceDeltaCents: number; available?: boolean }[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((g) => {
      if (!g || typeof g !== 'object') return [];
      const group = g as { name?: unknown; minSelect?: unknown; maxSelect?: unknown; options?: unknown };
      const name = typeof group.name === 'string' ? group.name.trim().slice(0, 120) : '';
      const options = (Array.isArray(group.options) ? group.options : [])
        .flatMap((o) => {
          if (!o || typeof o !== 'object') return [];
          const opt = o as { name?: unknown; priceDeltaCents?: unknown; available?: unknown };
          const optName = typeof opt.name === 'string' ? opt.name.trim().slice(0, 120) : '';
          if (!optName) return [];
          const delta = typeof opt.priceDeltaCents === 'number' && Number.isSafeInteger(opt.priceDeltaCents) ? opt.priceDeltaCents : 0;
          return [{ name: optName, priceDeltaCents: Math.max(0, delta), available: typeof opt.available === 'boolean' ? opt.available : undefined }];
        })
        .slice(0, 50);
      if (!name || !options.length) return [];
      const max = Math.min(Math.max(Number.isInteger(group.maxSelect) ? (group.maxSelect as number) : 1, 1), options.length);
      const min = Math.min(Math.max(Number.isInteger(group.minSelect) ? (group.minSelect as number) : 0, 0), max);
      return [{ name, minSelect: min, maxSelect: max, options }];
    })
    .slice(0, 20);
}

export const updateImportedProductSchema = z.object({
  importedProductId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  description: z.string().trim().max(1000).optional(),
  categoryName: z.string().trim().max(120).optional(),
  /** Empty clears the price, so the dish is published as a draft for the owner to price. */
  price: z.string().trim().max(20).optional(),
});

/**
 * Corrects one extracted item before publishing. Only the review copy is touched: the menu is
 * untouched until publish, and the original extraction stays in `raw` for reference.
 */
export async function updateImportedProduct(ctx: TenantContext, jobId: string, input: unknown) {
  const d = updateImportedProductSchema.parse(input);
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import is closed.');
  const item = await db.importedProduct.findFirst({ where: { id: d.importedProductId, jobId } });
  if (!item) throw new UserFacingError('Item not found.', 404);
  let priceCents: number | null = null;
  if (d.price) {
    priceCents = parseMoneyToCents(d.price);
    if (priceCents === null) throw new UserFacingError(`“${d.price}” is not a valid price. Use a format like 16,90.`);
  }
  // Warnings that the edit has just resolved must not stay on the review screen.
  const resolved = (w: string) => !(priceCents !== null && /price/i.test(w)) && !(d.categoryName && /category/i.test(w));
  await db.$transaction(async (tx) => {
    await tx.importedProduct.update({
      where: { id: item.id },
      data: {
        name: d.name,
        description: d.description || null,
        categoryName: d.categoryName || null,
        priceCents,
        warnings: item.warnings.filter(resolved),
      },
    });
    // A rename can make the item match a dish already on the menu: re-run the duplicate check so
    // it is protected by the same "skip by default" rule. Decisions made by a person are kept.
    if (d.name !== item.name) await recomputeSuggestions(tx, jobId, ctx.org.id);
  });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.item_edited', entityType: 'ImportJob', entityId: job.id, metadata: { importedProductId: item.id } });
}

/** True for a dish photo the restaurant uploaded into its own storage (not a platform URL). */
const isOwnPhoto = (organizationId: string, url: string | null | undefined) => !!mediaKeyFromPath(url)?.startsWith(`${organizationId}/products/`);

/** The photo address the source originally gave, kept in `raw` so it can be restored after a change. */
function sourceImageUrl(raw: unknown): string | null {
  const v = raw && typeof raw === 'object' ? (raw as { sourceImageUrl?: unknown }).sourceImageUrl : null;
  return typeof v === 'string' ? v : null;
}

/** Deletes an uploaded review photo unless a dish on the menu already uses it. */
async function discardReviewPhoto(organizationId: string, url: string | null) {
  if (isOwnPhoto(organizationId, url)) await deleteTenantMedia(organizationId, [url]);
}

/**
 * Changes the photo of one product while the import is being reviewed:
 * - `upload`: the owner's own photo replaces it (stored in the restaurant's media storage now,
 *   with the photo-rights confirmation required for every upload);
 * - `remove`: the product is saved without a photo;
 * - `restore`: back to the photo the source (e.g. Glovo) provided.
 * Only the review copy changes. A replaced upload is deleted from storage.
 */
export async function setImportedProductPhoto(ctx: TenantContext, jobId: string, importedProductId: string, change: { action: 'upload'; file: unknown; rightsConfirmed: boolean } | { action: 'remove' } | { action: 'restore' }) {
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import is closed.');
  const item = await db.importedProduct.findFirst({ where: { id: importedProductId, jobId }, select: { id: true, imageUrl: true, raw: true } });
  if (!item) throw new UserFacingError('Item not found.', 404);
  // The first change remembers what the source provided, so "restore" always has something to go back to.
  const original = item.raw && typeof item.raw === 'object' && 'sourceImageUrl' in item.raw ? sourceImageUrl(item.raw) : isOwnPhoto(ctx.org.id, item.imageUrl) ? null : item.imageUrl;
  const raw = { ...(item.raw && typeof item.raw === 'object' ? (item.raw as Record<string, unknown>) : {}), sourceImageUrl: original };

  let next: string | null;
  if (change.action === 'upload') {
    if (!(change.file instanceof File) || change.file.size === 0) throw new UserFacingError('Please choose a photo.');
    if (!change.rightsConfirmed) throw new UserFacingError('Please confirm you have the right to publish this photo.');
    next = await storeTenantImage(ctx.org.id, change.file, 'products');
  } else if (change.action === 'restore') {
    if (!original) throw new UserFacingError('The source did not provide a photo for this product.');
    next = original;
  } else next = null;

  try {
    // Conditional update: two quick changes cannot both win and leave a file nobody references.
    const res = await db.importedProduct.updateMany({ where: { id: item.id, imageUrl: item.imageUrl }, data: { imageUrl: next, raw } });
    if (res.count !== 1) throw new UserFacingError('This photo was just changed elsewhere. Reload the page and try again.', 409);
  } catch (e) {
    if (change.action === 'upload') await deleteTenantMedia(ctx.org.id, [next], { force: true });
    throw e;
  }
  if (item.imageUrl !== next) await discardReviewPhoto(ctx.org.id, item.imageUrl);
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.photo_changed', entityType: 'ImportJob', entityId: job.id, metadata: { importedProductId: item.id, change: change.action } });
  return { imageUrl: next, sourceImageUrl: original };
}

const idsSchema = z.array(z.string().min(1).max(40)).min(1, 'Select at least one product.').max(MAX_IMPORT_ITEMS);

export const bulkUpdateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('include'), ids: idsSchema }),
  z.object({ action: z.literal('skip'), ids: idsSchema }),
  z.object({ action: z.literal('category'), ids: idsSchema, categoryName: z.string().trim().min(1, 'Enter a category.').max(120) }),
]);

/**
 * Review actions on many products at once: import them, skip them, or move them to another
 * category. Same rules as editing one product: only the review copy changes, and only while
 * the import is waiting for review. Decisions taken here are kept when suggestions are rebuilt.
 */
export async function bulkUpdateImportedProducts(ctx: TenantContext, jobId: string, input: unknown) {
  const d = bulkUpdateSchema.parse(input);
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import is closed.');
  const ids = [...new Set(d.ids)];
  const items = await db.importedProduct.findMany({ where: { jobId, id: { in: ids } }, select: { id: true, warnings: true } });
  if (items.length !== ids.length) throw new UserFacingError('Some products were not found in this import.', 404);
  if (d.action === 'category') {
    await db.$transaction(
      items.map((it) => db.importedProduct.update({ where: { id: it.id }, data: { categoryName: d.categoryName, warnings: it.warnings.filter((w) => !/category/i.test(w)) } })),
    );
  } else {
    const decision = d.action === 'include' ? 'CREATE' : 'SKIP';
    const current = new Map((await db.importReviewDecision.findMany({ where: { jobId, importedProductId: { in: ids } } })).map((c) => [c.importedProductId, c]));
    await db.$transaction(
      ids.map((id) =>
        db.importReviewDecision.upsert({
          where: { jobId_importedProductId: { jobId, importedProductId: id } },
          update: { decision, decidedById: ctx.userId, isCanonical: decision === 'CREATE' && !!current.get(id)?.isCanonical },
          create: { jobId, importedProductId: id, decision, decidedById: ctx.userId },
        }),
      ),
    );
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.bulk_updated', entityType: 'ImportJob', entityId: job.id, metadata: { action: d.action, count: ids.length } });
  return { updated: ids.length };
}

export const publishSchema = z.object({
  confirm: z.literal(true),
  makeVisible: z.boolean().default(false),
  imageRights: z.boolean().default(false),
  /** Preparation station per category name: a station id, or NO_STATION (served without a kitchen ticket). */
  stations: z.record(z.string().max(200), z.string().max(40)).default({}),
});
export const NO_STATION = 'NO_STATION';

async function activeStations(ctx: TenantContext, tx: Tx | typeof db = db) {
  return tx.kitchenStation.findMany({ where: { organizationId: ctx.org.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, type: true } });
}

type CatRow = { name: string; category: { id: string; defaultStationId: string | null } };
/** Category labels (as they will appear on the menu) that get new dishes and have no station. */
function stationTargets(toCreate: { categoryName: string | null }[], existing: CatRow[]) {
  const byName = new Map(existing.map((c) => [normalizeName(c.name), c]));
  const labels = [...new Set(toCreate.map((p) => p.categoryName?.trim() || 'Imported'))];
  return labels
    .map((label) => ({ label, existing: byName.get(normalizeName(label)) ?? null }))
    .filter((t) => !t.existing?.category.defaultStationId)
    .map((t) => ({ label: t.label, isNew: !t.existing }));
}

/**
 * Publishes reviewed decisions in ONE transaction. Rules:
 * - new dishes are created; existing dishes are never overwritten,
 * - restaurant-owned sources (CSV/Excel/PDF/text) may set the dine-in price,
 * - Glovo/Uber prices are stored only as reference prices (ExternalSourcePrice),
 * - dishes become visible only if the owner asked for it AND they have a dine-in price,
 * - allergens are never imported as verified; images only with confirmed rights.
 */
export async function publishImport(ctx: TenantContext, jobId: string, input: unknown) {
  await assertModule(ctx.org.id, 'import');
  const opts = publishSchema.parse(input);
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import cannot be published (it is not waiting for review).');
  // Imported dishes must not silently miss the Kitchen/Café displays (audit GAP-01): every category
  // without a station needs an explicit choice — a station, or "no preparation station".
  const preview = await getImportPreview(ctx, jobId);
  const stationIds = new Set(preview.stations.map((st) => st.id));
  const stationFor = new Map<string, string | null>();
  const missing: string[] = [];
  for (const t of preview.stationTargets) {
    const choice = opts.stations[t.label];
    if (choice === NO_STATION) stationFor.set(normalizeName(t.label), null);
    else if (choice && stationIds.has(choice)) stationFor.set(normalizeName(t.label), choice);
    else if (choice) throw new UserFacingError('Choose a valid preparation station.');
    else if (preview.stations.length > 0) missing.push(t.label);
  }
  if (missing.length) throw new UserFacingError(`Choose a preparation station (Kitchen, Café…) for: ${missing.join(', ')}.`);
  const images: { productId: string; url: string }[] = [];
  const result = await db.$transaction(
    async (tx) => {
      const lock = await tx.importJob.updateMany({ where: { id: job.id, status: 'NEEDS_REVIEW' }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: ctx.userId } });
      if (lock.count !== 1) throw new UserFacingError('This import was already published.');
      const lang = job.sourceLanguage as LanguageCode;
      const products = await tx.importedProduct.findMany({ where: { jobId }, include: { source: true, decisions: true }, orderBy: [{ sourceId: 'asc' }, { rowNumber: 'asc' }] });
      const creates = products.filter((p) => p.decisions[0]?.decision === 'CREATE');
      const merges = products.filter((p) => ['MERGE_WITH_IMPORTED', 'MERGE_INTO_EXISTING'].includes(p.decisions[0]?.decision ?? ''));
      if (creates.length + merges.length === 0) throw new UserFacingError('Nothing to publish: every item is skipped.');
      await assertMenuItemCapacity(ctx.org.id, creates.length, tx);

      const menu = (await tx.menu.findFirst({ where: { organizationId: ctx.org.id, isActive: true }, orderBy: { createdAt: 'asc' } })) ?? (await tx.menu.create({ data: { organizationId: ctx.org.id, name: 'Menu' } }));
      const cats = await tx.menuCategory.findMany({ where: { organizationId: ctx.org.id }, include: { translations: { where: { language: lang } } } });
      const catByName = new Map(cats.filter((c) => c.translations[0]).map((c) => [normalizeName(c.translations[0].name), c.id]));
      // Existing categories without a station get the station chosen in review.
      for (const c of cats) {
        const key = c.translations[0] ? normalizeName(c.translations[0].name) : null;
        const chosen = key ? stationFor.get(key) : undefined;
        if (chosen && !c.defaultStationId) await tx.menuCategory.update({ where: { id: c.id }, data: { defaultStationId: chosen } });
      }
      let catOrder = cats.reduce((m, c) => Math.max(m, c.sortOrder), 0);
      const categoryFor = async (name: string | null) => {
        const label = name?.trim() || 'Imported';
        const key = normalizeName(label);
        if (catByName.has(key)) return catByName.get(key)!;
        const c = await tx.menuCategory.create({ data: { organizationId: ctx.org.id, menuId: menu.id, sortOrder: ++catOrder, defaultStationId: stationFor.get(key) ?? null, translations: { create: { language: lang, name: label, status: 'SOURCE' } } } });
        catByName.set(key, c.id);
        return c.id;
      };

      const created: string[] = [];
      const groupProduct = new Map<string, string>();
      let visible = 0;
      let modifierGroups = 0;
      let ownPhotos = 0;
      for (const p of creates) {
        const own = !isPlatform(p.source.type);
        const dineIn = own && p.priceCents !== null ? p.priceCents : null;
        const status = opts.makeVisible && dineIn !== null && p.available !== false ? 'ACTIVE' : 'DRAFT';
        if (status === 'ACTIVE') visible++;
        const variants = ((p.variants as { name: string; priceCents?: number }[] | null) ?? []).filter((v) => v.name);
        // Sizes keep absolute prices in the source; MenuNiva stores a delta from the base price.
        // Platform prices are references only, so their sizes carry no in-house price either.
        const groups = normalizeModifierGroups(p.modifiers);
        const product = await tx.menuProduct.create({
          data: {
            organizationId: ctx.org.id,
            menuId: menu.id,
            categoryId: await categoryFor(p.categoryName),
            status,
            // Sold out on the source platform stays sold out here until staff say otherwise.
            soldOut: p.available === false,
            origin: 'IMPORTED',
            sortOrder: (p.rowNumber ?? created.length) + 1,
            translations: { create: { language: lang, name: p.name, description: p.description, status: 'SOURCE' } },
            prices: dineIn !== null ? { create: { channel: 'DINE_IN', amountCents: dineIn } } : undefined,
            externalPrices: !own && p.priceCents !== null ? { create: { provider: p.source.type, amountCents: p.priceCents, externalId: p.externalId } } : undefined,
            variants: variants.length
              ? { create: variants.map((v, i) => ({ names: { [lang]: v.name }, priceDeltaCents: own && v.priceCents !== undefined && p.priceCents !== null ? v.priceCents - p.priceCents : 0, isDefault: i === 0, sortOrder: i })) }
              : undefined,
            modifierGroups: groups.length
              ? {
                  create: groups.map((g, gi) => ({
                    names: { [lang]: g.name },
                    minSelect: g.minSelect,
                    maxSelect: g.maxSelect,
                    sortOrder: gi,
                    // A surcharge only becomes a real surcharge when the price is ours to charge.
                    options: { create: g.options.map((o, oi) => ({ names: { [lang]: o.name }, priceDeltaCents: own ? o.priceDeltaCents : 0, isAvailable: o.available !== false, sortOrder: oi })) },
                  })),
                }
              : undefined,
          },
        });
        modifierGroups += groups.length;
        created.push(product.id);
        if (p.decisions[0].mergeGroupKey) groupProduct.set(p.decisions[0].mergeGroupKey, product.id);
        if (isOwnPhoto(ctx.org.id, p.imageUrl)) {
          // A photo the owner uploaded during review: rights were confirmed at upload and the file
          // is already in the restaurant's storage, so it is attached directly.
          await tx.productImage.create({ data: { productId: product.id, url: p.imageUrl!, rightsConfirmed: true, origin: 'MANUAL' } });
          ownPhotos++;
        } else if (p.imageUrl && opts.imageRights) images.push({ productId: product.id, url: p.imageUrl });
      }
      let linkedPrices = 0;
      for (const p of merges) {
        const d = p.decisions[0];
        const target = d.decision === 'MERGE_INTO_EXISTING' ? d.targetProductId : d.mergeGroupKey ? groupProduct.get(d.mergeGroupKey) : null;
        if (!target) continue;
        if (d.decision === 'MERGE_INTO_EXISTING') {
          const ok = await tx.menuProduct.findFirst({ where: { id: target, organizationId: ctx.org.id }, select: { id: true } });
          if (!ok) continue;
        }
        if (isPlatform(p.source.type) && p.priceCents !== null) {
          await tx.externalSourcePrice.upsert({
            where: { productId_provider: { productId: target, provider: p.source.type } },
            update: { amountCents: p.priceCents, externalId: p.externalId, capturedAt: new Date() },
            create: { productId: target, provider: p.source.type, amountCents: p.priceCents, externalId: p.externalId },
          });
          linkedPrices++;
        }
      }
      const unrouted = await tx.menuProduct.count({ where: { id: { in: created }, stationId: null, category: { defaultStationId: null } } });
      const summary = { created: created.length, visible, drafts: created.length - visible, linkedPrices, modifierGroups, skipped: products.length - creates.length - merges.length, imagesRequested: images.length, ownPhotos, withoutStation: unrouted };
      await tx.importJob.update({ where: { id: job.id }, data: { createdProductIds: created, summary } });
      await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.published', entityType: 'ImportJob', entityId: job.id, metadata: summary }, tx);
      return summary;
    },
    { timeout: 60_000 },
  );

  // Images are copied after the commit (network calls never run inside a DB transaction).
  const { saved: imagesSaved } = await copyImportedImages(ctx.org.id, images);
  if (images.length) await db.importJob.update({ where: { id: job.id }, data: { summary: { ...result, imagesSaved } } });
  // Photos uploaded during review for products that did not become a dish (skipped or merged)
  // are not used anywhere. deleteTenantMedia keeps any file a dish still references.
  const unused = (await db.importedProduct.findMany({ where: { jobId: job.id, decisions: { none: { decision: 'CREATE' } } }, select: { imageUrl: true } })).map((p) => p.imageUrl).filter((u) => isOwnPhoto(ctx.org.id, u));
  if (unused.length) await deleteTenantMedia(ctx.org.id, unused);
  return { ...result, imagesSaved };
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Downloads one image. Separate so tests can exercise the storage path without the network. */
export type ImageFetcher = (url: string) => Promise<{ status: number; body: Buffer }>;

/**
 * Copies photos found in an import into the tenant's own media storage (Supabase Storage in
 * production, local files in development), and records them against their dish.
 *
 * Only called after the owner has confirmed they may publish the photos. Every file is checked:
 * https only, SSRF-guarded fetch, size-capped, and identified by its magic bytes rather than by
 * its URL or the server's content type — so a mislabelled or hostile file is refused. A photo
 * that cannot be fetched is skipped and counted; the dish is still created without it.
 */
/** Width stored for imported photos: sharp on phones, a fraction of the original's weight. */
const STORED_IMAGE_WIDTH = 1000;
/** Photos copied at the same time: 73 photos take seconds instead of most of a minute. */
const IMAGE_COPY_CONCURRENCY = 6;

export async function copyImportedImages(
  organizationId: string,
  images: { productId: string; url: string }[],
  fetchImage: ImageFetcher = (url) => safeFetch(url, { maxBytes: MAX_IMAGE_BYTES, accept: 'image/jpeg,image/png,image/webp' }),
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  const copyOne = async (img: { productId: string; url: string }) => {
    let stored: string | null = null;
    try {
      // Resizing CDNs (Glovo's) are asked for a sensible width; other hosts are fetched as is.
      const url = sizedImageUrl(img.url, STORED_IMAGE_WIDTH);
      if (!url) return;
      const res = await fetchImage(url);
      const kind = res.status === 200 ? sniffImage(res.body) : null;
      if (!kind || res.body.length > MAX_IMAGE_BYTES || (await isOversizedPicture(res.body))) return;
      const key = `${organizationId}/products/${newPublicToken()}.${kind.ext}`;
      await storage.put(key, res.body, kind.contentType);
      stored = `/media/${key}`;
      await db.productImage.create({ data: { productId: img.productId, url: stored, rightsConfirmed: true, origin: 'IMPORTED' } });
      saved++;
    } catch {
      // Skipped images are reported in the summary; the dish is still created.
      if (stored) await deleteTenantMedia(organizationId, [stored], { force: true });
    }
  };
  const queue = [...images];
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_COPY_CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await copyOne(next);
    }),
  );
  return { saved, skipped: images.length - saved };
}

/** Cancels an unpublished import and deletes its extracted rows. Published imports cannot be cancelled. */
export async function cancelImport(ctx: TenantContext, jobId: string) {
  const job = await ownedJob(ctx, jobId);
  const res = await db.importJob.updateMany({ where: { id: job.id, status: { in: ['DRAFT', 'NEEDS_REVIEW'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  if (res.count !== 1) throw new UserFacingError('Only unpublished imports can be cancelled.');
  // Photos the owner uploaded during this review are deleted with it.
  const uploaded = (await db.importedProduct.findMany({ where: { jobId: job.id }, select: { imageUrl: true } })).map((p) => p.imageUrl).filter((u) => isOwnPhoto(ctx.org.id, u));
  await db.importedProduct.deleteMany({ where: { jobId: job.id } });
  if (uploaded.length) await deleteTenantMedia(ctx.org.id, uploaded);
  await db.importMapping.deleteMany({ where: { jobId: job.id } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.cancelled', entityType: 'ImportJob', entityId: job.id });
}

export async function listImportJobs(ctx: TenantContext) {
  return db.importJob.findMany({
    where: { organizationId: ctx.org.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { sources: { select: { type: true, status: true, url: true, fileName: true } }, _count: { select: { products: true } } },
  });
}

/** The Glovo link saved under Settings → Channels, offered as the starting point of an import. */
export async function savedGlovoUrl(ctx: TenantContext): Promise<string | null> {
  const loc = await db.restaurantLocation.findFirst({ where: { organizationId: ctx.org.id, glovoUrl: { not: null } }, select: { glovoUrl: true } });
  return loc?.glovoUrl ?? null;
}

export function adapterStatuses() {
  return (Object.keys(ADAPTERS) as (keyof typeof ADAPTERS)[]).map((k) => ({ type: k, label: ADAPTERS[k].label, ...ADAPTERS[k].connectionStatus() }));
}

export const IMPORT_LANGUAGES = LANGUAGES;
