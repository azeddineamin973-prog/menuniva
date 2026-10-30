import 'server-only';
import { z } from 'zod';
import type { LanguageCode, PriceChannel } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { parseMoneyToCents } from '@/lib/money';
import { audit } from '../audit';
import { db, type Tx } from '../db';
import { assertMenuItemCapacity } from './limits';
import { UserFacingError } from '../errors';
import type { TenantContext } from '../tenant';

/**
 * Menu management. Every read and write is scoped by ctx.org.id; IDs coming from the browser
 * are always re-validated against the tenant before use.
 */

const LANG = z.enum(LANGUAGES as [LanguageCode, ...LanguageCode[]]);
const text = (max: number) => z.string().trim().max(max);
const translationsInput = z.partialRecord(LANG, z.object({ name: text(120).default(''), description: text(1000).default(''), ingredients: text(1000).default('') }).partial());

async function orgLanguages(organizationId: string) {
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: organizationId }, select: { sourceLanguage: true, enabledLanguages: true } });
  return org;
}

async function defaultMenuId(ctx: TenantContext, tx: Tx | typeof db = db): Promise<string> {
  const menu = await tx.menu.findFirst({ where: { organizationId: ctx.org.id, isActive: true }, orderBy: { createdAt: 'asc' } });
  if (menu) return menu.id;
  return (await tx.menu.create({ data: { organizationId: ctx.org.id, name: 'Menu' } })).id;
}

async function assertStation(ctx: TenantContext, stationId: string | null | undefined, tx: Tx | typeof db = db) {
  if (!stationId) return null;
  const s = await tx.kitchenStation.findFirst({ where: { id: stationId, organizationId: ctx.org.id } });
  if (!s) throw new UserFacingError('Invalid station.');
  return s.id;
}

async function assertProduct(ctx: TenantContext, productId: string, tx: Tx | typeof db = db) {
  const p = await tx.menuProduct.findFirst({ where: { id: productId, organizationId: ctx.org.id } });
  if (!p) throw new UserFacingError('Product not found.', 404);
  return p;
}

/** Text written by staff is SOURCE (in the source language) or REVIEWED (manual translation). */
function statusFor(lang: LanguageCode, source: LanguageCode) {
  return lang === source ? ('SOURCE' as const) : ('REVIEWED' as const);
}

// ------------------------------------------------------------------ categories

export const categoryInput = z.object({
  id: z.string().optional(),
  translations: translationsInput,
  defaultStationId: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function saveCategory(ctx: TenantContext, input: unknown) {
  const data = categoryInput.parse(input);
  const { sourceLanguage } = await orgLanguages(ctx.org.id);
  const sourceName = data.translations[sourceLanguage]?.name?.trim();
  if (!sourceName) throw new UserFacingError(`Enter the category name in the source language (${sourceLanguage}).`);
  return db.$transaction(async (tx) => {
    const stationId = await assertStation(ctx, data.defaultStationId, tx);
    let categoryId = data.id;
    if (categoryId) {
      const existing = await tx.menuCategory.findFirst({ where: { id: categoryId, organizationId: ctx.org.id } });
      if (!existing) throw new UserFacingError('Category not found.', 404);
      await tx.menuCategory.update({ where: { id: categoryId }, data: { defaultStationId: stationId, isActive: data.isActive } });
    } else {
      const menuId = await defaultMenuId(ctx, tx);
      const max = await tx.menuCategory.aggregate({ where: { organizationId: ctx.org.id, menuId }, _max: { sortOrder: true } });
      categoryId = (
        await tx.menuCategory.create({
          data: { organizationId: ctx.org.id, menuId, defaultStationId: stationId, isActive: data.isActive, sortOrder: (max._max.sortOrder ?? 0) + 1 },
        })
      ).id;
    }
    await writeCategoryTranslations(tx, categoryId, data.translations, sourceLanguage);
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: data.id ? 'menu.category_updated' : 'menu.category_created', entityType: 'MenuCategory', entityId: categoryId }, tx);
    return { id: categoryId };
  });
}

async function writeCategoryTranslations(tx: Tx, categoryId: string, translations: z.infer<typeof translationsInput>, source: LanguageCode) {
  for (const lang of LANGUAGES) {
    const t = translations[lang];
    if (t === undefined) continue;
    const name = t.name?.trim() ?? '';
    if (!name) {
      await tx.categoryTranslation.deleteMany({ where: { categoryId, language: lang } });
      continue;
    }
    await tx.categoryTranslation.upsert({
      where: { categoryId_language: { categoryId, language: lang } },
      update: { name, description: t.description || null, status: statusFor(lang, source) },
      create: { categoryId, language: lang, name, description: t.description || null, status: statusFor(lang, source) },
    });
  }
}

export async function reorderCategories(ctx: TenantContext, orderedIds: string[]) {
  const owned = await db.menuCategory.findMany({ where: { organizationId: ctx.org.id, id: { in: orderedIds } }, select: { id: true } });
  if (owned.length !== orderedIds.length) throw new UserFacingError('Invalid category list.');
  await db.$transaction(orderedIds.map((id, i) => db.menuCategory.update({ where: { id }, data: { sortOrder: i + 1 } })));
}

export async function moveCategory(ctx: TenantContext, categoryId: string, direction: 'up' | 'down') {
  const cats = await db.menuCategory.findMany({ where: { organizationId: ctx.org.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
  const ids = cats.map((c) => c.id);
  const i = ids.indexOf(categoryId);
  if (i < 0) throw new UserFacingError('Category not found.', 404);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await reorderCategories(ctx, ids);
}

export async function deleteCategory(ctx: TenantContext, categoryId: string) {
  const cat = await db.menuCategory.findFirst({ where: { id: categoryId, organizationId: ctx.org.id }, include: { _count: { select: { products: true } } } });
  if (!cat) throw new UserFacingError('Category not found.', 404);
  if (cat._count.products > 0) throw new UserFacingError('Move or archive the dishes in this category first.');
  await db.menuCategory.delete({ where: { id: cat.id } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.category_deleted', entityType: 'MenuCategory', entityId: cat.id });
}

// ------------------------------------------------------------------ products

const priceField = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.union([z.string(), z.number()]).nullable());

export const productInput = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1),
  stationId: z.string().nullable().optional(),
  taxClassId: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'),
  isFeatured: z.boolean().default(false),
  isPopular: z.boolean().default(false),
  tags: z.array(text(30)).max(15).default([]),
  translations: translationsInput,
  prices: z.object({ DINE_IN: priceField, TAKEAWAY: priceField, DELIVERY: priceField }).partial().default({}),
});

export async function saveProduct(ctx: TenantContext, input: unknown) {
  const data = productInput.parse(input);
  const { sourceLanguage } = await orgLanguages(ctx.org.id);
  const sourceName = data.translations[sourceLanguage]?.name?.trim();
  if (!sourceName) throw new UserFacingError(`Enter the dish name in the source language (${sourceLanguage}).`);

  const prices: Partial<Record<PriceChannel, number | null>> = {};
  for (const ch of ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const) {
    const raw = data.prices[ch];
    if (raw === undefined) continue;
    if (raw === null) {
      prices[ch] = null;
      continue;
    }
    const cents = parseMoneyToCents(raw);
    if (cents === null) throw new UserFacingError(`Invalid ${ch.replace('_', '-').toLowerCase()} price. Use a format like 12,50.`);
    if (cents > 100_000_00) throw new UserFacingError('Price is too high.');
    prices[ch] = cents;
  }
  if (data.status === 'ACTIVE' && (prices.DINE_IN ?? null) === null && !data.id) {
    throw new UserFacingError('Set at least the dine-in price before making a dish visible.');
  }

  return db.$transaction(async (tx) => {
    const category = await tx.menuCategory.findFirst({ where: { id: data.categoryId, organizationId: ctx.org.id } });
    if (!category) throw new UserFacingError('Invalid category.');
    const stationId = await assertStation(ctx, data.stationId, tx);
    if (data.taxClassId) {
      const tc = await tx.taxClass.findFirst({ where: { id: data.taxClassId, organizationId: ctx.org.id } });
      if (!tc) throw new UserFacingError('Invalid tax class.');
    }
    let productId = data.id;
    const fields = {
      categoryId: category.id,
      menuId: category.menuId,
      stationId,
      taxClassId: data.taxClassId ?? null,
      status: data.status,
      isFeatured: data.isFeatured,
      isPopular: data.isPopular,
      tags: data.tags.filter(Boolean),
    };
    if (productId) {
      await assertProduct(ctx, productId, tx);
      await tx.menuProduct.update({ where: { id: productId }, data: fields });
    } else {
      await assertMenuItemCapacity(ctx.org.id, 1, tx);
      const max = await tx.menuProduct.aggregate({ where: { organizationId: ctx.org.id, categoryId: category.id }, _max: { sortOrder: true } });
      productId = (await tx.menuProduct.create({ data: { organizationId: ctx.org.id, ...fields, sortOrder: (max._max.sortOrder ?? 0) + 1 } })).id;
    }
    for (const [ch, cents] of Object.entries(prices) as [PriceChannel, number | null][]) {
      if (cents === null) await tx.channelPrice.deleteMany({ where: { productId, channel: ch } });
      else await tx.channelPrice.upsert({ where: { productId_channel: { productId, channel: ch } }, update: { amountCents: cents }, create: { productId, channel: ch, amountCents: cents } });
    }
    if (data.status === 'ACTIVE') {
      const dineIn = await tx.channelPrice.findUnique({ where: { productId_channel: { productId, channel: 'DINE_IN' } } });
      if (!dineIn) throw new UserFacingError('Set at least the dine-in price before making a dish visible.');
    }
    await writeProductTranslations(tx, productId, data.translations, sourceLanguage);
    await audit(
      { organizationId: ctx.org.id, actorUserId: ctx.userId, action: data.id ? 'menu.product_updated' : 'menu.product_created', entityType: 'MenuProduct', entityId: productId, metadata: { prices } },
      tx,
    );
    return { id: productId };
  });
}

async function writeProductTranslations(tx: Tx, productId: string, translations: z.infer<typeof translationsInput>, source: LanguageCode) {
  for (const lang of LANGUAGES) {
    const t = translations[lang];
    if (t === undefined) continue;
    const name = t.name?.trim() ?? '';
    if (!name) {
      await tx.productTranslation.deleteMany({ where: { productId, language: lang } });
      continue;
    }
    await tx.productTranslation.upsert({
      where: { productId_language: { productId, language: lang } },
      update: { name, description: t.description || null, ingredients: t.ingredients || null, status: statusFor(lang, source) },
      create: { productId, language: lang, name, description: t.description || null, ingredients: t.ingredients || null, status: statusFor(lang, source) },
    });
  }
}

/** Quick mobile edit: one channel price. */
export async function setProductPrice(ctx: TenantContext, productId: string, channel: PriceChannel, raw: string) {
  await assertProduct(ctx, productId);
  const cents = parseMoneyToCents(raw);
  if (cents === null) throw new UserFacingError('Invalid price. Use a format like 12,50.');
  await db.channelPrice.upsert({ where: { productId_channel: { productId, channel } }, update: { amountCents: cents }, create: { productId, channel, amountCents: cents } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.price_changed', entityType: 'MenuProduct', entityId: productId, metadata: { channel, cents } });
}

/** Temporary sold-out switch (all locations). Requires only `menu.availability`. */
export async function setSoldOut(ctx: TenantContext, productId: string, soldOut: boolean) {
  await assertProduct(ctx, productId);
  await db.menuProduct.update({ where: { id: productId }, data: { soldOut } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: soldOut ? 'menu.sold_out' : 'menu.back_in_stock', entityType: 'MenuProduct', entityId: productId });
}

export async function setProductStatus(ctx: TenantContext, productId: string, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED') {
  const p = await assertProduct(ctx, productId);
  if (p.status === 'ARCHIVED' && status !== 'ARCHIVED') await assertMenuItemCapacity(ctx.org.id, 1);
  if (status === 'ACTIVE') {
    const dineIn = await db.channelPrice.findUnique({ where: { productId_channel: { productId, channel: 'DINE_IN' } } });
    if (!dineIn) throw new UserFacingError('Set the dine-in price before making this dish visible.');
  }
  await db.menuProduct.update({ where: { id: p.id }, data: { status } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.product_status', entityType: 'MenuProduct', entityId: p.id, metadata: { from: p.status, to: status } });
}

export async function moveProduct(ctx: TenantContext, productId: string, direction: 'up' | 'down') {
  const p = await assertProduct(ctx, productId);
  const siblings = await db.menuProduct.findMany({ where: { organizationId: ctx.org.id, categoryId: p.categoryId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
  const ids = siblings.map((s) => s.id);
  const i = ids.indexOf(productId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await db.$transaction(ids.map((id, k) => db.menuProduct.update({ where: { id }, data: { sortOrder: k + 1 } })));
}

// ------------------------------------------------------------------ variants & modifiers

const namesJson = z.partialRecord(LANG, text(80)).refine((n) => Object.values(n).some((v) => v && v.trim()), 'name_required');

export const variantsInput = z.array(
  z.object({ names: namesJson, priceDelta: z.union([z.string(), z.number()]).default('0'), isDefault: z.boolean().default(false), isAvailable: z.boolean().default(true) }),
).max(20);

export const modifierGroupsInput = z.array(
  z.object({
    names: namesJson,
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1).max(20),
    options: z.array(z.object({ names: namesJson, priceDelta: z.union([z.string(), z.number()]).default('0'), maxQuantity: z.number().int().min(1).max(20).default(1), isAvailable: z.boolean().default(true) })).min(1).max(40),
  }).refine((g) => g.minSelect <= g.maxSelect, 'min_greater_than_max'),
).max(15);

function deltaCents(v: string | number): number {
  const s = String(v).trim();
  const negative = s.startsWith('-');
  const cents = parseMoneyToCents(negative ? s.slice(1) : s);
  if (cents === null) throw new UserFacingError('Invalid extra price. Use a format like 1,50.');
  return negative ? -cents : cents;
}

/** Replaces variants and modifier groups atomically (order lines keep their own snapshots). */
export async function saveProductOptions(ctx: TenantContext, productId: string, variantsRaw: unknown, groupsRaw: unknown) {
  const variants = variantsInput.parse(variantsRaw);
  const groups = modifierGroupsInput.parse(groupsRaw);
  if (variants.length > 0 && variants.filter((v) => v.isDefault).length > 1) throw new UserFacingError('Only one size/variant can be the default.');
  await db.$transaction(async (tx) => {
    await assertProduct(ctx, productId, tx);
    await tx.productVariant.deleteMany({ where: { productId } });
    await tx.modifierGroup.deleteMany({ where: { productId } });
    for (const [i, v] of variants.entries()) {
      await tx.productVariant.create({ data: { productId, names: v.names, priceDeltaCents: deltaCents(v.priceDelta), isDefault: v.isDefault || (i === 0 && !variants.some((x) => x.isDefault)), isAvailable: v.isAvailable, sortOrder: i } });
    }
    for (const [i, g] of groups.entries()) {
      await tx.modifierGroup.create({
        data: {
          productId,
          names: g.names,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          sortOrder: i,
          options: { create: g.options.map((o, k) => ({ names: o.names, priceDeltaCents: deltaCents(o.priceDelta), maxQuantity: o.maxQuantity, isAvailable: o.isAvailable, sortOrder: k })) },
        },
      });
    }
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.options_updated', entityType: 'MenuProduct', entityId: productId }, tx);
  });
}

// ------------------------------------------------------------------ allergens

export const ALLERGENS = ['GLUTEN', 'CRUSTACEANS', 'EGGS', 'FISH', 'PEANUTS', 'SOYBEANS', 'MILK', 'NUTS', 'CELERY', 'MUSTARD', 'SESAME', 'SULPHITES', 'LUPIN', 'MOLLUSCS'] as const;

export const allergenInput = z.object({
  declarations: z.array(z.object({ allergen: z.enum(ALLERGENS), presence: z.enum(['CONTAINS', 'MAY_CONTAIN']) })),
  verify: z.boolean(),
});

/**
 * Saves allergen declarations. Customer-facing allergen statements are only shown after a
 * staff member explicitly confirms they verified them (`verify = true`). Any later edit
 * without re-confirmation clears the verification.
 */
export async function saveAllergens(ctx: TenantContext, productId: string, input: unknown) {
  const data = allergenInput.parse(input);
  const unique = new Map(data.declarations.map((d) => [d.allergen, d.presence]));
  await db.$transaction(async (tx) => {
    await assertProduct(ctx, productId, tx);
    await tx.productAllergenDeclaration.deleteMany({ where: { productId } });
    const now = new Date();
    for (const [allergen, presence] of unique) {
      await tx.productAllergenDeclaration.create({
        data: { productId, allergen, presence, origin: 'MANUAL', verifiedAt: data.verify ? now : null, verifiedById: data.verify ? ctx.userId : null },
      });
    }
    await tx.menuProduct.update({
      where: { id: productId },
      data: { allergensVerifiedAt: data.verify ? now : null, allergensVerifiedById: data.verify ? ctx.userId : null },
    });
    await audit(
      { organizationId: ctx.org.id, actorUserId: ctx.userId, action: data.verify ? 'menu.allergens_verified' : 'menu.allergens_saved_unverified', entityType: 'MenuProduct', entityId: productId, metadata: { allergens: [...unique.entries()] } },
      tx,
    );
  });
}

// ------------------------------------------------------------------ queries

export async function getMenuAdmin(ctx: TenantContext) {
  const [categories, stations, org] = await Promise.all([
    db.menuCategory.findMany({
      where: { organizationId: ctx.org.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        translations: true,
        defaultStation: true,
        products: {
          where: { status: { not: 'ARCHIVED' } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { translations: true, prices: true, station: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 }, _count: { select: { allergens: true, variants: true, modifierGroups: true } } },
        },
      },
    }),
    db.kitchenStation.findMany({ where: { organizationId: ctx.org.id, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true, defaultLanguage: true } }),
  ]);
  return { categories, stations, org };
}

export async function getProductAdmin(ctx: TenantContext, productId: string) {
  return db.menuProduct.findFirst({
    where: { id: productId, organizationId: ctx.org.id },
    include: {
      translations: true,
      prices: true,
      images: { orderBy: { sortOrder: 'asc' } },
      variants: { orderBy: { sortOrder: 'asc' } },
      modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
      allergens: true,
      externalPrices: true,
      schedules: true,
      locationOverrides: true,
      category: { include: { translations: true } },
    },
  });
}

export function pickName(translations: { language: string; name: string }[], prefer: string[]): string | null {
  for (const l of prefer) {
    const t = translations.find((x) => x.language === l);
    if (t?.name) return t.name;
  }
  return translations[0]?.name ?? null;
}

export async function addProductImage(ctx: TenantContext, productId: string, url: string, rightsConfirmed: boolean) {
  if (!rightsConfirmed) throw new UserFacingError('Please confirm you have the right to publish this photo.');
  await assertProduct(ctx, productId);
  const max = await db.productImage.aggregate({ where: { productId }, _max: { sortOrder: true } });
  await db.productImage.create({ data: { productId, url, rightsConfirmed: true, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
}

export async function removeProductImage(ctx: TenantContext, imageId: string) {
  const img = await db.productImage.findFirst({ where: { id: imageId, product: { organizationId: ctx.org.id } } });
  if (!img) throw new UserFacingError('Image not found.', 404);
  await db.productImage.delete({ where: { id: img.id } });
}
