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
      UPLOAD_DIR: './storage/test-uploads',
      // Tests use local files unless explicitly asked to exercise Supabase Storage:
      //   MEDIA_TEST_DRIVER=supabase npx vitest run tests/integration/media-storage.test.ts
      STORAGE_DRIVER: process.env.MEDIA_TEST_DRIVER === 'supabase' ? 'supabase' : 'local',
      // Supabase test runs write only into a disposable folder of the bucket (enforced in env.ts).
      SUPABASE_STORAGE_PREFIX: process.env.MEDIA_TEST_PREFIX ?? `test-tmp/vitest-${Date.now()}/`,
    },
  },
});
