// Queries one guest page load runs (no login). node audit/perf/guest-queries.mjs /r/casa-aurora
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:3300';
const LOG = 'audit/logs/perf-server.log';
const path = process.argv[2];
await fetch(`${BASE}${path}`); // warm
await new Promise((r) => setTimeout(r, 300));
const t0 = Date.now();
const res = await fetch(`${BASE}${path}`);
const html = await res.text();
const total = Date.now() - t0;
await new Promise((r) => setTimeout(r, 500));
const hits = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[db] ')).map((l) => l.split(' ')).filter((p) => Number(p[1]) >= t0 && Number(p[1]) <= t0 + total + 400);
const groups = new Map();
for (const p of hits) { const k = p.slice(3).join(' ').slice(0, 100); const g = groups.get(k) ?? { n: 0, ms: 0 }; g.n++; g.ms += parseInt(p[2], 10); groups.set(k, g); }
console.log(`${path}: HTTP ${res.status}, ${total} ms, ${Math.round(html.length / 1024)} KB HTML, ${hits.length} queries / ${hits.reduce((s, p) => s + parseInt(p[2], 10), 0)} ms`);
for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`${String(g.n).padStart(4)}× ${String(g.ms).padStart(4)}ms ${k}`);
