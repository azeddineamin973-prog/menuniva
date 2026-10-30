import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { acquireExclusiveDb } from './db-lock';
/**
 * Applies all migrations to the dedicated test database before tests run and holds the
 * test-database lock for the whole run (see db-lock.ts). Never touches the development or demo databases.
 */
export default async function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/menuniva_test/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point to the menuniva_test database.');
  }
  const release = await acquireExclusiveDb(url, 'vitest');
  try {
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  } catch (e) {
    await release();
    throw e;
  }
  return release;
}
