import type { OpeningHours } from '@/lib/opening-hours';

/**
 * Where a discovered value came from. Shown next to every field so the owner can judge it
 * instead of trusting an unexplained guess.
 */
export type DiscoverySource = 'website' | 'osm' | 'google_places' | 'maps_link' | 'input';

export const SOURCE_LABEL: Record<DiscoverySource, string> = {
  website: 'Your website',
  osm: 'OpenStreetMap',
  google_places: 'Google Places',
  maps_link: 'Google Maps link',
  input: 'What you typed',
};

/** One discovered value, with where it came from and how sure we are. */
export type Found<T> = {
  value: T;
  source: DiscoverySource;
  /** 'high' = stated explicitly by the source; 'medium' = read from page text or a nearby match. */
  confidence: 'high' | 'medium';
  /** Other sources that gave a different value for this field, for the owner to compare. */
  alternatives?: { value: T; source: DiscoverySource }[];
};

/** Everything the discovery step can fill in. Missing stays missing — nothing is invented. */
export type RestaurantProfile = {
  name?: Found<string>;
  addressLine1?: Found<string>;
  postalCode?: Found<string>;
  city?: Found<string>;
  phone?: Found<string>;
  whatsappNumber?: Found<string>;
  email?: Found<string>;
  websiteUrl?: Found<string>;
  openingHours?: Found<OpeningHours>;
  instagramUrl?: Found<string>;
  facebookUrl?: Found<string>;
  tiktokUrl?: Found<string>;
  glovoUrl?: Found<string>;
  uberEatsUrl?: Found<string>;
  googleReviewUrl?: Found<string>;
  /** Kitchen/cuisine type, e.g. "moroccan" — a hint for the owner, never published on its own. */
  cuisine?: Found<string>;
  /** Short description from the site's own meta description. */
  description?: Found<string>;
  latitude?: Found<number>;
  longitude?: Found<number>;
};

export type ProfileKey = keyof RestaurantProfile;

/** What each source contributed and whether it worked, so a failure is explained rather than silent. */
export type SourceReport = {
  source: DiscoverySource;
  status: 'ok' | 'nothing_found' | 'failed' | 'not_configured';
  /** Plain-language detail for the owner. */
  detail: string;
  fields: ProfileKey[];
};

export type DiscoveryResult = {
  profile: RestaurantProfile;
  reports: SourceReport[];
};

/** A raw, unattributed set of values from one source, before merging. */
export type RawProfile = Partial<{
  name: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  phone: string;
  whatsappNumber: string;
  email: string;
  websiteUrl: string;
  openingHours: OpeningHours;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  glovoUrl: string;
  uberEatsUrl: string;
  googleReviewUrl: string;
  cuisine: string;
  description: string;
  latitude: number;
  longitude: number;
}>;
