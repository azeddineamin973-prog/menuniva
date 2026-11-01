// Resized photo copies (AVIF/WebP) against the REAL Supabase Storage bucket, in a fresh Node
// process like a cold serverless start.
//   npx tsx --conditions=react-server audit/storage-variants-check.mts
// Uses only the TEST database and a temporary bucket folder test-tmp/variants-<time>/ that is
// emptied at the end (the app refuses other folders with APP_ENV=test). Real restaurant files
// cannot be touched. The secret key is never printed.
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ quiet: true });
const TEST_DB = process.env.TEST_DATABASE_URL ?? '';
if (!TEST_DB.includes('menuniva_test')) throw new Error('TEST_DATABASE_URL must point to menuniva_test');
const PREFIX = `test-tmp/variants-${Date.now()}/`;
Object.assign(process.env, {
  APP_ENV: 'test',
  DATABASE_URL: TEST_DB,
  APP_SECRET: process.env.APP_SECRET || 'variants-check-secret-variants-check-1234',
  STORAGE_DRIVER: 'supabase',
  SUPABASE_STORAGE_PREFIX: PREFIX,
});
const t0 = performance.now();
const { storage, variantKey } = await import('../src/server/storage.ts');
const { GET } = await import('../src/app/media/[...key]/route.ts');
const { deleteTenantMedia } = await import('../src/server/media.ts');
const { db } = await import('../src/server/db.ts');
const sharp = (await import('sharp')).default;
const importMs = Math.round(performance.now() - t0);

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push([name, ok, note]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`);
};
const rnd = () => Array.from({ length: 22 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
const ORG_A = `cmlivea${Date.now().toString(36)}`;
const ORG_B = `cmliveb${Date.now().toString(36)}`;
async function photo(w: number, h: number) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(1.2).jpeg({ quality: 88 }).toBuffer();
}
async function get(key: string, query: string) {
  const s = performance.now();
  const res = await GET(new Request(`http://localhost/media/${key}${query}`), { params: Promise.resolve({ key: key.split('/') }) });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type'), body, ms: Math.round(performance.now() - s) };
}
async function listFolder(): Promise<string[]> {
  const url = process.env.SUPABASE_URL!;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'restaurant-media';
  const headers = { apikey: process.env.SUPABASE_SECRET_KEY!, 'Content-Type': 'application/json' };
  async function list(prefix: string): Promise<string[]> {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, { method: 'POST', headers, body: JSON.stringify({ prefix: prefix.replace(/\/$/, ''), limit: 1000 }) });
    if (!res.ok) throw new Error(`list failed: HTTP ${res.status}`);
    const out: string[] = [];
    for (const e of (await res.json()) as { name: string; id: string | null }[]) out.push(...(e.id ? [`${prefix}${e.name}`] : await list(`${prefix}${e.name}/`)));
    return out;
  }
  return list(PREFIX);
}
async function lastStoreLog() {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  try {
    const r = await c.query(`SELECT message, context FROM "ErrorLog" WHERE source = 'media-variant-store' ORDER BY "createdAt" DESC LIMIT 1`);
    return r.rows[0] as { message: string; context: { cause?: string } } | undefined;
  } finally {
    await c.end();
  }
}

const created: string[] = [];
try {
  const original = await photo(1200, 900);
  const key = `${ORG_A}/products/${rnd()}.jpg`;
  await storage.put(key, original, 'image/jpeg');
  created.push(key);
  check('original stored in the bucket and read back byte for byte', (await storage.get(key))?.equals(original) === true, `${Math.round(original.length / 1024)} KB`);

  const rss0 = process.memoryUsage().rss;
  const w1 = await get(key, '?w=640&f=webp');
  check('first WebP request in a fresh process: resized copy made and served', w1.status === 200 && w1.type === 'image/webp' && (await sharp(w1.body).metadata()).width === 640, `${w1.ms} ms incl. download, encode, upload; module load ${importMs} ms; ${Math.round(w1.body.length / 1024)} KB`);
  const stored = await storage.get(variantKey(key, 640, 'webp'));
  check('the WebP copy is stored next to the original in the bucket', !!stored && stored.equals(w1.body));
  const w2 = await get(key, '?w=640&f=webp');
  check('second request reads the stored copy (no encode)', w2.status === 200 && w2.body.equals(w1.body), `${w2.ms} ms`);

  const a1 = await get(key, '?w=640&f=avif');
  const log = await lastStoreLog();
  const refused = !!log && /refuses AVIF/.test(log.message);
  check(
    refused ? 'bucket refuses AVIF (allowed types: PNG/JPEG/WebP): the AVIF copy is still served once and the refusal is logged once' : 'AVIF copy accepted by the bucket and stored',
    a1.status === 200 && a1.type === 'image/avif',
    refused ? `Supabase answered: ${log!.context?.cause?.slice(0, 160)}` : `${a1.ms} ms`,
  );
  const a2 = await get(key, '?w=640&f=avif');
  if (refused) check('later AVIF requests get the stored WebP copy instead of a new encode', a2.status === 200 && a2.type === 'image/webp' && a2.body.equals(w1.body), `${a2.ms} ms`);
  else check('the stored AVIF copy is served', a2.status === 200 && a2.type === 'image/avif' && !!(await storage.get(variantKey(key, 640, 'avif'))), `${a2.ms} ms`);

  // A menu's first view asks for many copies at once: they are all served, two encodes at a time.
  const widths = [160, 320, 480, 960, 1280, 1920] as const;
  const s = performance.now();
  const many = await Promise.all(widths.map((w) => get(key, `?w=${w}&f=webp`)));
  const rss1 = process.memoryUsage().rss;
  check('six different copies requested at the same moment are all served', many.every((r) => r.status === 200 && r.type === 'image/webp'), `${Math.round(performance.now() - s)} ms for all; process memory ${Math.round(rss0 / 1048576)} → ${Math.round(rss1 / 1048576)} MB`);

  // Tenant isolation and deletion.
  const other = `${ORG_B}/products/${rnd()}.jpg`;
  await storage.put(other, original, 'image/jpeg');
  created.push(other);
  await get(other, '?w=320&f=webp');
  await deleteTenantMedia(ORG_A, [`/media/${other}`], { force: true });
  check("deleting through another restaurant's account leaves the photo and its copy in place", !!(await storage.get(other)) && !!(await storage.get(variantKey(other, 320, 'webp'))));
  await deleteTenantMedia(ORG_A, [`/media/${key}`], { force: true });
  const leftA = (await listFolder()).filter((n) => n.includes(`${ORG_A}/`));
  check('deleting the photo removes the original and every copy from the bucket', leftA.length === 0, `${leftA.length} object(s) left`);
  check('a deleted photo is not served at any size', (await get(key, '')).status === 404 && (await get(key, '?w=640&f=webp')).status === 404);
} finally {
  // Empty the temporary folder whatever happened.
  const names = await listFolder();
  if (names.some((n) => !n.startsWith(PREFIX))) throw new Error('listing returned objects outside the test folder; stopping');
  const keys = names.map((n) => n.slice(PREFIX.length));
  if (keys.length) await storage.deleteMany(keys);
  const left = await listFolder();
  check('temporary bucket folder emptied', left.length === 0, `${names.length} object(s) removed`);
  await db.$disconnect();
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
