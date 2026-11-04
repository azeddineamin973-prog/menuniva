import 'server-only';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { unroutedDishes } from './routing';
import { getSetupProgress } from './setup-progress';

/** Requirements that must be met before guests can see and order from a location. */
export async function publishChecks(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  const [location, visibleProducts, stations, routedHere] = await Promise.all([
    db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId }, include: { takeawaySettings: { select: { pickupHours: true } }, deliverySettings: { select: { deliveryHours: true } } } }),
    db.menuProduct.count({ where: { organizationId: ctx.org.id, status: 'ACTIVE', prices: { some: { channel: 'DINE_IN' } } } }),
    db.kitchenStation.count({ where: { locationId, isActive: true } }),
    unroutedDishes(ctx.org.id, locationId),
  ]);
  // Without kitchen screens every order is handled from Live Orders, so nothing is "unrouted".
  const unrouted = stations > 0 ? routedHere : [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!location.addressLine1 || !location.city) blockers.push('Add the street address and city (Settings).');
  if (!location.phone && !location.whatsappNumber) blockers.push('Add a telephone or WhatsApp number (Settings).');
  if (visibleProducts === 0) blockers.push('Make at least one dish visible with a dine-in price (Menu).');
  if (location.tableOrderingEnabled && stations === 0) blockers.push('Create at least one kitchen station so orders reach the kitchen.');
  if (unrouted.length > 0)
    warnings.push(
      `${unrouted.length} visible dishes have no switched-on station at this location, so guests cannot order them here: ${unrouted.slice(0, 5).map((u) => u.name).join(', ')}${unrouted.length > 5 ? '…' : ''}. Assign a station, or mark items that need none as “No preparation” (Kitchen stations).`,
    );
  if (!location.postalCode) warnings.push('Postal code is not set.');
  if (location.takeawayEnabled && !location.openingHours && !location.takeawaySettings?.pickupHours) blockers.push('Enter opening hours (Settings) or pickup hours (Takeaway): takeaway would otherwise accept orders at any time.');
  if (location.deliveryEnabled && !location.openingHours && !location.deliverySettings?.deliveryHours) blockers.push('Enter opening hours (Settings) or delivery hours (Delivery): delivery would otherwise accept orders at any time.');
  if (!location.openingHours) warnings.push('Opening hours are not set (shown on your public page; also used for takeaway/delivery when no specific hours are set).');
  return { location, blockers, warnings, unrouted, stations };
}

export { unroutedDishes };

export async function publishLocation(ctx: TenantContext, locationId: string, confirmed: boolean, confirmUnrouted = false) {
  if (!confirmed) throw new UserFacingError('Please confirm you reviewed the menu, prices and allergen information.');
  const { blockers, unrouted, stations } = await publishChecks(ctx, locationId);
  if (blockers.length) throw new UserFacingError(blockers[0]);
  // Publishing turns ordering on: dishes guests will see but cannot order need an explicit OK.
  if (stations > 0 && unrouted.length > 0 && !confirmUnrouted) {
    throw new UserFacingError(
      `${unrouted.length} visible dishes have no switched-on station at this location, so guests cannot order them here. Assign a station, mark items that need none as “No preparation” (Kitchen stations), or confirm to publish without them.`,
    );
  }
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
