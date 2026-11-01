// First-load JavaScript per route, from a production build's route-bundle-stats.json.
// Prints gzip/brotli sizes (what browsers actually download) and the largest shared chunks,
// with the libraries recognised inside them.
//   node audit/perf/bundles.mjs [distDir=.next-ux] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.next-ux';
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const stats = JSON.parse(readFileSync(`${dist}/diagnostics/route-bundle-stats.json`, 'utf8'));
const cache = new Map();
const sizes = (file) => {
  if (!cache.has(file)) {
    const buf = readFileSync(file);
    cache.set(file, { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length, br: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, text: buf.toString('utf8') });
  }
  return cache.get(file);
};
const KB = (n) => `${(n / 1024).toFixed(1)}`;
const routes = stats
  .filter((r) => !r.route.startsWith('/_') && !r.route.startsWith('/api'))
  .map((r) => {
    const s = r.firstLoadChunkPaths.map(sizes);
    return { route: r.route, chunks: r.firstLoadChunkPaths.length, raw: s.reduce((a, x) => a + x.raw, 0), gz: s.reduce((a, x) => a + x.gz, 0), br: s.reduce((a, x) => a + x.br, 0), paths: r.firstLoadChunkPaths };
  })
  .sort((a, b) => b.gz - a.gz);

// Chunks used by every page = framework + shared app code.
const counts = new Map();
for (const r of routes) for (const p of r.paths) counts.set(p, (counts.get(p) ?? 0) + 1);
const shared = [...counts].filter(([, n]) => n === routes.length).map(([p]) => p);
const sharedGz = shared.reduce((a, p) => a + sizes(p).gz, 0);

const SIGNATURES = {
  'react-dom': /react-dom|__reactFiber|scheduleUpdateOnFiber/,
  'next router': /next-router|__NEXT_DATA__|ACTION_SERVER_ACTION|prefetchReducer/,
  zod: /ZodError|"invalid_type"|_zod/,
  'MenuNiva i18n dictionary': /Levantar no restaurante|Retrait au restaurant/,
  'icons (inline SVG)': /M5 12h14M13 6l6 6-6 6/,
  qrcode: /QRCode|qrcode/i,
  'date/time Intl': /Intl\.DateTimeFormat/,
};
const describe = (p) =>
  Object.entries(SIGNATURES)
    .filter(([, re]) => re.test(sizes(p).text))
    .map(([k]) => k)
    .join(', ') || '—';

console.log(`First-load JavaScript per route (${dist}), compressed sizes as downloaded:`);
console.log('  gzip KB  brotli KB  raw KB  chunks  route');
for (const r of routes) console.log(`  ${KB(r.gz).padStart(7)}  ${KB(r.br).padStart(9)}  ${KB(r.raw).padStart(6)}  ${String(r.chunks).padStart(6)}  ${r.route}`);
console.log(`\nShared by every page: ${shared.length} chunks, ${KB(sharedGz)} KB gzip`);
const top = [...counts.keys()].sort((a, b) => sizes(b).gz - sizes(a).gz).slice(0, 12);
console.log('\nLargest chunks (gzip KB · used by N routes · recognised content):');
for (const p of top) console.log(`  ${KB(sizes(p).gz).padStart(6)}  ${String(counts.get(p)).padStart(3)} routes  ${p.split('/').pop()}  ${describe(p)}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ routes: routes.map(({ paths, ...r }) => r), sharedGz }, null, 1));
