import { CONTENT_TYPES, storage } from '@/server/storage';

// Public restaurant media (logos, covers, dish photos). Keys are random and contain no private data.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const joined = key.join('/');
  if (!/^[a-z0-9]+\/(branding|products)\/[A-Za-z0-9_-]{22}\.(png|jpg|webp)$/.test(joined)) return new Response('Not found', { status: 404 });
  const data = await storage.get(joined);
  if (!data) return new Response('Not found', { status: 404 });
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
