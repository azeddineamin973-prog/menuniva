'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { applyDiscoveredProfile, discoverRestaurant } from '@/server/discovery/service';

const R = { revalidate: '/dashboard/[org]' };

/** Looks the restaurant up from whatever the owner has. Saves nothing. */
export async function discoverRestaurantAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'settings.manage', (ctx) =>
    discoverRestaurant(ctx, {
      locationId: form.get('locationId'),
      mapsUrl: String(form.get('mapsUrl') ?? '').trim() || undefined,
      websiteUrl: String(form.get('websiteUrl') ?? '').trim() || undefined,
      name: String(form.get('name') ?? '').trim() || undefined,
      city: String(form.get('city') ?? '').trim() || undefined,
    }),
  );
}

/** Saves what the owner confirmed on the review screen. */
export async function applyDiscoveryAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'settings.manage',
    (ctx) =>
      applyDiscoveredProfile(ctx, {
        locationId: form.get('locationId'),
        name: form.get('name'),
        addressLine1: form.get('addressLine1'),
        postalCode: form.get('postalCode'),
        city: form.get('city'),
        phone: form.get('phone'),
        whatsappNumber: form.get('whatsappNumber'),
        email: form.get('email'),
        openingHours: form.get('openingHours') || undefined,
        websiteUrl: form.get('websiteUrl'),
        instagramUrl: form.get('instagramUrl'),
        facebookUrl: form.get('facebookUrl'),
        tiktokUrl: form.get('tiktokUrl'),
        glovoUrl: form.get('glovoUrl'),
        uberEatsUrl: form.get('uberEatsUrl'),
        googleReviewUrl: form.get('googleReviewUrl'),
      }),
    R,
  );
}
