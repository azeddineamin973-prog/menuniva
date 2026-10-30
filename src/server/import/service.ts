import 'server-only';
import { z } from 'zod';
import type { ImportDecisionType, ImportSourceType, LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { audit } from '../audit';
import { db, type Tx } from '../db';
import { assertMenuItemCapacity } from '../services/limits';
import { assertModule } from '../modules';
import { UserFacingError } from '../errors';
import { newPublicToken } from '../crypto';
import { sniffImage, storage } from '../storage';
import type { TenantContext } from '../tenant';
import { ADAPTERS, PLATFORM_SOURCES } from './adapters';
import { DUPLICATE_THRESHOLD, groupDuplicates, normalizeName, similarity } from './dedupe';
import { safeFetch } from './safe-fetch';
import type { ParsedMenuItem } from './types';

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

/** Parses one source into the job. Nothing reaches the menu until the owner publishes. */
export async function addImportSource(ctx: TenantContext, jobId: string, input: unknown, bytes?: Uint8Array) {
  await assertModule(ctx.org.id, 'import');
  const d = addSourceSchema.parse(input);
  const job = await ownedJob(ctx, jobId);
  if (job.status !== 'DRAFT' && job.status !== 'NEEDS_REVIEW') throw new UserFacingError('This import is closed.');
  const adapter = ADAPTERS[d.type];
  const result = await adapter.parse({ text: d.text?.trim() ? d.text : undefined, url: d.url?.trim() || undefined, fileName: d.fileName, bytes });
  const conn = adapter.connectionStatus();
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
  const [sources, products, mappings, decisions, org, existingCategories, existingProducts] = await Promise.all([
    db.importSource.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } }),
    db.importedProduct.findMany({ where: { jobId }, orderBy: [{ sourceId: 'asc' }, { rowNumber: 'asc' }], include: { source: { select: { type: true } } } }),
    db.importMapping.findMany({ where: { jobId } }),
    db.importReviewDecision.findMany({ where: { jobId } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } }),
    db.categoryTranslation.findMany({ where: { category: { organizationId: ctx.org.id }, language: job.sourceLanguage }, select: { name: true, category: { select: { id: true, defaultStationId: true } } } }),
    db.menuProduct.findMany({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } }, select: { id: true, translations: { where: { language: job.sourceLanguage }, select: { name: true } } } }),
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
      for (const p of creates) {
        const own = !isPlatform(p.source.type);
        const dineIn = own && p.priceCents !== null ? p.priceCents : null;
        const status = opts.makeVisible && dineIn !== null && p.available !== false ? 'ACTIVE' : 'DRAFT';
        if (status === 'ACTIVE') visible++;
        const variants = ((p.variants as { name: string; priceCents?: number }[] | null) ?? []).filter((v) => v.name);
        const product = await tx.menuProduct.create({
          data: {
            organizationId: ctx.org.id,
            menuId: menu.id,
            categoryId: await categoryFor(p.categoryName),
            status,
            origin: 'IMPORTED',
            sortOrder: (p.rowNumber ?? created.length) + 1,
            translations: { create: { language: lang, name: p.name, description: p.description, status: 'SOURCE' } },
            prices: dineIn !== null ? { create: { channel: 'DINE_IN', amountCents: dineIn } } : undefined,
            externalPrices: !own && p.priceCents !== null ? { create: { provider: p.source.type, amountCents: p.priceCents, externalId: p.externalId } } : undefined,
            variants: variants.length
              ? { create: variants.map((v, i) => ({ names: { [lang]: v.name }, priceDeltaCents: own && v.priceCents !== undefined && p.priceCents !== null ? v.priceCents - p.priceCents : 0, isDefault: i === 0, sortOrder: i })) }
              : undefined,
          },
        });
        created.push(product.id);
        if (p.decisions[0].mergeGroupKey) groupProduct.set(p.decisions[0].mergeGroupKey, product.id);
        if (p.imageUrl && opts.imageRights) images.push({ productId: product.id, url: p.imageUrl });
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
      const summary = { created: created.length, visible, drafts: created.length - visible, linkedPrices, skipped: products.length - creates.length - merges.length, imagesRequested: images.length, withoutStation: unrouted };
      await tx.importJob.update({ where: { id: job.id }, data: { createdProductIds: created, summary } });
      await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.published', entityType: 'ImportJob', entityId: job.id, metadata: summary }, tx);
      return summary;
    },
    { timeout: 60_000 },
  );

  // Images are copied after the commit (network calls never run inside a DB transaction).
  let imagesSaved = 0;
  for (const img of images) {
    try {
      if (!/^https:\/\//.test(img.url)) continue;
      const res = await safeFetch(img.url, { maxBytes: 5 * 1024 * 1024 });
      const kind = res.status === 200 ? sniffImage(res.body) : null;
      if (!kind) continue;
      const key = `${ctx.org.id}/products/${newPublicToken()}.${kind.ext}`;
      await storage.put(key, res.body, kind.contentType);
      await db.productImage.create({ data: { productId: img.productId, url: `/media/${key}`, rightsConfirmed: true, origin: 'IMPORTED' } });
      imagesSaved++;
    } catch {
      // Skipped images are reported in the summary; the dish is still created.
    }
  }
  if (images.length) await db.importJob.update({ where: { id: job.id }, data: { summary: { ...result, imagesSaved } } });
  return { ...result, imagesSaved };
}

/** Cancels an unpublished import and deletes its extracted rows. Published imports cannot be cancelled. */
export async function cancelImport(ctx: TenantContext, jobId: string) {
  const job = await ownedJob(ctx, jobId);
  const res = await db.importJob.updateMany({ where: { id: job.id, status: { in: ['DRAFT', 'NEEDS_REVIEW'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  if (res.count !== 1) throw new UserFacingError('Only unpublished imports can be cancelled.');
  await db.importedProduct.deleteMany({ where: { jobId: job.id } });
  await db.importMapping.deleteMany({ where: { jobId: job.id } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'import.cancelled', entityType: 'ImportJob', entityId: job.id });
}

export async function listImportJobs(ctx: TenantContext) {
  return db.importJob.findMany({ where: { organizationId: ctx.org.id }, orderBy: { createdAt: 'desc' }, take: 30, include: { sources: { select: { type: true, status: true } }, _count: { select: { products: true } } } });
}

export function adapterStatuses() {
  return (Object.keys(ADAPTERS) as (keyof typeof ADAPTERS)[]).map((k) => ({ type: k, label: ADAPTERS[k].label, ...ADAPTERS[k].connectionStatus() }));
}

export const IMPORT_LANGUAGES = LANGUAGES;
