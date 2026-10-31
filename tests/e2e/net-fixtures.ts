import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

/**
 * Outbound requests made by the TEST server (Glovo store pages, photos copied at save time) are
 * answered from this folder instead of the internet: scripts/test-server.mjs sets
 * TEST_FETCH_FIXTURES to the manifest below, and src/server/import/safe-fetch.ts reads it.
 * Requests made by the browser itself (thumbnails) are answered with page.route().
 */
const MANIFEST = path.resolve(process.env.E2E_FETCH_FIXTURES ?? 'storage/e2e-net/manifest.json');
const DIR = path.dirname(MANIFEST);

export function addNetFixture(url: string, res: { status?: number; contentType: string; body: Buffer | string; location?: string }) {
  mkdirSync(DIR, { recursive: true });
  const file = createHash('sha1').update(url).digest('hex').slice(0, 20);
  writeFileSync(path.join(DIR, file), res.body);
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, unknown>;
  } catch {
    // first fixture
  }
  // `location` answers a redirect, which is how a Google Maps short link is resolved.
  manifest[url] = { status: res.status ?? 200, contentType: res.contentType, file, ...(res.location ? { location: res.location } : {}) };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

/** A real PNG of one colour (with a lighter band so thumbnails look like photos in screenshots). */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    const light = y > height * 0.55 && y < height * 0.75 ? 40 : 0;
    for (let x = 0; x < width; x++) {
      const o = y * row + 1 + x * 3;
      raw[o] = Math.min(255, r + light);
      raw[o + 1] = Math.min(255, g + light);
      raw[o + 2] = Math.min(255, b + light);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Serves Glovo CDN photos to the browser from memory. Paths containing "broken" fail like a
 * missing photo would, to prove the placeholder only appears when a photo really cannot load.
 */
export async function routeGlovoImages(page: Page, images: Map<string, Buffer>) {
  await page.route('https://images.deliveryhero.io/**', (route) => {
    const u = new URL(route.request().url());
    const id = u.pathname.split('/').pop() ?? '';
    const body = images.get(id);
    if (!body || id.includes('broken')) return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'image/png', body });
  });
}

export const shots = !!process.env.E2E_SCREENSHOTS;
export async function screenshot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
}
