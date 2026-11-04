import 'server-only';
import type { LanguageCode, OrderChannel, PriceChannel } from '@/generated/prisma/enums';
import { isOpenAt } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';
import { db } from '../db';
import { prepRoute, ROUTING_INCLUDE, usesStations } from './routing';

export const PRICE_CHANNEL: Record<OrderChannel, PriceChannel> = { TABLE: 'DINE_IN', TAKEAWAY: 'TAKEAWAY', DELIVERY: 'DELIVERY' };

type Names = Partial<Record<LanguageCode, string>>;

/** Localised name from a {lang: name} JSON map with fallback to the source language. */
export function localName(names: unknown, lang: LanguageCode, source: LanguageCode): string {
  const n = (names ?? {}) as Names;
  return n[lang]?.trim() || n[source]?.trim() || Object.values(n).find((v) => v?.trim()) || '';
}

/**
 * Guests see only translations written or reviewed by the restaurant (SOURCE/REVIEWED).
 * Unreviewed MACHINE translations fall back to the source language.
 */
function pickTranslation<T extends { language: LanguageCode; status: string }>(rows: T[], lang: LanguageCode, source: LanguageCode): T | undefined {
  return rows.find((r) => r.language === lang && r.status !== 'MACHINE') ?? rows.find((r) => r.language === source) ?? rows[0];
}

export type PublicModifierOption = { id: string; name: string; priceDeltaCents: number; maxQuantity: number };
export type PublicModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; options: PublicModifierOption[] };
export type PublicProduct = {
  id: string;
  name: string;
  description: string | null;
  ingredients: string | null;
  imageUrl: string | null;
  priceCents: number;
  soldOut: boolean;
  available: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  tags: string[];
  /** Only present when the restaurant verified the allergen information. */
  allergens: { contains: string[]; mayContain: string[] } | null;
  variants: { id: string; name: string; priceDeltaCents: number; isDefault: boolean }[];
  modifierGroups: PublicModifierGroup[];
};
export type PublicCategory = { id: string; name: string; description: string | null; products: PublicProduct[] };

export function scheduleAllows(schedules: { dayOfWeek: number; startMinute: number; endMinute: number }[], weekday: number, minute: number) {
  if (schedules.length === 0) return true;
  return schedules.some((s) => s.dayOfWeek === weekday && minute >= s.startMinute && minute < s.endMinute);
}

/** The menu exactly as a guest sees it for one location, channel and language. */
export async function getPublicMenu(locationId: string, lang: LanguageCode, channel: OrderChannel, now = new Date()): Promise<PublicCategory[]> {
  const location = await db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId }, include: { organization: { select: { id: true, sourceLanguage: true } } } });
  const source = location.organization.sourceLanguage;
  const priceChannel = PRICE_CHANNEL[channel];
  const local = zonedParts(now, location.timeZone);
  const minute = local.hour * 60 + local.minute;

  const [categories, withStations] = await Promise.all([
    db.menuCategory.findMany({
      where: { organizationId: location.organizationId, isActive: true, menu: { isActive: true } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        translations: true,
        schedules: true,
        defaultStation: ROUTING_INCLUDE.category.select.defaultStation,
        products: {
          where: { status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            translations: true,
            prices: true,
            images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1, where: { rightsConfirmed: true } },
            variants: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } },
            modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } } } },
            allergens: true,
            locationOverrides: { where: { locationId } },
            schedules: true,
            station: ROUTING_INCLUDE.station,
          },
        },
      },
    }),
    usesStations(locationId),
  ]);

  const out: PublicCategory[] = [];
  for (const c of categories) {
    if (!scheduleAllows(c.schedules, local.weekday, minute)) continue;
    const ct = pickTranslation(c.translations, lang, source);
    const products: PublicProduct[] = [];
    for (const p of c.products) {
      const override = p.locationOverrides[0];
      if (override && !override.isAvailable) continue;
      const overridePrice = override ? { DINE_IN: override.dineInPriceCents, TAKEAWAY: override.takeawayPriceCents, DELIVERY: override.deliveryPriceCents }[priceChannel] : null;
      const price = overridePrice ?? p.prices.find((x) => x.channel === priceChannel)?.amountCents;
      if (price === undefined || price === null) continue; // not offered on this channel
      const t = pickTranslation(p.translations, lang, source);
      const verified = !!p.allergensVerifiedAt && p.allergens.every((a) => a.verifiedAt);
      products.push({
        id: p.id,
        name: t?.name ?? '',
        description: t?.description ?? null,
        ingredients: t?.ingredients ?? null,
        imageUrl: p.images[0]?.url ?? null,
        priceCents: price,
        soldOut: p.soldOut || !!override?.soldOut,
        // Same rule as checkout: a dish no switched-on station of this location prepares cannot be ordered.
        available: scheduleAllows(p.schedules, local.weekday, minute) && (!withStations || prepRoute({ ...p, category: c }, locationId).kind !== 'missing'),
        isFeatured: p.isFeatured,
        isPopular: p.isPopular,
        tags: p.tags,
        allergens: verified
          ? { contains: p.allergens.filter((a) => a.presence === 'CONTAINS').map((a) => a.allergen), mayContain: p.allergens.filter((a) => a.presence === 'MAY_CONTAIN').map((a) => a.allergen) }
          : null,
        variants: p.variants.map((v) => ({ id: v.id, name: localName(v.names, lang, source), priceDeltaCents: v.priceDeltaCents, isDefault: v.isDefault })),
        modifierGroups: p.modifierGroups
          .filter((g) => g.options.length > 0)
          .map((g) => ({
            id: g.id,
            name: localName(g.names, lang, source),
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options.map((o) => ({ id: o.id, name: localName(o.names, lang, source), priceDeltaCents: o.priceDeltaCents, maxQuantity: o.maxQuantity })),
          })),
      });
    }
    if (products.length) out.push({ id: c.id, name: ct?.name ?? '', description: ct?.description ?? null, products });
  }
  return out;
}

export type OrderingState = { canOrder: boolean; reason: 'ok' | 'not_published' | 'channel_disabled' | 'paused' | 'suspended' | 'closed' };

/** Whether a channel accepts new orders right now. */
export function orderingState(
  location: { isPublished: boolean; orderingPaused: boolean; tableOrderingEnabled: boolean; takeawayEnabled: boolean; deliveryEnabled: boolean; openingHours: unknown; timeZone: string },
  orgStatus: string,
  channel: OrderChannel,
  now = new Date(),
): OrderingState {
  if (orgStatus === 'SUSPENDED' || orgStatus === 'ARCHIVED') return { canOrder: false, reason: 'suspended' };
  if (!location.isPublished) return { canOrder: false, reason: 'not_published' };
  const enabled = channel === 'TABLE' ? location.tableOrderingEnabled : channel === 'TAKEAWAY' ? location.takeawayEnabled : location.deliveryEnabled;
  if (!enabled) return { canOrder: false, reason: 'channel_disabled' };
  if (location.orderingPaused) return { canOrder: false, reason: 'paused' };
  // Takeaway/delivery respect opening hours when configured. Table orders are placed by guests already seated.
  if (channel !== 'TABLE' && location.openingHours) {
    const p = zonedParts(now, location.timeZone);
    if (!isOpenAt(location.openingHours as never, p.weekday, p.hour * 60 + p.minute)) return { canOrder: false, reason: 'closed' };
  }
  return { canOrder: true, reason: 'ok' };
}
