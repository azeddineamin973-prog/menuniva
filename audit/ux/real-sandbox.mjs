// Real-data UX sandbox. Serves the app (dev mode, separate .next-uxreal build folder) against
// `menuniva_ux_real`: a database restored from a backup of the developer's database, with a
// COPY of the uploaded photos in storage/ux-real-uploads. Orders placed here never reach the
// real restaurant data, and outbound requests are answered from local fixtures.
//   node audit/ux/real-sandbox.mjs [port]      (default 3400)
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const port = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? '3400';
const u = new URL(process.env.DATABASE_URL ?? '');
u.pathname = '/menuniva_ux_real';
if (!existsSync('storage/ux-real-uploads')) {
  console.error('storage/ux-real-uploads is missing: copy storage/uploads first.');
  process.exit(1);
}
if (!existsSync('storage/ux-net/manifest.json')) {
  mkdirSync('storage/ux-net', { recursive: true });
  writeFileSync('storage/ux-net/manifest.json', '{}');
}
const env = {
  ...process.env,
  NEXT_DIST_DIR: '.next-uxreal',
  // `test` so outbound requests are answered by fixtures (no emails, no external calls).
  APP_ENV: 'test',
  DATABASE_URL: u.toString(),
  APP_BASE_URL: `http://localhost:${port}`,
  UPLOAD_DIR: './storage/ux-real-uploads',
  STORAGE_DRIVER: 'local',
  SUPABASE_URL: '',
  SUPABASE_SECRET_KEY: '',
  TEST_FETCH_FIXTURES: './storage/ux-net/manifest.json',
  TRANSLATION_PROVIDER: 'none',
  OPENROUTER_API_KEY: '',
  SMTP_URL: '',
  GOOGLE_PLACES_API_KEY: '',
};
const server = spawn('npx', ['next', 'dev', '--port', port], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
