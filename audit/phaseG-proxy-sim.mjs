// Phase G / BUG-05: end-to-end check of TRUST_PROXY_HOPS=1 behind a reverse proxy that appends the
// client address to X-Forwarded-For (what nginx `proxy_add_x_forwarded_for` and Caddy do).
// TEST database only. Uses the existing .next-e2e build.
//   node audit/phaseG-proxy-sim.mjs
import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB?.includes('menuniva_test')) throw new Error('test DB only');
const APP = 3102, PROXY = 3103;
const app = spawn('npx', ['next', 'start', '--port', String(APP)], {
  env: { ...process.env, NEXT_DIST_DIR: '.next-e2e', APP_ENV: 'test', DATABASE_URL: TEST_DB, APP_BASE_URL: `http://localhost:${APP}`, UPLOAD_DIR: './storage/e2e-uploads', TRUST_PROXY_HOPS: '1' },
  stdio: 'ignore',
});
const proxy = http.createServer((req, res) => {
  const xff = req.headers['x-forwarded-for'];
  const headers = { ...req.headers, 'x-forwarded-for': `${xff ? `${xff}, ` : ''}${req.socket.remoteAddress.replace(/^::ffff:/, '')}` }; // Host is passed through (nginx: proxy_set_header Host $host)
  const up = http.request({ host: '127.0.0.1', port: APP, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(up);
}).listen(PROXY);
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${APP}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const out = execFileSync('npx', ['tsx', '--conditions=react-server', 'tests/e2e/seed.ts', `px${Date.now()}`], { env: { ...process.env, APP_ENV: 'test', DATABASE_URL: TEST_DB }, encoding: 'utf8' });
  const s = JSON.parse(out.trim().split('\n').reverse().find((l) => l.startsWith('{')));
  const feedback = async (port, i, spoof) => (await fetch(`http://localhost:${port}/api/public/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://localhost:${port}`, cookie: `mn_guest=${String(i).padStart(22, 'A')}`, ...(spoof ? { 'x-forwarded-for': spoof } : {}) },
    body: JSON.stringify({ orgSlug: s.orgSlug, rating: 5, language: 'pt' }),
  })).status;
  // Through the proxy: a client rotating cookies AND spoofing X-Forwarded-For is still one IP (60/h).
  const viaProxy = [];
  for (let i = 0; i < 62; i++) viaProxy.push(await feedback(PROXY, i, `203.0.113.${i % 250}`));
  // Directly to the app (bypassing the proxy = misconfigured network): the spoofed header is believed.
  const direct = [];
  for (let i = 100; i < 162; i++) direct.push(await feedback(APP, i, `198.51.100.${i % 250}`));
  const tally = (a) => a.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ trustProxyHops: 1, viaAppendingProxy: tally(viaProxy), firstRefusedAt: viaProxy.indexOf(429) + 1, directToAppWithSpoofedHeader: tally(direct) }));
} finally {
  proxy.close();
  app.kill('SIGTERM');
}
