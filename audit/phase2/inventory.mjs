// Route inventory: every page.tsx under src/app, with the files it renders and legacy-style hits.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const APP = 'src/app';
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const pages = walk(APP).filter((f) => f.endsWith('/page.tsx'));
const LEGACY = {
  rawTable: /<table\b/g,
  emoji: /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu,
  textArrow: /[→←↗]/g,
  roundedXL: /rounded-(2xl|3xl|full px)/g,
  rawSvg: /<svg\b/g,
  hardColor: /(bg|text|border)-(amber|red|green|blue|gray|slate|zinc|emerald)-\d{2,3}/g,
  oldTabs: /bg-graphite text-white/g,
};
const touched = new Set(execSync('git diff --name-only f6af742 HEAD', { encoding: 'utf8' }).split('\n'));
const rows = pages.map((f) => {
  const dir = path.dirname(f);
  const files = [f, ...readdirSync(dir).filter((n) => /\.tsx$/.test(n) && n !== 'page.tsx').map((n) => path.join(dir, n))];
  const src = files.map((x) => readFileSync(x, 'utf8')).join('\n');
  const hits = Object.fromEntries(Object.entries(LEGACY).map(([k, re]) => [k, (src.match(re) ?? []).length]));
  const score = Object.values(hits).reduce((a, b) => a + b, 0);
  const route = '/' + path.relative(APP, dir).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join('/');
  return { route: route === '/.' ? '/' : route, file: f, lines: src.split('\n').length, redesigned: files.some((x) => touched.has(x)), score, hits };
});
rows.sort((a, b) => a.route.localeCompare(b.route));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else for (const r of rows) console.log(`${r.redesigned ? 'R' : '-'} ${String(r.score).padStart(3)} ${String(r.lines).padStart(4)}  ${r.route}  ${Object.entries(r.hits).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' ')}`);
