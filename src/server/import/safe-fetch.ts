import 'server-only';
import { lookup as dnsLookup } from 'node:dns';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { env } from '../env';

/**
 * SSRF-safe HTTPS fetching for URL imports (Part 25):
 * - https only, default port, no credentials in the URL,
 * - every resolved address must be public (checked inside the socket's DNS lookup, so DNS
 *   rebinding between check and connect is not possible),
 * - at most 3 redirects, each re-validated,
 * - 10 s timeout and a response-size cap.
 */

export class UnsafeUrlError extends Error {}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
  }
  return true;
}

export function validatePublicUrl(raw: string, allowedHosts?: RegExp): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('This is not a valid link.');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Only https:// links are accepted.');
  if (url.username || url.password) throw new UnsafeUrlError('Links with passwords are not accepted.');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('Links with a custom port are not accepted.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError('Private network addresses are not accepted.');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new UnsafeUrlError('Private network addresses are not accepted.');
  if (allowedHosts && !allowedHosts.test(host)) throw new UnsafeUrlError('This link is not from the expected website.');
  return url;
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as unknown as { address: string; family: number }[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) return callback(new UnsafeUrlError('This link points to a private network address.') as NodeJS.ErrnoException, '', 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  allowedHosts?: RegExp;
  userAgent?: string;
  accept?: string;
  /** HEAD asks for headers only; useful for resolving a redirect without downloading a page. */
  method?: 'GET' | 'HEAD';
  /** false returns the 3xx itself (with `location`) instead of following it. Default true. */
  followRedirects?: boolean;
};

export type SafeFetchResult = {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
  /** The validated absolute `Location` of a 3xx, when the redirect was not followed. */
  location?: string;
};

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  // Requests always identify MenuNiva; no caller may disguise them as a browser.
  const userAgent = opts.userAgent?.startsWith('MenuNiva') ? opts.userAgent : 'MenuNiva-Import/1.0';
  const method = opts.method ?? 'GET';
  const follow = opts.followRedirects !== false;
  let url = validatePublicUrl(raw, opts.allowedHosts);
  if (env.APP_ENV === 'test' && env.TEST_FETCH_FIXTURES) return fixtureResponse(url, env.TEST_FETCH_FIXTURES, maxBytes);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const res = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
      const req = https.request(url, { method, lookup: safeLookup, timeout: opts.timeoutMs ?? 10_000, headers: { 'User-Agent': userAgent, Accept: opts.accept ?? '*/*' } }, (r) => {
        const chunks: Buffer[] = [];
        let size = 0;
        r.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new UnsafeUrlError('The file is too large.'));
            return;
          }
          chunks.push(c);
        });
        r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks) }));
        r.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new UnsafeUrlError('The website did not respond in time.')));
      req.on('error', reject);
      req.end();
    });
    const redirecting = res.status >= 300 && res.status < 400 && !!res.headers.location;
    if (redirecting) {
      // The target is validated either way, so a caller reading `location` never receives a
      // private-network or non-https address.
      const target = validatePublicUrl(new URL(String(res.headers.location), url).toString(), opts.allowedHosts);
      if (follow) {
        url = target;
        continue;
      }
      return { status: res.status, contentType: String(res.headers['content-type'] ?? ''), body: res.body, finalUrl: url.toString(), location: target.toString() };
    }
    return { status: res.status, contentType: String(res.headers['content-type'] ?? ''), body: res.body, finalUrl: url.toString() };
  }
  throw new UnsafeUrlError('Too many redirects.');
}

type Fixture = { status?: number; contentType?: string; file?: string; body?: string; location?: string };

/**
 * Browser-test seam (APP_ENV=test with TEST_FETCH_FIXTURES only; env.ts refuses the variable in
 * any other environment). Every outbound request is answered from a JSON manifest
 * `{ "<url>": { status, contentType, file | body } }`, so the browser suite exercises the real
 * import code without reaching the internet. URL validation above still runs first.
 * The manifest is read per request so a test can add fixtures while the server is running.
 */
function fixtureResponse(url: URL, manifestFile: string, maxBytes: number) {
  const manifestPath = path.resolve(manifestFile);
  let manifest: Record<string, Fixture> = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, Fixture>;
  } catch {
    // no fixtures written yet
  }
  const f = manifest[url.toString()] ?? manifest[`${url.origin}${url.pathname}`];
  const finalUrl = url.toString();
  if (!f) return { status: 404, contentType: 'text/plain', body: Buffer.from('No test fixture for this URL'), finalUrl };
  const body = f.file ? readFileSync(path.resolve(path.dirname(manifestPath), f.file)) : Buffer.from(f.body ?? '', 'utf8');
  if (body.length > maxBytes) throw new UnsafeUrlError('The file is too large.');
  return { status: f.status ?? 200, contentType: f.contentType ?? 'application/octet-stream', body, finalUrl, location: f.location };
}
