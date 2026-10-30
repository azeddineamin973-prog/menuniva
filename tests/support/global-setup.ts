import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

/**
 * Applies all migrations to the dedicated test database before tests run.
 * Never touches the development or demo databases.
 */
export default function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/menuniva_test/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point to the menuniva_test database.');
  }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
