import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';
loadEnv();
/**
 * Independent audit (2026-10-30). Real-browser acceptance flows against the separate DEMO
 * database (menuniva_demo, fictitious data only). Never the development database.
 * Serves the existing `.next-e2e` production build with `next start` (see audit/start-server.sh).
 *   npx playwright test --config audit/playwright.audit.config.ts
 */
const PORT = 3201;
if (!/menuniva_demo/.test(process.env.DEMO_DATABASE_URL ?? '')) throw new Error('DEMO_DATABASE_URL must point to menuniva_demo');
export default defineConfig({
  testDir: 'acceptance',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'logs/audit-playwright.json' }]],
  outputDir: 'artifacts/playwright',
  use: { baseURL: `http://localhost:${PORT}`, channel: 'chrome', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'audit', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: `audit/start-server.sh demo ${PORT}`,
    cwd: '..',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
