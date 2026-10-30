// Writes .env.vercel (git-ignored, mode 600) with the variables for the Vercel staging project,
// built from the local .env. Paste its contents into Vercel → Settings → Environment Variables
// (or the "paste .env" box on import). Prints variable NAMES only, never values.
//   node scripts/vercel-env.mjs
// Re-run after changing the Supabase database password (APP_SECRET is kept between runs).
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const OUT = '.env.vercel';
const POOLER_HOST = process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-central-1.pooler.supabase.com';
const need = (n) => {
  if (!process.env[n]) throw new Error(`${n} is missing in .env`);
  return process.env[n];
};
const direct = new URL(need('SUPABASE_DATABASE_URL'));
const ref = direct.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
if (!ref) throw new Error('SUPABASE_DATABASE_URL is not a Supabase direct connection URL');
const caFile = direct.searchParams.get('sslrootcert');
if (!caFile || !existsSync(caFile)) throw new Error('CA certificate file from SUPABASE_DATABASE_URL (sslrootcert) not found');
const caPem = readFileSync(caFile, 'utf8');

// Transaction pooler (IPv4, serverless-friendly). Password stays percent-encoded as in .env.
const databaseUrl = `postgresql://postgres.${ref}:${direct.password}@${POOLER_HOST}:6543/postgres`;
const previous = existsSync(OUT) ? Object.fromEntries(readFileSync(OUT, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {};

const vars = {
  APP_ENV: 'staging',
  // APP_BASE_URL is left out: the app uses Vercel's production domain until a custom domain is set.
  APP_SECRET: previous.APP_SECRET || randomBytes(32).toString('base64url'),
  TRUST_PROXY_HOPS: '1', // Vercel replaces X-Forwarded-For with the real client IP
  DATABASE_URL: databaseUrl,
  DATABASE_CA_CERT: Buffer.from(caPem).toString('base64'),
  DATABASE_POOL_MAX: '3',
  STORAGE_DRIVER: 'supabase',
  SUPABASE_URL: need('SUPABASE_URL'),
  SUPABASE_SECRET_KEY: need('SUPABASE_SECRET_KEY'),
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'restaurant-media',
  SUPABASE_STORAGE_PREFIX: 'staging/', // keeps staging files apart from a later production
  UPLOAD_MAX_BYTES: '4194304', // Vercel rejects request bodies over 4.5 MB
};

// Prove these exact settings work before writing them: pooler reachable, CA verified, migrated schema.
const client = new pg.Client({ connectionString: databaseUrl, ssl: { ca: caPem, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
await client.connect();
const { rows } = await client.query(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
await client.end();
const storage = await fetch(`${vars.SUPABASE_URL}/storage/v1/bucket/${vars.SUPABASE_STORAGE_BUCKET}`, { headers: { apikey: vars.SUPABASE_SECRET_KEY } });
if (!storage.ok) throw new Error(`Supabase Storage refused the secret key (HTTP ${storage.status})`);
const bucket = await storage.json();
if (bucket.public) throw new Error('bucket is public; make it private first');

writeFileSync(OUT, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
console.log(`database via ${POOLER_HOST}:6543 OK (verified TLS, ${rows[0].n} migrations applied); storage bucket private OK`);
console.log(`wrote ${OUT} (mode 600, git-ignored) with: ${Object.keys(vars).join(', ')}`);
