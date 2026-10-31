// Builds and starts the app for the browser suites against the TEST or DEMO database.
//   node scripts/test-server.mjs <test|demo> <port>
// Secrets (database URLs, APP_SECRET) are read here from .env instead of being written into the
// Playwright config, where reporters (e.g. --reporter=json) would print them (audit finding).
import 'dotenv/config';
import { spawnSync, spawn } from 'node:child_process';

const [mode, port] = process.argv.slice(2);
const url = mode === 'demo' ? process.env.DEMO_DATABASE_URL : process.env.TEST_DATABASE_URL;
if (!port || !url || !(mode === 'demo' ? /menuniva_demo/ : /menuniva_test/).test(url)) {
  console.error('Usage: node scripts/test-server.mjs <test|demo> <port> (TEST_DATABASE_URL / DEMO_DATABASE_URL must point to menuniva_test / menuniva_demo)');
  process.exit(1);
}
const env = {
  ...process.env,
  NEXT_DIST_DIR: mode === 'demo' ? '.next-demo' : '.next-e2e',
  APP_ENV: mode,
  DATABASE_URL: url,
  APP_BASE_URL: `http://localhost:${port}`,
  APP_SECRET: process.env.APP_SECRET || (mode === 'test' ? 'e2e-secret-e2e-secret-e2e-secret-123456' : ''),
  UPLOAD_DIR: mode === 'demo' ? './storage/demo-uploads' : './storage/e2e-uploads',
  // Local files unless the run explicitly opts in: E2E_STORAGE_DRIVER=supabase npx playwright test …
  STORAGE_DRIVER: mode === 'test' && process.env.E2E_STORAGE_DRIVER === 'supabase' ? 'supabase' : 'local',
  // Disposable bucket folder for Supabase browser runs (env.ts refuses anything else in test).
  SUPABASE_STORAGE_PREFIX: process.env.E2E_STORAGE_PREFIX || `test-tmp/e2e-${Date.now()}/`,
  // Browser tests answer outbound requests (Glovo pages, photos) from local fixtures: no internet.
  ...(mode === 'test' ? { TEST_FETCH_FIXTURES: process.env.E2E_FETCH_FIXTURES || './storage/e2e-net/manifest.json' } : {}),
  // AI translation is exercised against a local stand-in model, never the real paid API. The
  // key is a placeholder: with TEST_FETCH_FIXTURES set, no request leaves the machine.
  ...(mode === 'test' ? { TRANSLATION_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key-not-real', OPENROUTER_MODEL: 'test/echo-translator' } : {}),
};
if (env.STORAGE_DRIVER === 'supabase') console.log(`[test-server] Supabase Storage folder: ${env.SUPABASE_STORAGE_PREFIX}`);
const build = spawnSync('npx', ['next', 'build'], { env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const server = spawn('npx', ['next', 'start', '--port', port], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
