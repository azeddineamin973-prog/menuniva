import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { env } from './env';

/**
 * Who is calling a public endpoint — for throttling only (audit BUG-05).
 *
 * 1. Client IP. `X-Forwarded-For` is written by whoever sends the request, so it is trusted ONLY
 *    as far as the deployment says: TRUST_PROXY_HOPS = number of reverse proxies in front of the
 *    app that APPEND the address they saw (nginx `proxy_add_x_forwarded_for`, Caddy, most load
 *    balancers). The client IP is then the entry that many positions from the right. With 0 (the
 *    default, e.g. `next start` exposed directly or local development) the header is ignored and
 *    the IP is unknown: Next.js keeps a client-supplied header and gives no other way to read the
 *    socket address.
 * 2. Guest id. A random, httpOnly, first-party cookie (`mn_guest`) set by src/proxy.ts when a
 *    guest opens a menu page; requests without it get a one-off id. It separates guests who share a restaurant Wi-Fi and phone model. It is NOT proof of
 *    identity: a guest can delete it, so per-IP, per-table and per-location limits still apply.
 * Raw IPs are never stored in rate-limit keys (salted hash).
 */
export const GUEST_COOKIE = 'mn_guest';
const GUEST_RE = /^[A-Za-z0-9_-]{22}$/;
/**
 * `ip` is a salted hash of the client's NETWORK: the full IPv4 address, or the /64 prefix of an IPv6
 * address (one household or phone gets a whole /64 and can rotate within it freely; audit V4, Q08).
 * `cookieless` marks a request without a valid guest cookie (its `guest` id is single-use).
 */
export type ClientIdentity = { guest: string; ip: string | null; cookieless?: boolean };

/** Throttling key of an address: IPv4 as is, IPv6 by its /64 network (first four groups). */
export function networkKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export function trustedClientIp(headers: Headers, hops = env.TRUST_PROXY_HOPS ?? 0): string | null {
  if (!hops) return null;
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length < hops) return null;
  const ip = chain[chain.length - hops].replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return isIP(ip) ? ip : null;
}

const hash = (v: string) => createHash('sha256').update(`${env.APP_SECRET}|${v}`).digest('base64url').slice(0, 22);

export const newGuestId = () => randomBytes(16).toString('base64url');

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Identity of a public request. `issued` is set when the request had no guest cookie yet. */
export function clientIdentity(req: Request): { identity: ClientIdentity; issued: string | null } {
  const cookie = cookieValue(req, GUEST_COOKIE);
  const valid = cookie && GUEST_RE.test(cookie) ? cookie : null;
  const guest = valid ?? newGuestId();
  const ip = trustedClientIp(req.headers);
  return { identity: { guest: `g_${hash(guest)}`, ip: ip ? `ip_${hash(networkKey(ip))}` : null, cookieless: !valid }, issued: valid ? null : guest };
}

/** Accepts the legacy string key used by scripts/tests (treated as the guest id). */
export function asIdentity(client: string | ClientIdentity): ClientIdentity {
  return typeof client === 'string' ? { guest: client, ip: null } : client;
}
