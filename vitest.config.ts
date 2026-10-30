import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv();

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // `server-only` throws outside React Server Components; tests run on the server.
      'server-only': path.resolve(__dirname, 'tests/support/empty.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one real PostgreSQL test database; run files sequentially.
    fileParallelism: false,
    globalSetup: ['tests/support/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      APP_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      APP_SECRET: process.env.APP_SECRET ?? 'test-secret-test-secret-test-secret-123',
    },
  },
});
