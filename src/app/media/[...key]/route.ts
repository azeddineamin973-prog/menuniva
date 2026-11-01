import { isMediaFormat, isMediaWidth } from '@/lib/media';
import { logError } from '@/server/audit';
import { mediaVariant, type MediaBody } from '@/server/media-variants';
import { CONTENT_TYPES, MEDIA_KEY, storage } from '@/server/storage';

// Public restaurant media (logos, covers, dish photos). Keys are random and contain no private data.
// With STORAGE_DRIVER=supabase the bucket stays private: this route reads it server-side.
// `?w=<width>&f=<avif|webp>` asks for a resized copy (see src/server/media-variants.ts); only the
// widths and formats listed in src/lib/media.ts exist, anything else is refused.
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const joined = key.join('/');
  if (!MEDIA_KEY.test(joined)) return new Response('Not found', { status: 404 });
  const q = new URL(req.url).searchParams;
  // Only `w` and `f`, once each: CDNs cache by the full address, so any extra parameter would
  // create a new uncached address for the same image (and new work for the server) at will.
  if ([...q.keys()].some((k) => k !== 'w' && k !== 'f') || q.getAll('w').length > 1 || q.getAll('f').length > 1) return new Response('Unknown image size', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const wanted = q.has('w') || q.has('f');
  const width = Number(q.get('w'));
  const format = q.get('f');
  if (wanted && (!isMediaWidth(width) || !isMediaFormat(format))) return new Response('Unknown image size', { status: 400, headers: { 'Cache-Control': 'no-store' } });

  let found: MediaBody | null;
  try {
    if (wanted && isMediaWidth(width) && isMediaFormat(format)) found = await mediaVariant(joined, width, format);
    else {
      const data = await storage.get(joined);
      found = data && { body: data, contentType: CONTENT_TYPES[joined.split('.').pop()!] };
    }
  } catch (e) {
    await logError('media-read', e, { key: joined });
    return new Response('Temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
  // Keys are random and only become known once the file exists, so "not found" is final: shared
  // caches may keep it for 10 minutes instead of asking storage again for every repeat.
  if (!found) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=600' } });
  return new Response(new Uint8Array(found.body), {
    headers: {
      'Content-Type': found.contentType,
      // Browsers keep images for a year (keys never change). Shared CDNs (e.g. Vercel's) keep them
      // for a day, so a removed image stops being served at its old address within 24 hours.
      'Cache-Control': 'public, max-age=31536000, s-maxage=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
