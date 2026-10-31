// UX / responsive audit server (2026-10-31). Builds into .next-ux and serves it against the
// isolated `menuniva_test_ux` database, so the developer's `npm run dev` (.next, menuniva_dev)
// and the E2E suites (.next-e2e, menuniva_test) are never touched.
//   node audit/ux/server.mjs [--no-build] [port]
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const port = args.find((a) => /^\d+$/.test(a)) ?? '3300';
const u = new URL(process.env.TEST_DATABASE_URL ?? '');
u.pathname = '/menuniva_test_ux';
if (!existsSync('storage/ux-net')) mkdirSync('storage/ux-net', { recursive: true });
if (!existsSync('storage/ux-net/manifest.json')) writeFileSync('storage/ux-net/manifest.json', '{}');
const env = {
  ...process.env,
  NEXT_DIST_DIR: '.next-ux',
  APP_ENV: 'test',
  DATABASE_URL: u.toString(),
  APP_BASE_URL: `http://localhost:${port}`,
  APP_SECRET: process.env.APP_SECRET || 'ux-secret-ux-secret-ux-secret-ux-123456',
  UPLOAD_DIR: './storage/ux-uploads',
  STORAGE_DRIVER: 'local',
  SUPABASE_URL: '',
  SUPABASE_SECRET_KEY: '',
  // No request leaves the machine: outbound fetches are answered from an (empty) fixture
  // manifest and AI translation uses the local stand-in model, exactly like the E2E suite.
  TEST_FETCH_FIXTURES: './storage/ux-net/manifest.json',
  TRANSLATION_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'test-key-not-real',
  OPENROUTER_MODEL: 'test/echo-translator',
};
if (!noBuild) {
  const build = spawnSync('npx', ['next', 'build'], { env, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const server = spawn('npx', ['next', 'start', '--port', port], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
