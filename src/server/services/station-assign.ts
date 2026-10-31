import 'server-only';
import { z } from 'zod';
import type { LanguageCode, StationType } from '@/generated/prisma/enums';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { pickName } from './menu';
import { unroutedDishes, unroutedWhere } from './routing';

/**
 * Routing a whole menu to Kitchen / Café in one pass.
 *
 * Why this matters: a dish with no station reaches no kitchen screen. `createKitchenTickets`
 * skips items whose `stationId` is null, so an unrouted dish is ordered, charged and never
 * cooked. Assigning stations one dish at a time after a 73-item import is how that happens.
 *
 * What this module does NOT do:
 * - It never creates a station on its own. Station names belong to the restaurant, and an
 *   invented "Kitchen" that nobody watches is worse than an empty list. `createStations` only
 *   runs from an explicit click with the types the owner chose.
 * - It never guesses when it cannot be reasonably sure: a category with no keyword match, or
 *   one whose suggested type has no station yet, is returned with no suggestion rather than
 *   routed somewhere arbitrary.
 */

/**
 * Words that place a category on the drinks/dessert side of the pass, in the five languages
 * MenuNiva supports. Matching is done on word boundaries over a normalised (accent-free) name,
 * so "Cafés" and "CAFE" both match but "Decaffeinated beef" does not match "caf".
 */
/**
 * Words that only mean "drink" with their accents on. `thé` and `té` are tea in French and
 * Spanish, but stripped of accents they become "the" and "te", which appear all over English and
 * Portuguese menu names — "The best of the house" was being routed to the café. These are
 * therefore matched against the accented text, before accents are removed.
 */
const ACCENTED_DRINK_WORDS = ['thé', 'thés', 'té', 'tés', 'chá', 'chás', 'água', 'águas', 'bière', 'bières'];

const KEYWORDS: { type: StationType; words: string[] }[] = [
  {
    type: 'CAFE',
    words: [
      // pt / es / fr / en
      'cafe', 'cafes', 'coffee', 'cha', 'chas', 'tea', 'teas', 'infusao', 'infusoes', 'infusion', 'infusions',
      'bebida', 'bebidas', 'bebidaquente', 'drink', 'drinks', 'boisson', 'boissons', 'refresco', 'refrescos',
      'sumo', 'sumos', 'juice', 'juices', 'jus', 'zumo', 'zumos', 'agua', 'aguas', 'water', 'eau', 'eaux',
      'refrigerante', 'refrigerantes', 'soda', 'sodas', 'smoothie', 'smoothies', 'batido', 'batidos', 'milkshake',
      'cerveja', 'cervejas', 'beer', 'beers', 'biere', 'bieres', 'vinho', 'vinhos', 'wine', 'wines', 'vin', 'vins', 'vino', 'vinos',
      'chai', 'latte', 'cappuccino', 'expresso', 'espresso',
      // ar
      'شاي', 'قهوة', 'عصير', 'عصائر', 'مشروبات', 'مشروب', 'ماء', 'مياه',
    ],
  },
  {
    type: 'DESSERTS',
    words: [
      'sobremesa', 'sobremesas', 'dessert', 'desserts', 'doce', 'doces', 'postre', 'postres', 'sucre', 'sucreries',
      'gelado', 'gelados', 'icecream', 'glace', 'glaces', 'sorvete', 'sorvetes',
      'bolo', 'bolos', 'cake', 'cakes', 'gateau', 'gateaux', 'tarte', 'tartes', 'tart', 'tarts', 'pastel', 'pasteis',
      'pastelaria', 'pastry', 'pastries', 'crepe', 'crepes', 'pudim', 'pudding', 'baklava', 'chebakia',
      'حلويات', 'حلى', 'حلوى', 'كيك',
    ],
  },
];

/** Lower-cases and strips accents so "Sobremesas" and "sobremesas" compare equal. */
export function normalizeCategoryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Suggests which kind of station a category belongs to from its name. Returns null when no
 * keyword matches — the caller then leaves the choice to the owner instead of guessing.
 *
 * Note it deliberately does not default to KITCHEN: "everything unmatched is food" is right
 * often enough to be dangerous, and a wrong station silently sends orders to the wrong screen.
 */
export function suggestStationType(categoryName: string): StationType | null {
  const accented = new Set(categoryName.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for (const w of ACCENTED_DRINK_WORDS) if (accented.has(w)) return 'CAFE';
  const normalized = normalizeCategoryName(categoryName);
  const words = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const joined = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  for (const group of KEYWORDS) {
    for (const w of group.words) {
      const needle = normalizeCategoryName(w);
      if (words.has(needle)) return group.type;
      // Catches run-together names like "BebidasQuentes" without matching inside unrelated words.
      if (needle.length >= 5 && joined.includes(needle)) return group.type;
    }
  }
  return null;
}

/**
 * Which station types can serve a suggested type, best first. A restaurant that keeps one
 * kitchen and one café should still get sensible routing for a "Desserts" category: the kitchen
 * plates them. A drinks category is equally at home at a café or a bar.
 */
const TYPE_FALLBACKS: Record<StationType, StationType[]> = {
  CAFE: ['CAFE', 'DRINKS', 'OTHER'],
  DRINKS: ['DRINKS', 'CAFE', 'OTHER'],
  DESSERTS: ['DESSERTS', 'KITCHEN', 'OTHER'],
  KITCHEN: ['KITCHEN', 'OTHER'],
  OTHER: ['OTHER', 'KITCHEN'],
};

export type CategoryRouting = {
  categoryId: string;
  name: string;
  products: number;
  /** Dishes in this category that override the category default with their own station. */
  overridden: number;
  currentStationId: string | null;
  currentStationName: string | null;
  suggestedType: StationType | null;
  /** A real station of the suggested type, when the restaurant has one. */
  suggestedStationId: string | null;
  suggestedStationName: string | null;
};

export type RoutingReview = {
  stations: { id: string; name: string; type: StationType; isActive: boolean }[];
  categories: CategoryRouting[];
  /** Visible dishes that currently reach no kitchen screen (the canonical definition). */
  unrouted: { id: string; categoryId: string; name: string }[];
  /** Including drafts: what still needs a station before the menu goes live. */
  unassignedProducts: number;
  /** Station types a suggestion asked for that the restaurant has no station for. */
  missingTypes: StationType[];
  assignable: number;
};

/** Categories, their current station and a reviewable suggestion for each. Read-only. */
export async function routingReview(ctx: TenantContext, locationId: string): Promise<RoutingReview> {
  await assertLocationAccess(ctx, locationId);
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } });
  const langs: LanguageCode[] = [org.sourceLanguage, ...org.enabledLanguages];
  const [stations, categories, unrouted] = await Promise.all([
    db.kitchenStation.findMany({ where: { locationId, organizationId: ctx.org.id }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, type: true, isActive: true } }),
    db.menuCategory.findMany({
      where: { organizationId: ctx.org.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        translations: { select: { language: true, name: true } },
        defaultStation: { select: { id: true, name: true } },
        products: { where: { status: { not: 'ARCHIVED' } }, select: { id: true, stationId: true } },
      },
    }),
    unroutedDishes(ctx.org.id),
  ]);
  const active = stations.filter((s) => s.isActive);
  const missingTypes = new Set<StationType>();
  const out: CategoryRouting[] = categories.map((c) => {
    const name = pickName(c.translations, langs) ?? '(unnamed category)';
    // No keyword match means food, which is the overwhelming majority of a menu — but only
    // once at least one station exists to send it to.
    const suggestedType = suggestStationType(name) ?? (active.length > 0 ? 'KITCHEN' : null);
    const match = suggestedType ? TYPE_FALLBACKS[suggestedType].map((t) => active.find((s) => s.type === t)).find(Boolean) : undefined;
    // Report the exact type only when the restaurant has nothing that could serve it.
    if (suggestedType && !match) missingTypes.add(suggestedType);
    return {
      categoryId: c.id,
      name,
      products: c.products.length,
      overridden: c.products.filter((p) => p.stationId).length,
      currentStationId: c.defaultStationId,
      currentStationName: c.defaultStation?.name ?? null,
      suggestedType: suggestedType ?? null,
      suggestedStationId: match?.id ?? null,
      suggestedStationName: match?.name ?? null,
    };
  });
  const unassignedProducts = await db.menuProduct.count({ where: { organizationId: ctx.org.id, ...unroutedWhere({ not: 'ARCHIVED' }) } });
  return {
    stations,
    categories: out,
    unrouted,
    unassignedProducts,
    missingTypes: [...missingTypes],
    assignable: out.filter((c) => c.suggestedStationId && c.suggestedStationId !== c.currentStationId).length,
  };
}

export const assignCategoriesSchema = z.object({
  assignments: z
    .array(z.object({ categoryId: z.string().min(1), stationId: z.string().min(1).nullable() }))
    .min(1, 'Nothing to assign.')
    .max(500),
});

/**
 * Sets the default station of many categories at once. Dishes inherit it unless they carry their
 * own station, which is left alone — an owner who routed one dish by hand keeps that choice.
 */
export async function assignCategoryStations(ctx: TenantContext, input: unknown): Promise<{ categories: number; products: number }> {
  const d = assignCategoriesSchema.parse(input);
  // Every station id is checked against this tenant before anything is written.
  const stationIds = [...new Set(d.assignments.map((a) => a.stationId).filter((v): v is string => !!v))];
  if (stationIds.length) {
    const found = await db.kitchenStation.findMany({ where: { id: { in: stationIds }, organizationId: ctx.org.id }, select: { id: true } });
    if (found.length !== stationIds.length) throw new UserFacingError('Invalid station.');
  }
  const categoryIds = [...new Set(d.assignments.map((a) => a.categoryId))];
  const owned = await db.menuCategory.findMany({ where: { id: { in: categoryIds }, organizationId: ctx.org.id }, select: { id: true } });
  const ownedIds = new Set(owned.map((c) => c.id));
  const valid = d.assignments.filter((a) => ownedIds.has(a.categoryId));
  if (valid.length === 0) throw new UserFacingError('No categories found.', 404);

  // Group by station so this is a handful of updateMany calls rather than one per category.
  const byStation = new Map<string | null, string[]>();
  for (const a of valid) byStation.set(a.stationId, [...(byStation.get(a.stationId) ?? []), a.categoryId]);
  const { categories, products } = await db.$transaction(async (tx) => {
    let changed = 0;
    for (const [stationId, ids] of byStation) {
      const res = await tx.menuCategory.updateMany({ where: { id: { in: ids }, organizationId: ctx.org.id }, data: { defaultStationId: stationId } });
      changed += res.count;
    }
    const affected = await tx.menuProduct.count({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' }, categoryId: { in: valid.map((a) => a.categoryId) }, stationId: null } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.category_stations_assigned', entityType: 'Menu', metadata: { categories: changed, products: affected } }, tx);
    return { categories: changed, products: affected };
  });
  return { categories, products };
}

export const createStationsSchema = z.object({
  locationId: z.string().min(1),
  types: z.array(z.enum(['KITCHEN', 'CAFE', 'DESSERTS', 'DRINKS', 'OTHER'])).min(1, 'Choose at least one station.').max(5),
});

const DEFAULT_NAMES: Record<StationType, string> = { KITCHEN: 'Kitchen', CAFE: 'Café', DESSERTS: 'Desserts', DRINKS: 'Drinks', OTHER: 'Other' };

/**
 * Creates the stations the owner ticked. Names are editable afterwards on the same page; a type
 * that already has an active station is skipped so pressing the button twice is harmless.
 */
export async function createStations(ctx: TenantContext, input: unknown): Promise<{ created: string[] }> {
  const d = createStationsSchema.parse(input);
  await assertLocationAccess(ctx, d.locationId);
  const existing = await db.kitchenStation.findMany({ where: { locationId: d.locationId, organizationId: ctx.org.id }, select: { type: true, isActive: true, sortOrder: true } });
  const have = new Set(existing.filter((s) => s.isActive).map((s) => s.type));
  const wanted = d.types.filter((t) => !have.has(t));
  if (wanted.length === 0) throw new UserFacingError('Those stations already exist.');
  let order = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0);
  const created: string[] = [];
  await db.$transaction(async (tx) => {
    for (const type of wanted) {
      await tx.kitchenStation.create({ data: { organizationId: ctx.org.id, locationId: d.locationId, name: DEFAULT_NAMES[type], type, sortOrder: ++order } });
      created.push(DEFAULT_NAMES[type]);
    }
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'station.created', entityType: 'RestaurantLocation', entityId: d.locationId, metadata: { created } }, tx);
  });
  return { created };
}
