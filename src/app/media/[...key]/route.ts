import { logError } from '@/server/audit';
import { CONTENT_TYPES, MEDIA_KEY, storage } from '@/server/storage';

// Public restaurant media (logos, covers, dish photos). Keys are random and contain no private data.
// With STORAGE_DRIVER=supabase the bucket stays private: this route reads it server-side.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const joined = key.join('/');
  if (!MEDIA_KEY.test(joined)) return new Response('Not found', { status: 404 });
  let data: Buffer | null;
  try {
    data = await storage.get(joined);
  } catch (e) {
    await logError('media-read', e, { key: joined });
    return new Response('Temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
  if (!data) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const ext = joined.split('.').pop()!;
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': CONTENT_TYPES[ext],
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
