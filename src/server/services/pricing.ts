import 'server-only';
import { z } from 'zod';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import { assertCents } from '@/lib/money';
import { db, type Tx } from '../db';
import { zonedParts } from '@/lib/time';
import { localName, PRICE_CHANNEL, scheduleAllows } from './public-menu';
import { prepRoute } from './routing';

/**
 * Authoritative server-side pricing (Part 8): the browser sends only product/option IDs
 * and quantities. Prices, availability and option rules are re-checked from the database.
 * All arithmetic is integer cents.
 */

export const cartItemSchema = z.object({
  productId: z.string().min(1).max(40),
  variantId: z.string().min(1).max(40).nullable().optional(),
  modifiers: z.array(z.object({ optionId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(20) })).max(60).default([]),
  quantity: z.number().int().min(1).max(50),
  notes: z.string().trim().max(200).optional(),
});
export const cartSchema = z.array(cartItemSchema).min(1).max(50);
export type CartItemInput = z.infer<typeof cartItemSchema>;

export type QuoteIssue = { index: number; code: 'unavailable' | 'sold_out' | 'invalid_variant' | 'invalid_option' | 'selection_rules' | 'not_on_channel'; name?: string; group?: string };

export type QuotedLine = {
  productId: string;
  categoryId: string;
  variantId: string | null;
  /** Switched-on station of the order's location; null for counter items. */
  stationId: string | null;
  /**
   * station: prepared at `stationId` (ticket on accept). none: needs no preparation, handed over
   * at the counter. counter: the location uses no kitchen screens, Live Orders is the only list.
   */
  prep: 'station' | 'none' | 'counter';
  nameSnapshot: string;
  customerNameSnapshot: string;
  variantNameSnapshot: string | null;
  unitPriceCents: number;
  modifiersUnitCents: number;
  quantity: number;
  lineTotalCents: number;
  notes: string | null;
  modifiers: { optionId: string; groupNameSnapshot: string; nameSnapshot: string; priceDeltaCents: number; quantity: number }[];
};

export type Quote = { lines: QuotedLine[]; subtotalCents: number; issues: QuoteIssue[] };

/** The location fields pricing needs. A caller that already read the location passes it (two round trips fewer). */
type PricingLocation = { id: string; organizationId: string; timeZone: string; organization: { sourceLanguage: LanguageCode } };

export async function quoteCart(params: { locationId: string; channel: OrderChannel; lang: LanguageCode; items: CartItemInput[]; now?: Date; location?: PricingLocation }, tx: Tx | typeof db = db): Promise<Quote> {
  const items = cartSchema.parse(params.items);
  const location: PricingLocation =
    params.location?.id === params.locationId
      ? params.location
      : await tx.restaurantLocation.findUniqueOrThrow({ where: { id: params.locationId }, select: { id: true, organizationId: true, timeZone: true, organization: { select: { sourceLanguage: true } } } });
  const orgId = location.organizationId;
  const source = location.organization.sourceLanguage;
  const priceChannel = PRICE_CHANNEL[params.channel];
  const local = zonedParts(params.now ?? new Date(), location.timeZone);
  const minuteOfDay = local.hour * 60 + local.minute;
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await loadPricedProducts(tx, orgId, location.id, ids);
  const withStations = products.stationsHere;
  const byId = new Map(products.rows.map((p) => [p.id, p]));
  const issues: QuoteIssue[] = [];
  const lines: QuotedLine[] = [];

  items.forEach((item, index) => {
    const p = byId.get(item.productId);
    if (!p || p.status !== 'ACTIVE' || !p.category?.isActive) return void issues.push({ index, code: 'unavailable' });
    const category = p.category;
    const nameSource = p.translations.find((t) => t.language === source)?.name ?? p.translations[0]?.name ?? '';
    const nameCustomer = p.translations.find((t) => t.language === params.lang && t.status !== 'MACHINE')?.name ?? nameSource;
    const override = p.locationOverrides[0];
    if (override && !override.isAvailable) return void issues.push({ index, code: 'unavailable', name: nameCustomer });
    if (p.soldOut || override?.soldOut) return void issues.push({ index, code: 'sold_out', name: nameCustomer });
    if (!scheduleAllows(category.schedules, local.weekday, minuteOfDay) || !scheduleAllows(p.schedules, local.weekday, minuteOfDay))
      return void issues.push({ index, code: 'unavailable', name: nameCustomer });
    // Where it is prepared at THIS location. A dish that needs preparation but has no switched-on
    // station here (forgotten, Café switched off, or only routed to another location's station)
    // cannot be ordered: nobody would see it. Locations without kitchen screens keep the counter flow.
    const route = prepRoute({ ...p, category }, location.id);
    if (route.kind === 'missing' && withStations) return void issues.push({ index, code: 'unavailable', name: nameCustomer });
    const overridePrice = override ? { DINE_IN: override.dineInPriceCents, TAKEAWAY: override.takeawayPriceCents, DELIVERY: override.deliveryPriceCents }[priceChannel] : null;
    const base = overridePrice ?? p.prices.find((x) => x.channel === priceChannel)?.amountCents;
    if (base === undefined || base === null) return void issues.push({ index, code: 'not_on_channel', name: nameCustomer });

    let unit = base;
    let variantName: string | null = null;
    const activeVariants = p.variants.filter((v) => v.isAvailable);
    if (item.variantId) {
      const v = activeVariants.find((x) => x.id === item.variantId);
      if (!v) return void issues.push({ index, code: 'invalid_variant', name: nameCustomer });
      unit += v.priceDeltaCents;
      variantName = localName(v.names, source, source);
    } else if (activeVariants.length > 0) {
      return void issues.push({ index, code: 'invalid_variant', name: nameCustomer });
    }
    if (unit < 0) return void issues.push({ index, code: 'invalid_variant', name: nameCustomer });

    const optionIndex = new Map(p.modifierGroups.flatMap((g) => g.options.map((o) => [o.id, { o, g }] as const)));
    const perGroup = new Map<string, number>();
    const mods: QuotedLine['modifiers'] = [];
    let modsUnit = 0;
    let bad = false;
    const seen = new Set<string>();
    for (const m of item.modifiers) {
      const hit = optionIndex.get(m.optionId);
      if (!hit || !hit.o.isAvailable || m.quantity > hit.o.maxQuantity || seen.has(m.optionId)) {
        bad = true;
        break;
      }
      seen.add(m.optionId);
      perGroup.set(hit.g.id, (perGroup.get(hit.g.id) ?? 0) + m.quantity);
      modsUnit += hit.o.priceDeltaCents * m.quantity;
      mods.push({ optionId: hit.o.id, groupNameSnapshot: localName(hit.g.names, source, source), nameSnapshot: localName(hit.o.names, source, source), priceDeltaCents: hit.o.priceDeltaCents, quantity: m.quantity });
    }
    if (bad) return void issues.push({ index, code: 'invalid_option', name: nameCustomer });
    for (const g of p.modifierGroups) {
      if (!g.options.some((o) => o.isAvailable)) continue;
      const n = perGroup.get(g.id) ?? 0;
      if (n < g.minSelect || n > g.maxSelect) return void issues.push({ index, code: 'selection_rules', name: nameCustomer, group: localName(g.names, params.lang, source) });
    }
    const perUnit = unit + modsUnit;
    if (perUnit < 0) return void issues.push({ index, code: 'invalid_option', name: nameCustomer });
    lines.push({
      productId: p.id,
      categoryId: p.categoryId,
      variantId: item.variantId ?? null,
      stationId: route.kind === 'station' ? route.stationId : null,
      prep: route.kind === 'station' ? 'station' : route.kind === 'none' ? 'none' : 'counter',
      nameSnapshot: nameSource,
      customerNameSnapshot: nameCustomer,
      variantNameSnapshot: variantName,
      unitPriceCents: assertCents(unit),
      modifiersUnitCents: assertCents(modsUnit),
      quantity: item.quantity,
      lineTotalCents: assertCents(perUnit * item.quantity),
      notes: item.notes?.trim() || null,
      modifiers: mods,
    });
  });

  const subtotalCents = assertCents(lines.reduce((s, l) => s + l.lineTotalCents, 0));
  return { lines, subtotalCents, issues };
}

/**
 * Everything pricing needs about the cart's dishes, in ONE database round trip: every relation is read
 * by the product ids from the cart, side by side, instead of Prisma's nested include (one round trip
 * per level: four in a row, each paying the full database latency on every guest order; final QA).
 * Every read is limited to this organisation's dishes; results are joined here in memory, with the
 * same shape the include gave.
 */
async function loadPricedProducts(tx: Tx | typeof db, organizationId: string, locationId: string, ids: string[]) {
  const ofCart = { productId: { in: ids }, product: { organizationId } };
  const [products, translations, prices, variants, groups, options, overrides, schedules, stations, categories] = await Promise.all([
    tx.menuProduct.findMany({ where: { id: { in: ids }, organizationId } }),
    tx.productTranslation.findMany({ where: ofCart }),
    tx.channelPrice.findMany({ where: ofCart }),
    tx.productVariant.findMany({ where: ofCart }),
    tx.modifierGroup.findMany({ where: ofCart }),
    tx.modifierOption.findMany({ where: { group: ofCart } }),
    tx.productLocationOverride.findMany({ where: { ...ofCart, locationId } }),
    // The dishes' own time windows and those of their categories.
    tx.availabilitySchedule.findMany({ where: { OR: [ofCart, { category: { organizationId, products: { some: { id: { in: ids } } } } }] } }),
    // The organisation's stations (a short list): the dishes' and categories' stations, and whether this location uses any.
    tx.kitchenStation.findMany({ where: { organizationId }, select: { id: true, locationId: true, isActive: true } }),
    tx.menuCategory.findMany({ where: { organizationId, products: { some: { id: { in: ids } } } }, select: { id: true, isActive: true, defaultStationId: true, noPreparation: true } }),
  ]);
  const station = new Map(stations.map((s) => [s.id, s]));
  const by = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return (k: K) => m.get(k) ?? [];
  };
  const [tr, pr, va, gr, op, ov, ps, cs] = [
    by(translations, (r) => r.productId),
    by(prices, (r) => r.productId),
    by(variants, (r) => r.productId),
    by(groups, (r) => r.productId),
    by(options, (r) => r.groupId),
    by(overrides, (r) => r.productId),
    by(schedules, (r) => r.productId),
    by(schedules, (r) => r.categoryId),
  ];
  const category = new Map(categories.map((c) => [c.id, { ...c, schedules: cs(c.id), defaultStation: c.defaultStationId ? (station.get(c.defaultStationId) ?? null) : null }]));
  return {
    stationsHere: stations.some((s) => s.locationId === locationId && s.isActive),
    rows: products.map((p) => ({
      ...p,
      translations: tr(p.id),
      prices: pr(p.id),
      variants: va(p.id),
      modifierGroups: gr(p.id).map((g) => ({ ...g, options: op(g.id) })),
      locationOverrides: ov(p.id),
      schedules: ps(p.id),
      station: p.stationId ? (station.get(p.stationId) ?? null) : null,
      category: category.get(p.categoryId) ?? null,
    })),
  };
}
