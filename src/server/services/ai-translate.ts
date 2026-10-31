import 'server-only';
import { z } from 'zod';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertModule } from '../modules';
import { rateLimit } from '../rate-limit';
import type { TenantContext } from '../tenant';
import { getTranslationProvider, TranslationUnavailableError, type TranslationProvider } from '../translation';
import { modelPrice, OpenRouterProvider } from '../translation/openrouter';

/**
 * Bulk menu translation (categories and dishes) into the restaurant's enabled languages.
 *
 * Guarantees, in order of importance:
 * - The source language is never written to and never overwritten. Only languages that have no
 *   row at all are filled, so staff edits and approved translations survive every run.
 * - Everything written is MACHINE, which `pickTranslation` in public-menu.ts hides from guests
 *   until someone approves it. Nothing reaches a guest unreviewed.
 * - Ingredients and allergens are never sent to a provider and never written here.
 * - Work is done in bounded passes so a long menu makes progress instead of timing out, and a
 *   failed batch leaves its items missing — the next pass retries exactly those.
 */

/** Items per request. Keeps one answer well inside the model's output budget. */
export const BATCH_ITEMS = 20;
/** Cells handled by one pass, so a request finishes long before any serverless timeout. */
export const DEFAULT_PASS_LIMIT = 120;
/** Provider requests per hour per restaurant. Translating is billed, so it is capped. */
export const REQUESTS_PER_HOUR = 200;
/** Longest machine translation we store for a name. */
const MAX_NAME = 300;
const MAX_DESCRIPTION = 1000;

export type TranslationUnit = {
  kind: 'category' | 'product';
  id: string;
  /** Source-language name, shown in the review list and used as the translation input. */
  name: string;
  description: string | null;
  /** Enabled languages that have no translation row yet. */
  missing: LanguageCode[];
};

export type TranslationPlan = {
  sourceLanguage: LanguageCode;
  targets: LanguageCode[];
  units: TranslationUnit[];
  /** Missing (row, language) pairs — the real amount of work. */
  cells: number;
  requests: number;
  characters: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  provider: { id: string; label: string; configured: boolean; model: string | null; isAi: boolean };
  cost: { inputPerMillionUsd: number; outputPerMillionUsd: number; estimatedUsd: number } | null;
  unreviewed: number;
};

/** Rough token estimate. Menu text is short and mixed-script, so ~3 characters per token. */
const CHARS_PER_TOKEN = 3;
/** Instructions and JSON scaffolding sent with every request. */
const OVERHEAD_TOKENS_PER_REQUEST = 320;

export function estimateTokens(characters: number, requests: number) {
  const text = Math.ceil(characters / CHARS_PER_TOKEN);
  return {
    // Input carries the instructions once per request plus the source text.
    estimatedInputTokens: text + requests * OVERHEAD_TOKENS_PER_REQUEST,
    // Output is the translated text plus the small JSON envelope.
    estimatedOutputTokens: Math.ceil(text * 1.15) + requests * 30,
  };
}

async function orgLanguages(organizationId: string) {
  return db.restaurantOrganization.findUniqueOrThrow({ where: { id: organizationId }, select: { sourceLanguage: true, enabledLanguages: true } });
}

/**
 * Everything the owner needs to decide before spending money: what is missing, how many
 * requests it takes and what the model's published price makes that cost.
 */
export async function translationPlan(ctx: TenantContext, fetchImpl?: typeof fetch): Promise<TranslationPlan> {
  const org = await orgLanguages(ctx.org.id);
  const src = org.sourceLanguage;
  const targets = org.enabledLanguages.filter((l) => l !== src);
  const [categories, products] = await Promise.all([
    db.menuCategory.findMany({ where: { organizationId: ctx.org.id, isActive: true }, orderBy: { sortOrder: 'asc' }, include: { translations: { select: { language: true, name: true, description: true, status: true } } } }),
    db.menuProduct.findMany({
      where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
      include: { translations: { select: { language: true, name: true, description: true, status: true } } },
    }),
  ]);

  const units: TranslationUnit[] = [];
  let characters = 0;
  let unreviewed = 0;
  const collect = (kind: 'category' | 'product', id: string, translations: { language: LanguageCode; name: string; description: string | null; status: string }[]) => {
    const source = translations.find((t) => t.language === src);
    for (const t of translations) if (t.status === 'MACHINE') unreviewed++;
    // Without source text there is nothing to translate from; the owner must write the dish name first.
    if (!source?.name) return;
    const have = new Set(translations.map((t) => t.language));
    const missing = targets.filter((l) => !have.has(l));
    if (missing.length === 0) return;
    // Descriptions are only translated for dishes; categories store a name only in this flow.
    const description = kind === 'product' ? source.description : null;
    characters += (source.name.length + (description?.length ?? 0)) * missing.length;
    units.push({ kind, id, name: source.name, description: description ?? null, missing });
  };
  for (const c of categories) collect('category', c.id, c.translations);
  for (const p of products) collect('product', p.id, p.translations);

  const cells = units.reduce((n, u) => n + u.missing.length, 0);
  // Batches never mix target languages: one request translates into exactly one language.
  let requests = 0;
  for (const target of targets) {
    const n = units.filter((u) => u.missing.includes(target)).length;
    requests += Math.ceil(n / BATCH_ITEMS);
  }
  const provider = getTranslationProvider();
  const isAi = provider.id === 'openrouter';
  const model = provider instanceof OpenRouterProvider ? provider.model : null;
  const { estimatedInputTokens, estimatedOutputTokens } = estimateTokens(characters, requests);
  let cost: TranslationPlan['cost'] = null;
  if (isAi && model && provider.isConfigured()) {
    const price = await modelPrice(model, fetchImpl);
    if (price) {
      cost = {
        ...price,
        estimatedUsd: (estimatedInputTokens / 1_000_000) * price.inputPerMillionUsd + (estimatedOutputTokens / 1_000_000) * price.outputPerMillionUsd,
      };
    }
  }
  return {
    sourceLanguage: src,
    targets,
    units,
    cells,
    requests,
    characters,
    estimatedInputTokens,
    estimatedOutputTokens,
    provider: { id: provider.id, label: provider.label, configured: provider.isConfigured(), model, isAi },
    cost,
    unreviewed,
  };
}

export const translateSelectionSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  /** Restricts the run to specific rows. Absent = every row with something missing. */
  only: z.array(z.object({ kind: z.enum(['category', 'product']), id: z.string().min(1) })).max(500).optional(),
  /** Restricts the run to one language. Absent = every enabled language. */
  language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]).optional(),
});

export type TranslateProgress = {
  created: number;
  failed: number;
  remaining: number;
  /** One message per failed batch, already safe to show to an owner. */
  errors: string[];
  usage: { promptTokens: number; completionTokens: number; requests: number } | null;
};

type Batch = { target: LanguageCode; units: TranslationUnit[] };

export function planBatches(units: TranslationUnit[], targets: LanguageCode[], limit: number): Batch[] {
  const batches: Batch[] = [];
  let budget = limit;
  for (const target of targets) {
    const pending = units.filter((u) => u.missing.includes(target));
    for (let i = 0; i < pending.length && budget > 0; i += BATCH_ITEMS) {
      const slice = pending.slice(i, i + Math.min(BATCH_ITEMS, budget));
      if (slice.length === 0) break;
      batches.push({ target, units: slice });
      budget -= slice.length;
    }
    if (budget <= 0) break;
  }
  return batches;
}

/** Trims a machine answer to what the column accepts, so one long answer cannot fail a batch. */
function clamp(value: string, max: number) {
  const t = value.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Translates up to `limit` missing cells and reports what is left, so the caller can show real
 * progress and keep going. Safe to call repeatedly: finished cells are skipped, failed ones are
 * retried.
 */
export async function translateMissing(ctx: TenantContext, input: unknown = {}, providerOverride?: TranslationProvider): Promise<TranslateProgress> {
  await assertModule(ctx.org.id, 'translations');
  const opts = translateSelectionSchema.parse(input);
  const provider = providerOverride ?? getTranslationProvider();
  if (!provider.isConfigured()) throw new UserFacingError('No translation provider is configured. Use the manual editor below, or set OPENROUTER_API_KEY.');

  const plan = await translationPlan(ctx);
  if (plan.targets.length === 0) throw new UserFacingError('Only one language is enabled. Enable more languages in Settings first.');
  const chosen = opts.only ? new Set(opts.only.map((o) => `${o.kind}:${o.id}`)) : null;
  const units = chosen ? plan.units.filter((u) => chosen.has(`${u.kind}:${u.id}`)) : plan.units;
  const targets = opts.language ? plan.targets.filter((l) => l === opts.language) : plan.targets;
  const limit = opts.limit ?? DEFAULT_PASS_LIMIT;
  const batches = planBatches(units, targets, limit);
  const totalCells = units.reduce((n, u) => n + u.missing.filter((l) => targets.includes(l)).length, 0);

  let created = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const batch of batches) {
    // Defence in depth: the source language must never be a translation target.
    if (batch.target === plan.sourceLanguage) continue;
    await rateLimit(`ai-translate:${ctx.org.id}`, REQUESTS_PER_HOUR, 3600, true);
    try {
      // One flat array per batch: [name, description, name, description, …]. Every provider in
      // this codebase accepts an array, so batching needs no provider-specific code.
      const texts = batch.units.flatMap((u) => [u.name, u.description ?? '']);
      const answers = await provider.translate(texts, plan.sourceLanguage, batch.target);
      if (answers.length !== texts.length) throw new TranslationUnavailableError(`Expected ${texts.length} translations, received ${answers.length}.`);
      const categoryRows: { categoryId: string; language: LanguageCode; name: string; description: string | null; status: 'MACHINE' }[] = [];
      const productRows: { productId: string; language: LanguageCode; name: string; description: string | null; status: 'MACHINE' }[] = [];
      for (const [i, u] of batch.units.entries()) {
        const name = clamp(answers[i * 2] ?? '', MAX_NAME);
        if (!name) throw new TranslationUnavailableError(`No translation came back for "${u.name.slice(0, 40)}".`);
        const description = u.description ? clamp(answers[i * 2 + 1] ?? '', MAX_DESCRIPTION) || null : null;
        if (u.kind === 'category') categoryRows.push({ categoryId: u.id, language: batch.target, name, description, status: 'MACHINE' });
        else productRows.push({ productId: u.id, language: batch.target, name, description, status: 'MACHINE' });
      }
      // skipDuplicates keeps a second run, or two owners pressing the button at once, from
      // colliding on (id, language) — an existing translation always wins.
      const [c, p] = await db.$transaction([
        db.categoryTranslation.createMany({ data: categoryRows, skipDuplicates: true }),
        db.productTranslation.createMany({ data: productRows, skipDuplicates: true }),
      ]);
      created += c.count + p.count;
    } catch (e) {
      failed += batch.units.length;
      const message = e instanceof TranslationUnavailableError || e instanceof UserFacingError ? e.message : 'Unexpected error while translating.';
      // One line per distinct failure: 12 identical provider errors are not 12 pieces of news.
      if (!errors.includes(message)) errors.push(message);
      if (errors.length >= 3) break;
    }
  }
  const usage = provider instanceof OpenRouterProvider ? { ...provider.usage } : null;
  if (created > 0) {
    await audit({
      organizationId: ctx.org.id,
      actorUserId: ctx.userId,
      action: 'menu.bulk_translated',
      entityType: 'Menu',
      metadata: { created, failed, provider: provider.id, ...(usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, requests: usage.requests } : {}) },
    });
  }
  return { created, failed, remaining: Math.max(0, totalCells - created), errors, usage };
}

/**
 * Bulk machine translation of everything missing, in one call. Kept for the original
 * "Translate missing" button and its contract; the progressive UI calls translateMissing
 * directly so it can show progress.
 */
export async function bulkTranslateMissing(ctx: TenantContext): Promise<{ created: number }> {
  let created = 0;
  // Several passes so a menu longer than one pass still finishes, bounded so a provider that
  // keeps failing cannot loop forever.
  for (let pass = 0; pass < 20; pass++) {
    const res = await translateMissing(ctx, { limit: DEFAULT_PASS_LIMIT });
    created += res.created;
    if (res.remaining === 0 || res.created === 0) {
      if (res.created === 0 && res.errors.length) throw new UserFacingError(`Translation provider error: ${res.errors[0]}`);
      break;
    }
  }
  return { created };
}

export const approveAllSchema = z.object({
  language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]).optional(),
  /** The owner states that they looked at the translations before approving them. */
  confirmReviewed: z.boolean(),
});

/**
 * Approves every machine translation at once (MACHINE → REVIEWED), which is what makes them
 * visible to guests. Deliberately requires an explicit confirmation: this is the moment
 * unreviewed AI text becomes public, so it is never a side effect of another action.
 */
export async function approveAllMachineTranslations(ctx: TenantContext, input: unknown): Promise<{ approved: number }> {
  const d = approveAllSchema.parse(input);
  if (!d.confirmReviewed) throw new UserFacingError('Please confirm you checked the translations before approving them.');
  const where = d.language ? { language: d.language } : {};
  const [c, p] = await db.$transaction([
    db.categoryTranslation.updateMany({ where: { ...where, status: 'MACHINE', category: { organizationId: ctx.org.id } }, data: { status: 'REVIEWED' } }),
    db.productTranslation.updateMany({ where: { ...where, status: 'MACHINE', product: { organizationId: ctx.org.id } }, data: { status: 'REVIEWED' } }),
  ]);
  const approved = c.count + p.count;
  if (approved === 0) throw new UserFacingError('There are no machine translations waiting for review.');
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.translations_approved_bulk', entityType: 'Menu', metadata: { approved, language: d.language ?? 'all' } });
  return { approved };
}

/**
 * Asks the model what language the menu is actually written in. Only ever reported to the owner
 * as a warning: the configured source language is never changed automatically, because getting
 * it wrong would mean translating from the wrong original.
 */
export async function detectMenuSourceLanguage(ctx: TenantContext, providerOverride?: TranslationProvider): Promise<{ detected: LanguageCode | null; configured: LanguageCode; agrees: boolean }> {
  await assertModule(ctx.org.id, 'translations');
  const org = await orgLanguages(ctx.org.id);
  const provider = providerOverride ?? getTranslationProvider();
  if (!(provider instanceof OpenRouterProvider) || !provider.isConfigured()) return { detected: null, configured: org.sourceLanguage, agrees: true };
  const rows = await db.productTranslation.findMany({
    where: { language: org.sourceLanguage, product: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } } },
    select: { name: true },
    take: 25,
  });
  await rateLimit(`ai-translate:${ctx.org.id}`, REQUESTS_PER_HOUR, 3600, true);
  let detected: LanguageCode | null = null;
  try {
    detected = await provider.detectLanguage(rows.map((r) => r.name));
  } catch {
    detected = null;
  }
  return { detected, configured: org.sourceLanguage, agrees: detected === null || detected === org.sourceLanguage };
}
