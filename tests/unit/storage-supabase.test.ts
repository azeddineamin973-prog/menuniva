import { describe, expect, it } from 'vitest';
import { storageProblems } from '@/server/env';
import { mediaKeyFromPath, SupabaseStorage } from '@/server/storage';

const URL_OK = 'https://abcdefghijklmnop.supabase.co';
const SECRET = 'sb_secret_unit-test-not-a-real-key';
const KEY = 'org1abc/branding/AbCdEfGhIjKlMnOpQrStUv.png';
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift() ?? new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Supabase Storage configuration', () => {
  it('local driver needs nothing', () => {
    expect(storageProblems({ STORAGE_DRIVER: 'local' })).toEqual([]);
    expect(storageProblems({})).toEqual([]);
  });
  it('supabase driver needs an https project URL and a server-side key', () => {
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: SECRET })).toEqual([]);
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: jwt('service_role') })).toEqual([]);
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_SECRET_KEY: SECRET })[0]).toMatch(/SUPABASE_URL/);
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'http://abc.supabase.co', SUPABASE_SECRET_KEY: SECRET })[0]).toMatch(/SUPABASE_URL/);
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: `${URL_OK}/rest/v1`, SUPABASE_SECRET_KEY: SECRET })[0]).toMatch(/SUPABASE_URL/);
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: URL_OK })[0]).toMatch(/SUPABASE_SECRET_KEY: required/);
  });
  it('refuses browser keys (publishable / legacy anon) in place of the secret key', () => {
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: 'sb_publishable_xyz' })[0]).toMatch(/publishable/);
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: jwt('anon') })[0]).toMatch(/not a Supabase secret key/);
    expect(storageProblems({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: 'random' })[0]).toMatch(/not a Supabase secret key/);
  });
});

describe('Supabase Storage folder prefix', () => {
  const ok = { STORAGE_DRIVER: 'supabase' as const, SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: SECRET };
  it('tests must write into test-tmp/…, and nothing else may', () => {
    expect(storageProblems({ ...ok, APP_ENV: 'test', SUPABASE_STORAGE_PREFIX: 'test-tmp/run-1/' })).toEqual([]);
    expect(storageProblems({ ...ok, APP_ENV: 'test' })[0]).toMatch(/tests must use a temporary folder/);
    expect(storageProblems({ ...ok, APP_ENV: 'test', SUPABASE_STORAGE_PREFIX: 'staging/' })[0]).toMatch(/tests must use/);
    expect(storageProblems({ ...ok, APP_ENV: 'production', SUPABASE_STORAGE_PREFIX: 'test-tmp/x/' })[0]).toMatch(/reserved for automated tests/);
    expect(storageProblems({ ...ok, APP_ENV: 'production' })).toEqual([]);
    expect(storageProblems({ ...ok, APP_ENV: 'staging', SUPABASE_STORAGE_PREFIX: 'staging/' })).toEqual([]);
    for (const bad of ['test-tmp', '../x/', '/abs/', 'Test-Tmp/a/', 'a//']) expect(storageProblems({ ...ok, APP_ENV: 'staging', SUPABASE_STORAGE_PREFIX: bad }).join()).toMatch(/SUPABASE_STORAGE_PREFIX/);
  });
  it('every request uses the prefixed object name', async () => {
    const f = fakeFetch([new Response('{}'), new Response('IMG'), new Response('[]')]);
    const s = new SupabaseStorage(URL_OK, SECRET, 'restaurant-media', f.fn, 'test-tmp/run-1/');
    await s.put(KEY, Buffer.from('x'), 'image/png');
    await s.get(KEY);
    await s.delete(KEY);
    expect(f.calls[0].url).toBe(`${URL_OK}/storage/v1/object/restaurant-media/test-tmp/run-1/${KEY}`);
    expect(f.calls[1].url).toBe(`${URL_OK}/storage/v1/object/authenticated/restaurant-media/test-tmp/run-1/${KEY}`);
    expect(JSON.parse(String(f.calls[2].init.body))).toEqual({ prefixes: [`test-tmp/run-1/${KEY}`] });
  });
});

describe('Supabase Storage driver requests', () => {
  it('uploads to the private bucket with the key in the apikey header only (new secret keys are not JWTs)', async () => {
    const f = fakeFetch([new Response('{"Key":"x"}', { status: 200 })]);
    await new SupabaseStorage(`${URL_OK}/`, SECRET, 'restaurant-media', f.fn).put(KEY, Buffer.from('img'), 'image/png');
    const { url, init } = f.calls[0];
    expect(url).toBe(`${URL_OK}/storage/v1/object/restaurant-media/${KEY}`);
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h.apikey).toBe(SECRET);
    expect(h.Authorization).toBeUndefined();
    expect(h['Content-Type']).toBe('image/png');
    expect(h['x-upsert']).toBe('false'); // never overwrites an existing object
  });
  it('sends the legacy service_role JWT as a bearer token too', async () => {
    const key = jwt('service_role');
    const f = fakeFetch([new Response('{}', { status: 200 })]);
    await new SupabaseStorage(URL_OK, key, 'restaurant-media', f.fn).put(KEY, Buffer.from('img'), 'image/png');
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
  });
  it('downloads through the authenticated endpoint; missing objects are null, other errors throw', async () => {
    const f = fakeFetch([
      new Response('IMG', { status: 200 }),
      new Response('{"statusCode":"404","error":"not_found"}', { status: 400 }),
      new Response('{"error":"not_found"}', { status: 404 }),
      new Response('{"message":"Invalid Compact JWS"}', { status: 401 }),
    ]);
    const s = new SupabaseStorage(URL_OK, SECRET, 'restaurant-media', f.fn);
    expect((await s.get(KEY))?.toString()).toBe('IMG');
    expect(f.calls[0].url).toBe(`${URL_OK}/storage/v1/object/authenticated/restaurant-media/${KEY}`);
    expect(await s.get(KEY)).toBeNull();
    expect(await s.get(KEY)).toBeNull();
    await expect(s.get(KEY)).rejects.toThrow(/HTTP 401/);
  });
  it('deletes by exact key', async () => {
    const f = fakeFetch([new Response('[]', { status: 200 })]);
    await new SupabaseStorage(URL_OK, SECRET, 'restaurant-media', f.fn).delete(KEY);
    expect(f.calls[0].url).toBe(`${URL_OK}/storage/v1/object/restaurant-media`);
    expect(f.calls[0].init.method).toBe('DELETE');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ prefixes: [KEY] });
  });
  it('refuses keys that MenuNiva never creates (traversal, other folders, prefixes) without calling Supabase', async () => {
    const f = fakeFetch([]);
    const s = new SupabaseStorage(URL_OK, SECRET, 'restaurant-media', f.fn);
    for (const bad of ['../secret.png', 'org1abc/', 'org1abc', 'org1abc/branding/', 'org1abc/private/AbCdEfGhIjKlMnOpQrStUv.png', 'org1abc/branding/AbCdEfGhIjKlMnOpQrStUv.svg']) {
      await expect(s.put(bad, Buffer.from('x'), 'image/png')).rejects.toThrow(/Invalid storage key/);
      await expect(s.delete(bad)).rejects.toThrow(/Invalid storage key/);
      expect(await s.get(bad)).toBeNull();
    }
    expect(f.calls).toHaveLength(0);
  });
  it('only MenuNiva media paths map to storage keys', () => {
    expect(mediaKeyFromPath(`/media/${KEY}`)).toBe(KEY);
    expect(mediaKeyFromPath('https://example.com/a.png')).toBeNull();
    expect(mediaKeyFromPath('/media/../x.png')).toBeNull();
    expect(mediaKeyFromPath(null)).toBeNull();
  });
});
