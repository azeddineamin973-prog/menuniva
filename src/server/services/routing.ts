import 'server-only';
import type { Prisma, ProductStatus } from '@/generated/prisma/client';
import { db } from '../db';

/**
 * The single definition of "this dish reaches no kitchen screen" (audit GAP-01).
 *
 * It lives in its own module because three places need to agree on it: the publish blocker, the
 * setup checklist and the routing screen. When they each had their own copy they disagreed —
 * the checklist ignored inactive stations and so went green while `publishChecks` still
 * refused to publish.
 *
 * A dish is unrouted when it has no usable station of its own AND its category has no usable
 * default. "Usable" excludes a station that was switched off: nobody is watching that screen.
 */
export function unroutedWhere(status: ProductStatus | { not: ProductStatus }): Prisma.MenuProductWhereInput {
  return {
    status,
    OR: [{ stationId: null }, { station: { isActive: false } }],
    AND: [{ OR: [{ category: { defaultStationId: null } }, { category: { defaultStation: { isActive: false } } }] }],
  };
}

/** Visible dishes that reach no Kitchen/Café display. */
export async function unroutedDishes(organizationId: string) {
  const rows = await db.menuProduct.findMany({
    where: { organizationId, ...unroutedWhere('ACTIVE') },
    select: { id: true, categoryId: true, translations: { select: { name: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, categoryId: r.categoryId, name: r.translations.find((t) => t.status === 'SOURCE')?.name ?? r.translations[0]?.name ?? '(no name)' }));
}

/** Dishes needing a station before the menu goes live, drafts included. */
export function countUnrouted(organizationId: string) {
  return db.menuProduct.count({ where: { organizationId, ...unroutedWhere({ not: 'ARCHIVED' }) } });
}
