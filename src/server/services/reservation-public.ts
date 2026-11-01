import 'server-only';
import { db } from '../db';
import { hasModule } from '../modules';
import { canPreviewOrg } from './storefront';

/**
 * The location a public reservation endpoint (times, tables) answers for: a published location
 * that takes reservations, or, for a signed-in member previewing a draft (`preview=1`), any of its
 * locations. Null for everything else, so drafts never leak through these endpoints.
 */
export async function publicReservationLocation(orgSlug: string, locationSlug: string | null, previewRequested: boolean) {
  const org = await db.restaurantOrganization.findUnique({ where: { slug: orgSlug } });
  if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED') return null;
  if (!(await hasModule(org.id, 'reservations'))) return null;
  const preview = await canPreviewOrg(org.id, previewRequested);
  return db.restaurantLocation.findFirst({
    where: { organizationId: org.id, ...(preview ? {} : { isPublished: true }), reservationsEnabled: true, ...(locationSlug ? { slug: locationSlug } : {}) },
    include: { reservationSettings: true },
    orderBy: { createdAt: 'asc' },
  });
}
