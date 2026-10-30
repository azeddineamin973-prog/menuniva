import 'server-only';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { getSetupProgress } from './setup-progress';

/** Requirements that must be met before guests can see and order from a location. */
export async function publishChecks(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  const [location, visibleProducts, stations, unrouted] = await Promise.all([
    db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId } }),
    db.menuProduct.count({ where: { organizationId: ctx.org.id, status: 'ACTIVE', prices: { some: { channel: 'DINE_IN' } } } }),
    db.kitchenStation.count({ where: { locationId, isActive: true } }),
    db.menuProduct.count({ where: { organizationId: ctx.org.id, status: 'ACTIVE', stationId: null, category: { defaultStationId: null } } }),
  ]);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!location.addressLine1 || !location.city) blockers.push('Add the street address and city (Settings).');
  if (!location.phone && !location.whatsappNumber) blockers.push('Add a telephone or WhatsApp number (Settings).');
  if (visibleProducts === 0) blockers.push('Make at least one dish visible with a dine-in price (Menu).');
  if (location.tableOrderingEnabled && stations === 0) blockers.push('Create at least one kitchen station so orders reach the kitchen.');
  if (unrouted > 0) warnings.push(`${unrouted} visible dishes have no kitchen station and will not appear on a kitchen display.`);
  if (!location.postalCode) warnings.push('Postal code is not set.');
  if (!location.openingHours) warnings.push('Opening hours are not set; takeaway/delivery will not be limited by hours.');
  return { location, blockers, warnings };
}

export async function publishLocation(ctx: TenantContext, locationId: string, confirmed: boolean) {
  if (!confirmed) throw new UserFacingError('Please confirm you reviewed the menu, prices and allergen information.');
  const { blockers } = await publishChecks(ctx, locationId);
  if (blockers.length) throw new UserFacingError(blockers[0]);
  await db.$transaction(async (tx) => {
    await tx.restaurantLocation.update({ where: { id: locationId }, data: { isPublished: true, publishedAt: new Date() } });
    await tx.restaurantOrganization.updateMany({ where: { id: ctx.org.id, status: 'ONBOARDING' }, data: { status: 'ACTIVE' } });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'location.published', entityType: 'RestaurantLocation', entityId: locationId }, tx);
  });
}

export async function unpublishLocation(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  await db.restaurantLocation.update({ where: { id: locationId }, data: { isPublished: false } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'location.unpublished', entityType: 'RestaurantLocation', entityId: locationId });
}

export { getSetupProgress };
