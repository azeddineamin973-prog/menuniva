import 'server-only';
import { logError } from './audit';

/**
 * Largest picture MenuNiva decodes: 64 megapixels (8000 × 8000). Phone and camera photos that fit
 * the upload size limit are far below it. A small file that unpacks into a gigantic picture (a
 * "decompression bomb") is refused at upload and never decoded, instead of using gigabytes of
 * memory on a server with 2 GB.
 */
export const MAX_INPUT_PIXELS = 64_000_000;

type Sharp = (typeof import('sharp'))['default'];
let sharpModule: Promise<Sharp | null> | null = null;

/**
 * The image library, loaded on first use. Null when it is unavailable on this platform: callers
 * then skip the image work (photos are served as uploaded) instead of failing.
 */
export function loadSharp() {
  sharpModule ??= import('sharp')
    .then((m) => {
      const sharp = m.default;
      // Every photo is different: libvips' operation cache would only hold memory.
      sharp.cache(false);
      return sharp;
    })
    .catch(async (e) => {
      await logError('media-variant-sharp', e);
      return null;
    });
  return sharpModule;
}

/** Width × height read from the image header (nothing is decoded), or null when unknown. */
export async function imagePixels(buf: Buffer): Promise<number | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const m = await sharp(buf, { limitInputPixels: false }).metadata();
    return m.width && m.height ? m.width * m.height : null;
  } catch {
    return null;
  }
}
