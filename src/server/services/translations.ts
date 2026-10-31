import 'server-only';
import { z } from 'zod';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import type { TenantContext } from '../tenant';
import { getTranslationProvider } from '../translation';

export type TranslationCell = { name: string; description: string | null; status: 'SOURCE' | 'MACHINE' | 'REVIEWED' } | null;

export type TranslationGridRow = { kind: 'category' | 'product'; id: string; sourceName: string; cells: Record<LanguageCode, TranslationCell> };

export const gridQuerySchema = z.object({
  /** `missing` = no translation yet, `machine` = waiting for review, `done` = all reviewed. */
  filter: z.enum(['all', 'missing', 'machine', 'done']).default('all'),
  language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]).optional(),
  query: z.string().trim().max(80).default(''),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(5).max(100).default(25),
});

/**
 * Grid of active categories/products × enabled languages for the translation editor.
 *
 * Counts always cover the whole menu, while the returned rows are filtered and paginated: a
 * menu with hundreds of dishes must not render hundreds of editors in one page.
 */
export async function getTranslationGrid(ctx: TenantContext, input: unknown = {}) {
  const q = gridQuerySchema.parse(input);
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } });
  const [categories, products] = await Promise.all([
    db.menuCategory.findMany({ where: { organizationId: ctx.org.id }, orderBy: { sortOrder: 'asc' }, include: { translations: true } }),
    db.menuProduct.findMany({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } }, orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }], include: { translations: true } }),
  ]);
  const targets = org.enabledLanguages.filter((l) => l !== org.sourceLanguage);
  const toRow = (kind: 'category' | 'product', id: string, translations: { language: LanguageCode; name: string; description: string | null; status: 'SOURCE' | 'MACHINE' | 'REVIEWED' }[]): TranslationGridRow => ({
    kind,
    id,
    sourceName: translations.find((t) => t.language === org.sourceLanguage)?.name ?? '',
    cells: Object.fromEntries(org.enabledLanguages.map((l) => [l, translations.find((t) => t.language === l) ?? null])) as Record<LanguageCode, TranslationCell>,
  });
  const all = [...categories.map((c) => toRow('category', c.id, c.translations)), ...products.map((p) => toRow('product', p.id, p.translations))];

  // Counts ignore the source language: a missing source name is a menu problem, not a translation one.
  let missing = 0;
  let unreviewed = 0;
  for (const r of all)
    for (const l of targets) {
      const c = r.cells[l];
      if (!c) missing++;
      else if (c.status === 'MACHINE') unreviewed++;
    }

  const langs = q.language ? [q.language] : targets;
  const needle = q.query.toLowerCase();
  const matches = (r: TranslationGridRow) => {
    if (needle && !r.sourceName.toLowerCase().includes(needle) && !langs.some((l) => r.cells[l]?.name.toLowerCase().includes(needle))) return false;
    if (q.filter === 'missing') return langs.some((l) => !r.cells[l]);
    if (q.filter === 'machine') return langs.some((l) => r.cells[l]?.status === 'MACHINE');
    if (q.filter === 'done') return langs.every((l) => r.cells[l] && r.cells[l]!.status !== 'MACHINE');
    return true;
  };
  const filtered = all.filter(matches);
  const pages = Math.max(1, Math.ceil(filtered.length / q.perPage));
  const page = Math.min(q.page, pages);
  const provider = getTranslationProvider();
  return {
    org,
    targets,
    rows: filtered.slice((page - 1) * q.perPage, page * q.perPage),
    total: all.length,
    matched: filtered.length,
    page,
    pages,
    query: q,
    missing,
    unreviewed,
    provider: { id: provider.id, label: provider.label, configured: provider.isConfigured() },
  };
}

export const saveTranslationInput = z.object({
  kind: z.enum(['category', 'product']),
  id: z.string().min(1),
  language: z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]),
  name: z.string().trim().max(120),
  description: z.string().trim().max(1000).optional(),
});

/** Manual edit by staff → REVIEWED (or SOURCE in the source language). Empty name removes the translation. */
export async function saveTranslation(ctx: TenantContext, input: unknown) {
  const d = saveTranslationInput.parse(input);
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true } });
  const status = d.language === org.sourceLanguage ? 'SOURCE' : 'REVIEWED';
  if (d.kind === 'category') {
    const c = await db.menuCategory.findFirst({ where: { id: d.id, organizationId: ctx.org.id } });
    if (!c) throw new UserFacingError('Not found.', 404);
    if (!d.name) {
      if (d.language === org.sourceLanguage) throw new UserFacingError('The source-language name cannot be empty.');
      await db.categoryTranslation.deleteMany({ where: { categoryId: c.id, language: d.language } });
    } else
      await db.categoryTranslation.upsert({
        where: { categoryId_language: { categoryId: c.id, language: d.language } },
        update: { name: d.name, description: d.description || null, status },
        create: { categoryId: c.id, language: d.language, name: d.name, description: d.description || null, status },
      });
  } else {
    const p = await db.menuProduct.findFirst({ where: { id: d.id, organizationId: ctx.org.id } });
    if (!p) throw new UserFacingError('Not found.', 404);
    if (!d.name) {
      if (d.language === org.sourceLanguage) throw new UserFacingError('The source-language name cannot be empty.');
      await db.productTranslation.deleteMany({ where: { productId: p.id, language: d.language } });
    } else
      await db.productTranslation.upsert({
        where: { productId_language: { productId: p.id, language: d.language } },
        update: { name: d.name, description: d.description || null, status },
        create: { productId: p.id, language: d.language, name: d.name, description: d.description || null, status },
      });
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.translation_saved', entityType: d.kind, entityId: d.id, metadata: { language: d.language, status } });
}

/** Marks a MACHINE translation as REVIEWED without changes. */
export async function approveTranslation(ctx: TenantContext, kind: 'category' | 'product', id: string, language: LanguageCode) {
  if (kind === 'category') {
    const r = await db.categoryTranslation.updateMany({ where: { categoryId: id, language, category: { organizationId: ctx.org.id }, status: 'MACHINE' }, data: { status: 'REVIEWED' } });
    if (!r.count) throw new UserFacingError('Nothing to approve.');
  } else {
    const r = await db.productTranslation.updateMany({ where: { productId: id, language, product: { organizationId: ctx.org.id }, status: 'MACHINE' }, data: { status: 'REVIEWED' } });
    if (!r.count) throw new UserFacingError('Nothing to approve.');
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.translation_approved', entityType: kind, entityId: id, metadata: { language } });
}

export { bulkTranslateMissing } from './ai-translate';
