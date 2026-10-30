import 'server-only';
import { z } from 'zod';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { audit } from '../audit';
import { db } from '../db';
import { assertModule } from '../modules';
import { UserFacingError } from '../errors';
import type { TenantContext } from '../tenant';
import { getTranslationProvider, TranslationUnavailableError } from '../translation';

export type TranslationCell = { name: string; description: string | null; status: 'SOURCE' | 'MACHINE' | 'REVIEWED' } | null;

/** Grid of every active category/product × enabled language for the translation editor. */
export async function getTranslationGrid(ctx: TenantContext) {
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } });
  const [categories, products] = await Promise.all([
    db.menuCategory.findMany({ where: { organizationId: ctx.org.id }, orderBy: { sortOrder: 'asc' }, include: { translations: true } }),
    db.menuProduct.findMany({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } }, orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }], include: { translations: true } }),
  ]);
  const toRow = (kind: 'category' | 'product', id: string, translations: { language: LanguageCode; name: string; description: string | null; status: 'SOURCE' | 'MACHINE' | 'REVIEWED' }[]) => ({
    kind,
    id,
    cells: Object.fromEntries(org.enabledLanguages.map((l) => [l, translations.find((t) => t.language === l) ?? null])) as Record<LanguageCode, TranslationCell>,
  });
  const rows = [...categories.map((c) => toRow('category', c.id, c.translations)), ...products.map((p) => toRow('product', p.id, p.translations))];
  let missing = 0;
  let unreviewed = 0;
  for (const r of rows)
    for (const l of org.enabledLanguages) {
      const c = r.cells[l];
      if (!c) missing++;
      else if (c.status === 'MACHINE') unreviewed++;
    }
  return { org, rows, missing, unreviewed, provider: { id: getTranslationProvider().id, label: getTranslationProvider().label, configured: getTranslationProvider().isConfigured() } };
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

/**
 * Bulk machine translation of names/descriptions for missing languages. Only runs when a
 * provider is configured. Ingredients are deliberately excluded (safety-critical).
 */
export async function bulkTranslateMissing(ctx: TenantContext): Promise<{ created: number }> {
  await assertModule(ctx.org.id, 'translations');
  const provider = getTranslationProvider();
  if (!provider.isConfigured()) throw new UserFacingError('No translation provider is configured. Use the manual editor.');
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } });
  const src = org.sourceLanguage;
  let created = 0;
  try {
    const products = await db.menuProduct.findMany({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } }, include: { translations: true } });
    const categories = await db.menuCategory.findMany({ where: { organizationId: ctx.org.id }, include: { translations: true } });
    for (const target of org.enabledLanguages.filter((l) => l !== src)) {
      for (const p of products) {
        const source = p.translations.find((t) => t.language === src);
        if (!source || p.translations.some((t) => t.language === target)) continue;
        const [name, description] = await provider.translate([source.name, source.description ?? ''], src, target);
        await db.productTranslation.create({ data: { productId: p.id, language: target, name, description: source.description ? description : null, status: 'MACHINE' } });
        created++;
      }
      for (const c of categories) {
        const source = c.translations.find((t) => t.language === src);
        if (!source || c.translations.some((t) => t.language === target)) continue;
        const [name] = await provider.translate([source.name], src, target);
        await db.categoryTranslation.create({ data: { categoryId: c.id, language: target, name, status: 'MACHINE' } });
        created++;
      }
    }
  } catch (e) {
    if (e instanceof TranslationUnavailableError) throw new UserFacingError(`Translation provider error: ${e.message}`);
    throw e;
  }
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.bulk_translated', entityType: 'Menu', metadata: { created, provider: provider.id } });
  return { created };
}
