import 'server-only';
import type { Prisma, ProductStatus } from '@/generated/prisma/client';
import { db, type Tx } from '../db';

/**
 * The single definition of where a dish is prepared at one location (audit GAP-01, OPS-08,
 * OPS-09). Checkout, acceptance, the guest menu, the routing screen, the setup checklist and the
 * publish checks all use it, so they cannot disagree.
 *
 * Menus are shared by every location of a restaurant, stations are not. A dish is therefore
 * routed per location:
 * - its own station, if the dish has one; otherwise "no preparation" if the dish says so;
 * - else its category's station; otherwise "no preparation" if the category says so;
 * - a station only counts when it is switched on AND belongs to the order's location.
 *
 * There is deliberately no fallback. A tea sent by hand to the Café is not moved to the Kitchen
 * because the Café is switched off, and a Braga station never receives a Porto order: the dish
 * is simply not routed there, and checkout refuses it (see `quoteCart`).
 */

/** Form value meaning "needs no preparation: handed over at the counter". */
export const NO_PREPARATION = 'NO_PREPARATION';

type StationRef = { id: string; locationId: string; isActive: boolean } | null | undefined;
export type RoutableDish = {
  stationId: string | null;
  noPreparation: boolean;
  station?: StationRef;
  category: { defaultStationId: string | null; noPreparation: boolean; defaultStation?: StationRef };
};
export type PrepRoute =
  | { kind: 'station'; stationId: string }
  /** Intentionally no preparation (packaged drinks): no ticket, handed over at the counter. */
  | { kind: 'none' }
  /** Needs preparation but no usable station at this location. */
  | { kind: 'missing'; reason: 'no_station' | 'station_off' | 'other_location'; stationId: string | null };

function usable(stationId: string, s: StationRef, locationId: string): PrepRoute {
  if (!s) return { kind: 'missing', reason: 'no_station', stationId: null };
  if (s.locationId !== locationId) return { kind: 'missing', reason: 'other_location', stationId };
  if (!s.isActive) return { kind: 'missing', reason: 'station_off', stationId };
  return { kind: 'station', stationId };
}

export function prepRoute(dish: RoutableDish, locationId: string): PrepRoute {
  if (dish.stationId) return usable(dish.stationId, dish.station, locationId);
  if (dish.noPreparation) return { kind: 'none' };
  if (dish.category.defaultStationId) return usable(dish.category.defaultStationId, dish.category.defaultStation, locationId);
  if (dish.category.noPreparation) return { kind: 'none' };
  return { kind: 'missing', reason: 'no_station', stationId: null };
}

/** Prisma include giving `prepRoute` what it needs. */
export const ROUTING_INCLUDE = {
  station: { select: { id: true, locationId: true, isActive: true } },
  category: { select: { defaultStationId: true, noPreparation: true, defaultStation: { select: { id: true, locationId: true, isActive: true } } } },
} as const;

/**
 * The same rule as `prepRoute`, as a database filter: dishes that need preparation but have no
 * switched-on station of this location.
 */
export function unroutedWhere(status: ProductStatus | { not: ProductStatus }, locationId: string): Prisma.MenuProductWhereInput {
  const here = { isActive: true, locationId };
  return {
    status,
    OR: [
      { stationId: { not: null }, NOT: { station: { is: here } } },
      {
        stationId: null,
        noPreparation: false,
        category: { OR: [{ defaultStationId: null, noPreparation: false }, { defaultStationId: { not: null }, NOT: { defaultStation: { is: here } } }] },
      },
    ],
  };
}

/**
 * Whether this location uses kitchen screens at all. With no switched-on station, every order is
 * prepared and handed over from Live Orders (Ready is set by hand), as before stations existed.
 */
export async function usesStations(locationId: string, tx: Tx | typeof db = db) {
  return (await tx.kitchenStation.count({ where: { locationId, isActive: true } })) > 0;
}

/** Visible dishes that cannot be ordered at this location: no switched-on station here prepares them. */
export async function unroutedDishes(organizationId: string, locationId: string) {
  const rows = await db.menuProduct.findMany({
    where: { organizationId, ...unroutedWhere('ACTIVE', locationId) },
    select: { id: true, categoryId: true, translations: { select: { name: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, categoryId: r.categoryId, name: r.translations.find((t) => t.status === 'SOURCE')?.name ?? r.translations[0]?.name ?? '(no name)' }));
}

/** Dishes needing a station at this location before the menu goes live, drafts included. */
export function countUnrouted(organizationId: string, locationId: string) {
  return db.menuProduct.count({ where: { organizationId, ...unroutedWhere({ not: 'ARCHIVED' }, locationId) } });
}
