import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment configuration, validated once at startup.
 * Importing this file from client code fails the build (`server-only`).
 */
const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'demo', 'staging', 'production']).default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Root CA of the database (PEM or base64 of PEM) for hosts without a certificate file, e.g. Vercel. */
  DATABASE_CA_CERT: z.string().optional(),
  /** Connections per app instance. Serverless hosts run many instances: keep it small there (e.g. 3). */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  /** Where uploaded images live: `local` (UPLOAD_DIR, development default) or `supabase` (Supabase Storage). */
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  /** Project URL, e.g. https://<project-ref>.supabase.co (Supabase driver only). */
  SUPABASE_URL: z.string().optional(),
  /** Server-side secret key (sb_secret_…). Never sent to the browser; never prefix it with NEXT_PUBLIC_. */
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('restaurant-media'),
  /** Folder inside the bucket for every object (empty in production). Test runs use `test-tmp/<run>/`. */
  SUPABASE_STORAGE_PREFIX: z.string().default(''),
  TRANSLATION_PROVIDER: z.enum(['none', 'deepl', 'libretranslate', 'openrouter']).default('none'),
  DEEPL_API_KEY: z.string().optional(),
  LIBRETRANSLATE_URL: z.string().optional(),
  LIBRETRANSLATE_API_KEY: z.string().optional(),
  /**
   * OpenRouter (AI menu translation). Server-side only: the key is never sent to the browser.
   * Translation calls are billed by OpenRouter, so they only happen when an owner presses
   * "Translate with AI" — nothing is translated in the background.
   */
  OPENROUTER_API_KEY: z.string().optional(),
  /** Any model id from https://openrouter.ai/models. Cheap and multilingual by default. */
  OPENROUTER_MODEL: z.string().default('google/gemini-2.5-flash-lite'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /**
   * Optional. Google Places API (New) key for Magic Setup discovery. Without it, discovery uses
   * the restaurant's own website and OpenStreetMap, and says Google Places is not connected.
   */
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  GLOVO_PARTNER_API_KEY: z.string().optional(),
  UBER_EATS_CLIENT_ID: z.string().optional(),
  UBER_EATS_CLIENT_SECRET: z.string().optional(),
  BILLING_PROVIDER: z.enum(['manual', 'stripe']).default('manual'),
  ERROR_MONITORING_DSN: z.string().optional(),
  /**
   * Number of reverse proxies in front of the app that append the client address to
   * X-Forwarded-For (0 = none: the header is ignored). See docs/DEPLOYMENT.md → Reverse proxy.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
  /**
   * Browser test suite only (APP_ENV=test): JSON manifest of fixture responses that answers every
   * outbound request (see safe-fetch.ts), so tests never reach the internet. Refused elsewhere.
   */
  TEST_FETCH_FIXTURES: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

/**
 * Rules that keep environments apart (M13-06). Each environment uses its own database:
 * production/staging never point at a dev/test/demo database, demo only at a *demo* database,
 * and public environments must use https and a real secret.
 */
/**
 * Supabase Storage settings (only checked when STORAGE_DRIVER=supabase). The key must be a
 * server-side key: a publishable/anon key cannot write to a private bucket and must not be used.
 */
export function storageProblems(e: Partial<Pick<Env, 'APP_ENV' | 'STORAGE_DRIVER' | 'SUPABASE_URL' | 'SUPABASE_SECRET_KEY' | 'SUPABASE_STORAGE_BUCKET' | 'SUPABASE_STORAGE_PREFIX'>>): string[] {
  if (e.STORAGE_DRIVER !== 'supabase') return [];
  const problems: string[] = [];
  let url: URL | null = null;
  try {
    url = new URL(e.SUPABASE_URL ?? '');
  } catch {}
  if (!url || url.protocol !== 'https:' || url.pathname.replace(/\/+$/, '') !== '') problems.push('SUPABASE_URL: set the project URL, e.g. https://<project-ref>.supabase.co (Project Settings → Data API / Connect)');
  const key = e.SUPABASE_SECRET_KEY ?? '';
  if (!key) problems.push('SUPABASE_SECRET_KEY: required when STORAGE_DRIVER=supabase (Project Settings → API Keys → Secret keys)');
  else if (key.startsWith('sb_publishable_')) problems.push('SUPABASE_SECRET_KEY: this is the publishable key; use a secret key (sb_secret_…)');
  else if (!key.startsWith('sb_secret_') && legacyJwtRole(key) !== 'service_role') problems.push('SUPABASE_SECRET_KEY: not a Supabase secret key (expected sb_secret_… or the legacy service_role key)');
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(e.SUPABASE_STORAGE_BUCKET ?? 'restaurant-media')) problems.push('SUPABASE_STORAGE_BUCKET: invalid bucket name');
  const prefix = e.SUPABASE_STORAGE_PREFIX ?? '';
  if (prefix && !/^([a-z0-9][a-z0-9-]{0,62}\/){1,4}$/.test(prefix)) problems.push('SUPABASE_STORAGE_PREFIX: lowercase folders ending with "/", e.g. test-tmp/run-1/');
  // Automated tests write into a disposable folder only, never next to real restaurant files.
  if (e.APP_ENV === 'test' && !prefix.startsWith('test-tmp/')) problems.push('SUPABASE_STORAGE_PREFIX: tests must use a temporary folder starting with "test-tmp/"');
  if (e.APP_ENV !== 'test' && prefix.startsWith('test-tmp/')) problems.push('SUPABASE_STORAGE_PREFIX: "test-tmp/" is reserved for automated tests');
  return problems;
}
function legacyJwtRole(key: string): string | null {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

export function environmentProblems(e: Pick<Env, 'APP_ENV' | 'APP_BASE_URL' | 'DATABASE_URL' | 'APP_SECRET'> & Partial<Pick<Env, 'TRUST_PROXY_HOPS' | 'TEST_FETCH_FIXTURES'>>): string[] {
  const problems: string[] = [];
  if (e.TEST_FETCH_FIXTURES && e.APP_ENV !== 'test') problems.push('TEST_FETCH_FIXTURES: only allowed with APP_ENV=test (it replaces real network requests)');
  let dbName = '';
  try {
    dbName = new URL(e.DATABASE_URL).pathname.slice(1).toLowerCase();
  } catch {
    problems.push('DATABASE_URL: not a valid postgres URL');
  }
  const isPublic = e.APP_ENV === 'production' || e.APP_ENV === 'staging' || e.APP_ENV === 'demo';
  // A demo may run on a laptop over http; a public demo deployment should still use https.
  if ((e.APP_ENV === 'production' || e.APP_ENV === 'staging') && !e.APP_BASE_URL.startsWith('https://')) problems.push(`APP_BASE_URL: must use https in ${e.APP_ENV}`);
  if (isPublic && /replace-with|change-me|test-secret/i.test(e.APP_SECRET)) problems.push('APP_SECRET: still the example value; generate a new random secret');
  if ((e.APP_ENV === 'production' || e.APP_ENV === 'staging') && /(^|_)(dev|test|demo)($|_)/.test(dbName)) problems.push(`DATABASE_URL: ${e.APP_ENV} must not use the "${dbName}" database`);
  if (e.APP_ENV === 'production' && /(^|_)staging($|_)/.test(dbName)) problems.push('DATABASE_URL: production must not use the staging database');
  if (e.APP_ENV === 'demo' && dbName && !dbName.includes('demo')) problems.push('DATABASE_URL: the demo environment must use a separate database whose name contains "demo"');
  // Public deployments must state how many proxies sit in front of the app; otherwise client IPs
  // are either spoofable (trusting X-Forwarded-For blindly) or unknown without anyone noticing.
  if ((e.APP_ENV === 'production' || e.APP_ENV === 'staging') && e.TRUST_PROXY_HOPS === undefined) problems.push('TRUST_PROXY_HOPS: set the number of reverse proxies in front of the app (see docs/DEPLOYMENT.md → Reverse proxy)');
  if (e.APP_ENV !== 'test' && dbName.includes('test')) problems.push('DATABASE_URL: the test database is wiped by automated tests; use it only with APP_ENV=test');
  return problems;
}
/**
 * On Vercel, APP_BASE_URL may be left unset: the project's production domain (a Vercel system
 * variable) is used. Set APP_BASE_URL explicitly once a custom domain exists (QR codes use it).
 */
export function withPlatformDefaults(source: Record<string, string | undefined>): Record<string, string | undefined> {
  if (source.APP_BASE_URL || !source.VERCEL_PROJECT_PRODUCTION_URL) return source;
  return { ...source, APP_BASE_URL: `https://${source.VERCEL_PROJECT_PRODUCTION_URL}` };
}
function load(): Env {
  const parsed = schema.safeParse(withPlatformDefaults(process.env));
  const issues = parsed.success ? [...environmentProblems(parsed.data), ...storageProblems(parsed.data)] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  if (!parsed.success || issues.length) {
    throw new Error(`MenuNiva configuration error. Check your .env file:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
  return parsed.data;
}
export const env = load();
export const isProduction = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
/** Cookies are marked Secure whenever the app is served over https (production, staging, demo). */
export const secureCookies = env.APP_BASE_URL.startsWith('https://');
