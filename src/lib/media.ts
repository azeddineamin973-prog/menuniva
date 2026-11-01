/**
 * Responsive variants of MenuNiva's own photos (`/media/...`).
 *
 * The original upload is never changed. A variant (a resized AVIF or WebP copy) is made by the
 * server the first time a browser asks for it, stored next to the original, and served from then
 * on (see src/server/media-variants.ts). Browsers pick the smallest copy that is sharp enough for
 * the space on screen: a dish tile on a phone loads an 18 KB copy instead of the 150 KB photo.
 *
 * Pure functions, safe in server and client components.
 */

/** Widths a variant can have. A fixed list bounds how many copies one photo can ever get. */
export const MEDIA_WIDTHS = [160, 320, 480, 640, 960, 1280, 1920] as const;
export type MediaWidth = (typeof MEDIA_WIDTHS)[number];

/** AVIF first (smallest), WebP for browsers without AVIF; the original stays the last fallback. */
export const MEDIA_FORMATS = ['avif', 'webp'] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

/** Same shape as MEDIA_KEY in src/server/storage.ts (server-only); a unit test keeps them in step. */
const OWN_MEDIA = /^\/media\/[a-z0-9]+\/(branding|products)\/[A-Za-z0-9_-]{22}\.(png|jpg|webp)$/;

/** True for photos stored by MenuNiva (the only ones that have variants). */
export function isOwnMedia(url: string | null | undefined): url is string {
  return !!url && OWN_MEDIA.test(url);
}

export function isMediaWidth(n: number): n is MediaWidth {
  return (MEDIA_WIDTHS as readonly number[]).includes(n);
}

export function isMediaFormat(f: string | null): f is MediaFormat {
  return f !== null && (MEDIA_FORMATS as readonly string[]).includes(f);
}

export function mediaVariantUrl(url: string, width: MediaWidth, format: MediaFormat) {
  return `${url}?w=${width}&f=${format}`;
}

/** `srcset` value for one format, e.g. "/media/…jpg?w=320&f=avif 320w, …". */
export function mediaSrcSet(url: string, format: MediaFormat, widths: readonly MediaWidth[]) {
  return widths.map((w) => `${mediaVariantUrl(url, w, format)} ${w}w`).join(', ');
}
