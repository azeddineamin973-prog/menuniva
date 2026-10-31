import 'server-only';
import { rateLimit } from '../rate-limit';
import { safeFetch, UnsafeUrlError } from './safe-fetch';
import { parseGlovoCapture, parseGlovoStoreUrl } from './glovo';
import type { ParseResult } from './types';

/**
 * Reads a Glovo store page from the server and extracts its menu.
 *
 * A Glovo store page is server-rendered: the HTML it returns to an ordinary HTTPS client
 * already contains the whole catalogue — sections, dish names, descriptions, prices, photo
 * references and the full `attributeGroups` tree with its selection limits. No browser, no
 * session and no credential is involved, and the page is served to a plainly identified
 * client: MenuNiva sends its own User-Agent and never pretends to be Chrome.
 *
 * Scope and restraint, because this reads somebody else's site:
 * - only `glovoapp.com` store pages, only over https, only the exact page the owner pasted;
 * - one page per import, fetched when a signed-in owner asks for it — there is no crawler,
 *   no link following and no background refresh;
 * - rate limited per tenant;
 * - `Disallow` rules in Glovo's robots.txt are honoured (store pages are not disallowed);
 * - the result is reported honestly: a missing store, a changed layout or a blocked request
 *   each produce a plain explanation and zero items, never an invented menu.
 */

const HOSTS = /(^|\.)glovoapp\.com$/;
/** A big catalogue (a fast-food chain with every combo) reaches a few MB of HTML. */
const MAX_PAGE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
/** Paths Glovo asks automated clients to stay out of (robots.txt, checked 2026-10-31). */
const DISALLOWED = [/^\/embedded-web-views\//i, /\/order-tracking\/.*\/share/i, /^\/[a-z-]*\/?password-recovery/i];
/** Identifies MenuNiva honestly, with a page explaining the request. */
const USER_AGENT = 'MenuNiva-Import/1.0 (+https://menuniva.com/import-bot; restaurant menu import on request of the store owner)';

const failed = (error: string): ParseResult => ({ status: 'FAILED', extractionMethod: 'PUBLIC_PAGE', items: [], warnings: [], error });

/** Glovo answers an unknown store with a styled "page doesn't exist" screen, not a 404 status. */
function isStoreNotFoundPage(html: string): boolean {
  return /notFound|page you.re looking for|doesn.t exist|n[aã]o existe/i.test(html);
}

export type GlovoFetchOptions = {
  /** Tenant whose quota the request counts against. */
  organizationId: string;
  fetchPage?: (url: string) => Promise<{ status: number; body: Buffer; finalUrl: string }>;
};

async function defaultFetchPage(url: string) {
  const res = await safeFetch(url, { maxBytes: MAX_PAGE_BYTES, timeoutMs: TIMEOUT_MS, allowedHosts: HOSTS, userAgent: USER_AGENT });
  return { status: res.status, body: res.body, finalUrl: res.finalUrl };
}

/**
 * Fetches the store page the owner pasted and returns its menu. Never throws for an
 * unreachable or unexpected page: every failure comes back as a FAILED result with a reason
 * the restaurant owner can act on.
 */
export async function importGlovoMenuFromUrl(rawUrl: string, opts: GlovoFetchOptions): Promise<ParseResult & { storeUrl?: string }> {
  let store;
  try {
    store = parseGlovoStoreUrl(rawUrl);
  } catch (e) {
    return failed(e instanceof Error ? e.message : 'That is not a valid Glovo store link.');
  }
  const path = new URL(store.url).pathname;
  if (DISALLOWED.some((r) => r.test(path))) return failed('That Glovo address is not a store page.');

  // Reading another company's site stays a deliberate, infrequent action per restaurant.
  await rateLimit(`glovo:import:${opts.organizationId}`, 12, 3600);

  let page;
  try {
    page = await (opts.fetchPage ?? defaultFetchPage)(store.url);
  } catch (e) {
    if (e instanceof UnsafeUrlError) return failed(e.message);
    return failed('Glovo could not be reached. Check the link and your internet connection, then try again.');
  }
  if (page.status === 404 || page.status === 410) return failed(`Glovo has no store at that address. Open your restaurant on Glovo and copy the link from the browser.`);
  if (page.status === 403 || page.status === 429) return failed('Glovo declined the request for now. Wait a few minutes and try again, or upload your Glovo menu export instead.');
  if (page.status !== 200) return failed(`Glovo answered with an unexpected status (${page.status}). Try again later, or upload your Glovo menu export.`);

  const html = page.body.toString('utf8');
  const result = parseGlovoCapture(html);
  if (!result.items.length) {
    if (isStoreNotFoundPage(html)) {
      return failed(
        `Glovo shows "page doesn't exist" for ${store.slug}. The link may be mistyped, or the store may be closed or renamed on Glovo. Open your restaurant on Glovo, copy the address from the browser and paste it again.`,
      );
    }
    return failed(result.error ?? 'No dishes could be read from that Glovo page.');
  }
  return {
    ...result,
    extractionMethod: 'PUBLIC_PAGE',
    warnings: [`Read from ${store.url}`, ...result.warnings],
    storeUrl: store.url,
  };
}
