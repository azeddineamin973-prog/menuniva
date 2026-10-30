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
};
const build = spawnSync('npx', ['next', 'build'], { env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const server = spawn('npx', ['next', 'start', '--port', port], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
