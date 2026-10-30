import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

/** Migrates and empties the TEST database before the browser suite. */
export default async function globalSetup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL ?? '';
  if (!url.includes('menuniva_test')) throw new Error('Refusing to touch a non-test database');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'");
  if (rows.length) await client.query(`TRUNCATE TABLE ${rows.map((r) => `"public"."${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await client.end();
}
