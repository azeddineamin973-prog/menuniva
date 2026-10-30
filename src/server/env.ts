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
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  TRANSLATION_PROVIDER: z.enum(['none', 'deepl', 'libretranslate']).default('none'),
  DEEPL_API_KEY: z.string().optional(),
  LIBRETRANSLATE_URL: z.string().optional(),
  LIBRETRANSLATE_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
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
});

export type Env = z.infer<typeof schema>;

/**
 * Rules that keep environments apart (M13-06). Each environment uses its own database:
 * production/staging never point at a dev/test/demo database, demo only at a *demo* database,
 * and public environments must use https and a real secret.
 */
export function environmentProblems(e: Pick<Env, 'APP_ENV' | 'APP_BASE_URL' | 'DATABASE_URL' | 'APP_SECRET'> & Partial<Pick<Env, 'TRUST_PROXY_HOPS'>>): string[] {
  const problems: string[] = [];
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
function load(): Env {
  const parsed = schema.safeParse(process.env);
  const issues = parsed.success ? environmentProblems(parsed.data) : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  if (!parsed.success || issues.length) {
    throw new Error(`MenuNiva configuration error. Check your .env file:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
  return parsed.data;
}
export const env = load();
export const isProduction = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
/** Cookies are marked Secure whenever the app is served over https (production, staging, demo). */
export const secureCookies = env.APP_BASE_URL.startsWith('https://');
