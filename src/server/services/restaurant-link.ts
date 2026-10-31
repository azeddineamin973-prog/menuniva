import 'server-only';
import { isLocalBaseUrl, restaurantPath, restaurantUrl } from '@/lib/restaurant-link';
import { db } from '../db';
import { orgModules } from '../modules';
import { env } from '../env';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { publishChecks } from './publish';

export type RestaurantLink = {
  location: { id: string; name: string; slug: string; isPublished: boolean; publishedAt: Date | null };
  /** Path on this site, e.g. /r/casa-aurora. */
  path: string;
  /** Absolute public URL (APP_BASE_URL + path). */
  url: string;
  /** The same page in draft preview (members only). */
  previewPath: string;
  /** APP_BASE_URL is not reachable by guests (development). */
  local: boolean;
  /** What still blocks publishing (empty when the location is ready or already live). */
  blockers: string[];
  warnings: string[];
};

/** The guest address of one location, its publication status and what remains before publishing. */
export async function getRestaurantLink(ctx: TenantContext, locationId: string, opts: { checks?: boolean } = {}): Promise<RestaurantLink> {
  await assertLocationAccess(ctx, locationId);
  const [location, count] = await Promise.all([
    db.restaurantLocation.findFirstOrThrow({ where: { id: locationId, organizationId: ctx.org.id }, select: { id: true, name: true, slug: true, isPublished: true, publishedAt: true } }),
    db.restaurantLocation.count({ where: { organizationId: ctx.org.id } }),
  ]);
  const path = restaurantPath(ctx.org.slug, location.slug, count > 1);
  const checks = opts.checks !== false && !location.isPublished ? await publishChecks(ctx, locationId) : null;
  return {
    location,
    path,
    url: restaurantUrl(env.APP_BASE_URL, path),
    previewPath: `${path}?preview=1`,
    local: isLocalBaseUrl(env.APP_BASE_URL),
    blockers: checks?.blockers ?? [],
    warnings: checks?.warnings ?? [],
  };
}

/** Guest pages worth previewing for this location: the menu plus each ordering option it offers. */
export async function previewPages(ctx: TenantContext, link: RestaurantLink) {
  const [loc, modules, count] = await Promise.all([
    db.restaurantLocation.findUniqueOrThrow({
      where: { id: link.location.id },
      select: { slug: true, takeawayEnabled: true, deliveryEnabled: true, reservationsEnabled: true, whatsappOrderingEnabled: true, whatsappNumber: true },
    }),
    orgModules(ctx.org.id),
    db.restaurantLocation.count({ where: { organizationId: ctx.org.id } }),
  ]);
  const r = `/r/${ctx.org.slug}`;
  const l = count > 1 ? `?l=${encodeURIComponent(loc.slug)}` : '';
  const pages = [{ key: 'menu', label: 'Menu', path: link.path }];
  if (loc.takeawayEnabled && modules.has('takeaway')) pages.push({ key: 'pickup', label: 'Pickup ordering', path: `${r}/order/pickup${l}` });
  if (loc.deliveryEnabled && modules.has('delivery')) pages.push({ key: 'delivery', label: 'Delivery ordering', path: `${r}/order/delivery${l}` });
  if (loc.whatsappOrderingEnabled && loc.whatsappNumber) pages.push({ key: 'whatsapp', label: 'WhatsApp order', path: `${r}/order/whatsapp${l}` });
  if (loc.reservationsEnabled && modules.has('reservations')) pages.push({ key: 'reserve', label: 'Table reservation', path: `${r}/reserve${l}` });
  return pages;
}
