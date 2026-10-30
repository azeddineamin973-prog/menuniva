import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

loadEnv();

const PORT = 3100;
const testDb = process.env.TEST_DATABASE_URL ?? '';
if (!testDb.includes('menuniva_test')) throw new Error('TEST_DATABASE_URL must point to menuniva_test');

/**
 * End-to-end tests run a separate Next.js server on port 3100 against the TEST database
 * (never the development data with real restaurants). Uses the installed Google Chrome to
 * avoid downloading browsers.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  webServer: {
    // Database URLs and APP_SECRET are read by the launcher from .env, not written here (reporters print the config).
    command: `node scripts/test-server.mjs test ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 400_000,
  },
});
