import 'server-only';
import type { MediaFormat, MediaWidth } from '@/lib/media';
import { logError } from './audit';
import { loadSharp, MAX_INPUT_PIXELS } from './image-lib';
import { CONTENT_TYPES, storage, variantKey } from './storage';

/**
 * Right-sized AVIF/WebP copies of tenant photos, made on first request and stored next to the
 * original (`<key>.w<width>.<format>`), so each copy is encoded once.
 *
 * - The original is never modified or re-saved; it remains the fallback for old browsers.
 * - Copies are never larger than the original's own width (no upscaling), keep transparency,
 *   follow the photo's EXIF orientation and drop all metadata (camera data, GPS position).
 * - Quality was chosen on the restaurants' own photos (audit/perf/image-bench.mjs): at the same
 *   or better fidelity (PSNR) than a standard JPEG resize at quality 82, AVIF copies are 24–34 %
 *   smaller than that JPEG, WebP copies from 5 % larger (160 px) to 13 % smaller (960 px); a
 *   480 px AVIF copy is about a fifth of the original download.
 * - `sharp` is loaded lazily: if it is unavailable on a platform, variant requests fall back to
 *   the original image and plain /media requests are not affected at all.
 * - Cost bounds: at most MAX_ENCODES photos are decoded at once per process (a menu's first view
 *   asks for dozens of copies at the same moment), pictures above MAX_INPUT_PIXELS are never
 *   decoded, and a copy that is not worth keeping is remembered so it is not encoded again.
 */
const QUALITY = { webp: { quality: 82, effort: 4 }, avif: { quality: 62, effort: 3 } } as const;

export type MediaBody = { body: Buffer; contentType: string };

/** Concurrent requests for the same copy share one encode. */
const inflight = new Map<string, Promise<MediaBody | null>>();
/** Unexpected failures are logged once per process, not once per image request. */
const reported = new Set<string>();

/**
 * Encodes running at once in this process; the others wait their turn. Each one holds a decoded
 * photo and the encoder's buffers (tens to hundreds of MB): unbounded, a first view of a menu with
 * many new photos could exhaust a 2 GB serverless instance.
 */
const MAX_ENCODES = 2;
let encoding = 0;
const queue: (() => void)[] = [];
async function withEncodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (encoding < MAX_ENCODES) encoding++;
  else await new Promise<void>((resolve) => queue.push(resolve)); // the finishing encode hands over its slot
  try {
    return await fn();
  } finally {
    const next = queue.shift();
    if (next) next();
    else encoding--;
  }
}

/**
 * Copies that are not worth making: no smaller than the original, or the original cannot be
 * decoded (too large, damaged). The original is served for them without encoding again.
 */
const useOriginal = new Set<string>();
function rememberOriginal(vkey: string) {
  if (useOriginal.size >= 20_000) useOriginal.clear();
  useOriginal.add(vkey);
}

/**
 * Set when storage refused an AVIF file because of its type (a Supabase bucket that only allows
 * PNG, JPEG and WebP; docs/DEPLOYMENT.md asks for image/avif too). From then on this process
 * answers AVIF requests with the WebP copy, which can be stored: photos stay right-sized and
 * nothing is encoded again on every request. Browsers that take AVIF all take WebP.
 */
let avifRefused = false;
const TYPE_REFUSED = /invalid_mime_type|mime type|HTTP 415/i;

/**
 * The copy of `key` at `width` in `format`, or null when the original does not exist.
 * When the copy cannot be made (unreadable original, image library unavailable) the original is
 * returned instead: a photo is never broken by its optimisation.
 */
export async function mediaVariant(key: string, width: MediaWidth, requested: MediaFormat): Promise<MediaBody | null> {
  const format = requested === 'avif' && avifRefused ? 'webp' : requested;
  const vkey = variantKey(key, width, format);
  const stored = await storage.get(vkey);
  if (stored) return { body: stored, contentType: CONTENT_TYPES[format] };
  const running = inflight.get(vkey);
  if (running) return running;
  const job = makeVariant(key, vkey, width, format).finally(() => inflight.delete(vkey));
  inflight.set(vkey, job);
  return job;
}

async function makeVariant(key: string, vkey: string, width: MediaWidth, format: MediaFormat): Promise<MediaBody | null> {
  const original = await storage.get(key);
  if (!original) return null;
  const fallback = { body: original, contentType: CONTENT_TYPES[key.split('.').pop()!] };
  if (useOriginal.has(vkey)) return fallback;
  const sharp = await loadSharp();
  if (!sharp) return fallback;
  let body: Buffer;
  try {
    body = await withEncodeSlot(() => {
      const pipeline = sharp(original, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .timeout({ seconds: 20 });
      return (format === 'avif' ? pipeline.avif(QUALITY.avif) : pipeline.webp(QUALITY.webp)).toBuffer();
    });
  } catch (e) {
    // A file the library cannot decode is served as it is (browsers may still show it).
    const msg = e instanceof Error ? e.message : String(e);
    if (!/unsupported image format|corrupt|premature end|invalid/i.test(msg) && !reported.has(msg)) {
      reported.add(msg);
      await logError('media-variant-encode', e, { key });
    }
    rememberOriginal(vkey);
    return fallback;
  }
  // A copy bigger than the original (tiny or already well-compressed images) is not worth it.
  if (body.length >= original.length) {
    rememberOriginal(vkey);
    return fallback;
  }
  try {
    await storage.put(vkey, body, CONTENT_TYPES[format]);
  } catch (e) {
    // Another server instance stored the same copy first, or storage is briefly unavailable:
    // the copy just made is still served; it will be stored on a later request.
    const msg = e instanceof Error ? e.message : String(e);
    if (format === 'avif' && TYPE_REFUSED.test(msg)) {
      if (!avifRefused) {
        avifRefused = true;
        await logError('media-variant-store', new Error('Storage refuses AVIF files; serving WebP copies instead. Allow image/avif in the bucket (docs/DEPLOYMENT.md).'), { cause: msg.slice(0, 200) });
      }
    } else if (!/EEXIST|409|already exists|Duplicate/i.test(msg) && !reported.has(msg)) {
      reported.add(msg);
      await logError('media-variant-store', e, { key: vkey });
    }
  }
  return { body, contentType: CONTENT_TYPES[format] };
}
