/**
 * The public address of a restaurant's guest menu. Built only from the tenant and location slugs
 * and the configured base URL (APP_BASE_URL), the same way the storefront builds its canonical
 * URL — so the link the owner shares is exactly the page guests land on.
 */

/** `/r/<restaurant>` for a single location, `/r/<restaurant>/<location>` when there are several. */
export function restaurantPath(orgSlug: string, locationSlug: string, multiLocation: boolean) {
  return `/r/${encodeURIComponent(orgSlug)}${multiLocation ? `/${encodeURIComponent(locationSlug)}` : ''}`;
}

export function restaurantUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * True when the base URL cannot be reached by guests (localhost, a private network address or
 * plain http). Links and QR codes built on it only work on this computer or network.
 */
export function isLocalBaseUrl(baseUrl: string) {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return true;
  }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:') return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0' || h === '::1') return true;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return true;
  }
  return false;
}

/** Display form without the scheme: "menuniva.com/r/casa-aurora". */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '');
}
