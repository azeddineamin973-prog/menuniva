import 'server-only';
import { cookies } from 'next/headers';
import { accessibleLocations, type TenantContext } from './tenant';

export const locationCookie = (orgSlug: string) => `mn_loc_${orgSlug}`;

/**
 * The location a staff member is currently working in (chosen with the sidebar switcher).
 * Falls back to the first accessible location. Always tenant- and permission-scoped.
 */
export async function currentLocation(ctx: TenantContext) {
  const locations = await accessibleLocations(ctx);
  const chosen = (await cookies()).get(locationCookie(ctx.org.slug))?.value;
  return locations.find((l) => l.id === chosen) ?? locations[0] ?? null;
}
