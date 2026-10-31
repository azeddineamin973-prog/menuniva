import { defineConfig, devices } from '@playwright/test';

/**
 * UX audit journeys (2026-10-31) against the isolated audit server (audit/ux/server.mjs, port
 * 3300, database menuniva_test_ux with audit/ux/seed-ux.ts data). Start the server first:
 *   node audit/ux/server.mjs 3300
 *   npx playwright test --config audit/ux/playwright.ux.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /journeys\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: '../artifacts/ux/journeys-results',
  use: { baseURL: 'http://localhost:3300', channel: 'chrome', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'ux', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
