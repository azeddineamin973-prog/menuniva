// Phase D: seed a restaurant in the TEST database with the real e2e seed, then immediately
// request its table page from an already-running test server. Repeats N times, no retries.
//   node audit/phaseD-seed-fetch.mjs <baseUrl> <N>
import { execFileSync } from 'node:child_process';
import 'dotenv/config';
const base = process.argv[2] ?? 'http://localhost:3101';
const n = Number(process.argv[3] ?? 30);
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB?.includes('menuniva_test')) throw new Error('test DB only');
const results = [];
for (let i = 1; i <= n; i++) {
  const prefix = `pd${Date.now()}${i}`;
  let out;
  try {
    out = execFileSync('npx', ['tsx', '--conditions=react-server', 'tests/e2e/seed.ts', prefix], { env: { ...process.env, APP_ENV: 'test', DATABASE_URL: TEST_DB }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    results.push({ i, status: 'seed_failed', ok: false, error: String(e.stderr ?? e.message).match(/code: '(\w+)'|(\w+Error)/)?.[0] ?? 'error' });
    console.log(JSON.stringify(results.at(-1)));
    continue;
  }
  const s = JSON.parse(out.trim().split('\n').reverse().find((l) => l.startsWith('{')));
  const t0 = Date.now();
  let r, html;
  try {
    r = await fetch(`${base}/t/${s.qrToken}`);
    html = await r.text();
  } catch (e) {
    results.push({ i, status: 'fetch_error', ok: false, error: e.cause?.code ?? e.message });
    console.log(JSON.stringify(results.at(-1)));
    continue;
  }
  const ok = r.status === 200 && html.includes('customer-product');
  results.push({ i, status: r.status, ok, ms: Date.now() - t0 });
  console.log(JSON.stringify(results.at(-1)));
}
const bad = results.filter((r) => !r.ok);
console.log(`SUMMARY: ${n} attempts, ${bad.length} failures${bad.length ? ' ' + JSON.stringify(bad) : ''}`);
