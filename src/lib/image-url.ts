/**
 * Addresses of product photos found by an import, shared by the server (copying a photo into
 * MenuNiva storage) and the browser (preview thumbnails). Pure functions, no network access.
 */

/** Image CDNs that resize on request through a `width` query parameter (Glovo uses Delivery Hero's). */
const RESIZING_HOSTS = /(^|\.)images\.deliveryhero\.io$/i;

/** Width of the thumbnails on the review screen (2× their displayed size, for sharp screens). */
export const THUMBNAIL_WIDTH = 160;

/**
 * A photo served by MenuNiva itself: `/media/<organization>/<folder>/<random>.<ext>`. Same shape
 * as MEDIA_KEY in src/server/storage.ts (which is server-only); a unit test keeps them in step.
 */
const MEDIA_PATH = /^\/media\/[a-z0-9]+\/(branding|products)\/[A-Za-z0-9_-]{22}\.(png|jpg|webp)$/;

/**
 * Address for showing a photo in the browser. MenuNiva's own photos are same-site paths and are
 * used as they are; platform photos go through `sizedImageUrl`. Anything else returns null.
 */
export function displayImageUrl(raw: string | null | undefined, width: number): string | null {
  if (raw && MEDIA_PATH.test(raw)) return raw;
  return sizedImageUrl(raw, width);
}

/**
 * The https address of a photo at a given width. Resizing CDNs get a `width` parameter; other
 * hosts are returned unchanged. Anything that is not a valid https address returns null, so a
 * page never loads an insecure or malformed image.
 */
export function sizedImageUrl(raw: string | null | undefined, width: number): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (RESIZING_HOSTS.test(url.hostname)) url.searchParams.set('width', String(Math.round(width)));
  return url.toString();
}
