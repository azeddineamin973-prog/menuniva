import 'server-only';
import { z } from 'zod';
import type { LanguageCode, OrderChannel } from '@/generated/prisma/enums';
import { assertCents } from '@/lib/money';
import { db, type Tx } from '../db';
import { localName, PRICE_CHANNEL } from './public-menu';

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
  variantId: string | null;
  stationId: string | null;
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

export async function quoteCart(params: { locationId: string; channel: OrderChannel; lang: LanguageCode; items: CartItemInput[] }, tx: Tx | typeof db = db): Promise<Quote> {
  const items = cartSchema.parse(params.items);
  const location = await tx.restaurantLocation.findUniqueOrThrow({ where: { id: params.locationId }, include: { organization: { select: { id: true, sourceLanguage: true } } } });
  const orgId = location.organizationId;
  const source = location.organization.sourceLanguage;
  const priceChannel = PRICE_CHANNEL[params.channel];
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await tx.menuProduct.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    include: {
      translations: true,
      prices: true,
      variants: true,
      modifierGroups: { include: { options: true } },
      locationOverrides: { where: { locationId: location.id } },
      category: { select: { defaultStationId: true, isActive: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const issues: QuoteIssue[] = [];
  const lines: QuotedLine[] = [];

  items.forEach((item, index) => {
    const p = byId.get(item.productId);
    if (!p || p.status !== 'ACTIVE' || !p.category.isActive) return void issues.push({ index, code: 'unavailable' });
    const nameSource = p.translations.find((t) => t.language === source)?.name ?? p.translations[0]?.name ?? '';
    const nameCustomer = p.translations.find((t) => t.language === params.lang && t.status !== 'MACHINE')?.name ?? nameSource;
    const override = p.locationOverrides[0];
    if (override && !override.isAvailable) return void issues.push({ index, code: 'unavailable', name: nameCustomer });
    if (p.soldOut || override?.soldOut) return void issues.push({ index, code: 'sold_out', name: nameCustomer });
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
      variantId: item.variantId ?? null,
      stationId: p.stationId ?? p.category.defaultStationId ?? null,
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
