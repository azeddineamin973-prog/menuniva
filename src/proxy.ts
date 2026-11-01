import { NextResponse, type NextRequest } from 'next/server';

/**
 * Issues the anonymous guest cookie (`mn_guest`) when a guest opens a menu, order, feedback or
 * reservation page, so each phone gets its own throttling bucket even on a shared restaurant
 * Wi-Fi (audit BUG-05). The cookie is random, httpOnly and first-party; it identifies a browser
 * for rate limiting only — it is not a login and the guest can delete it at any time.
 * Must stay in sync with GUEST_COOKIE / guestCookieOptions in src/server/client-identity.ts.
 */
const GUEST_COOKIE = 'mn_guest';
const VALID = /^[A-Za-z0-9_-]{22}$/;

function newGuestId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function proxy(request: NextRequest) {
  const res = NextResponse.next();
  const current = request.cookies.get(GUEST_COOKIE)?.value;
  if (!current || !VALID.test(current)) {
    res.cookies.set(GUEST_COOKIE, newGuestId(), {
      httpOnly: true,
      sameSite: 'lax',
      // Secure whenever the page itself is https (also on Vercel when APP_BASE_URL is left unset).
      secure: request.nextUrl.protocol === 'https:' || (process.env.APP_BASE_URL ?? '').startsWith('https://'),
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}

export const config = { matcher: ['/t/:path*', '/r/:path*', '/o/:path*', '/reservation/:path*'] };
