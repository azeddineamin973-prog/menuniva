import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

loadEnv();
const PORT = 3200;
const demoDb = process.env.DEMO_DATABASE_URL ?? '';
if (!/menuniva_demo/.test(demoDb)) throw new Error('DEMO_DATABASE_URL must point to menuniva_demo');

/**
 * TEST 20: the complete restaurant flow in the separate DEMO environment (APP_ENV=demo,
 * menuniva_demo database, fictitious data from `npm run demo:seed`). Builds into its own `.next-demo`
 * folder: sharing `.next-e2e` with the E2E suite made a running server answer 500 (audit BUG-12).
 *   npm run test:demo
 */
export default defineConfig({
  testDir: 'tests/e2e-demo',
  globalSetup: './tests/e2e-demo/global-setup.ts',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  projects: [{ name: 'demo', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    // Database URLs and APP_SECRET are read by the launcher from .env, not written here (reporters print the config).
    command: `node scripts/test-server.mjs demo ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 400_000,
  },
});
