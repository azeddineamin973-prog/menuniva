// Summarises a crawl: node audit/ux/summarize.mjs <run> [section]
import { readFileSync } from 'node:fs';

const run = process.argv[2] ?? 'before';
const section = process.argv[3] ?? 'all';
const R = JSON.parse(readFileSync(`audit/artifacts/ux/${run}/results.json`, 'utf8'));
const key = (r) => `${r.role} ${r.route}`;
const group = (rows, f) => {
  const m = new Map();
  for (const r of rows) {
    const k = f(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};
const show = (s) => section === 'all' || section === s;

if (show('status')) {
  console.log('== STATUS / REDIRECTS');
  for (const r of R.filter((r) => r.width === 1440)) {
    const redirected = r.finalUrl && r.finalUrl.split('?')[0] !== r.route.split('?')[0];
    if (r.status !== 200 || redirected) console.log(`  ${r.status} ${key(r)} → ${r.finalUrl}`);
  }
}
if (show('overflow')) {
  console.log('== HORIZONTAL OVERFLOW (route: widths [extra px]) + offenders');
  for (const [k, rows] of group(R.filter((r) => r.scrollWidth > r.vw + 1), key)) {
    console.log(`  ${k}: ${rows.map((r) => `${r.width}[+${r.scrollWidth - r.vw}]`).join(' ')}`);
    const off = [...new Set(rows.flatMap((r) => r.overflowers ?? []))].slice(0, 6);
    for (const o of off) console.log(`      ${o}`);
  }
  console.log('== ELEMENTS PAST THE RIGHT EDGE WITHOUT PAGE OVERFLOW (clipped by body?)');
  for (const [k, rows] of group(R.filter((r) => r.scrollWidth <= r.vw + 1 && r.overflowers?.length), key)) {
    console.log(`  ${k}: ${rows.map((r) => r.width).join(' ')}`);
    for (const o of [...new Set(rows.flatMap((r) => r.overflowers))].slice(0, 4)) console.log(`      ${o}`);
  }
}
if (show('errors')) {
  console.log('== CONSOLE / PAGE ERRORS');
  for (const [k, rows] of group(R.filter((r) => r.consoleErrors?.length), key)) {
    console.log(`  ${k}: widths ${rows.map((r) => r.width).join(',')}`);
    for (const e of [...new Set(rows.flatMap((r) => r.consoleErrors))].slice(0, 5)) console.log(`      ${e}`);
  }
  console.log('== FAILED REQUESTS');
  for (const [k, rows] of group(R.filter((r) => r.failed?.length), key)) {
    console.log(`  ${k}: ${[...new Set(rows.flatMap((r) => r.failed))].slice(0, 6).join(' | ')}`);
  }
}
if (show('tap')) {
  console.log('== TAP TARGETS < 24 px (deduped per route, any width)');
  for (const [k, rows] of group(R.filter((r) => r.small?.some((s) => s.fail)), key)) {
    const items = [...new Set(rows.flatMap((r) => r.small.filter((s) => s.fail).map((s) => s.d.replace(/ \d+×\d+$/, ''))))];
    console.log(`  ${k}: ${items.length}`);
    for (const i of items.slice(0, 8)) console.log(`      ${i}`);
  }
}
if (show('tap40')) {
  console.log('== CONTROLS < 40 px tall on phones (warning)');
  for (const [k, rows] of group(R.filter((r) => r.width === 375 && r.small?.some((s) => !s.fail)), key)) {
    const items = [...new Set(rows.flatMap((r) => r.small.filter((s) => !s.fail).map((s) => s.d)))];
    console.log(`  ${k}: ${items.length}`);
    for (const i of items.slice(0, 6)) console.log(`      ${i}`);
  }
}
if (show('clip')) {
  console.log('== CLIPPED BUTTON TEXT');
  for (const [k, rows] of group(R.filter((r) => r.clippedControls?.length), key)) {
    console.log(`  ${k}: ${rows.map((r) => r.width).join(',')}`);
    for (const i of [...new Set(rows.flatMap((r) => r.clippedControls))].slice(0, 5)) console.log(`      ${i}`);
  }
}
if (show('img')) {
  console.log('== IMAGES');
  for (const r of R.filter((r) => r.brokenImages?.length || r.distorted?.length)) console.log(`  ${r.width} ${key(r)} broken=${r.brokenImages.length} distorted=${r.distorted.join('; ')}`);
}
if (show('cls')) {
  console.log('== LAYOUT SHIFT (CLS > 0.05)');
  for (const r of R.filter((r) => r.cls > 0.05)) console.log(`  ${r.width} ${key(r)} CLS=${r.cls.toFixed(3)}`);
}
if (show('labels')) {
  console.log('== FORM FIELDS WITHOUT A LABEL');
  for (const [k, rows] of group(R.filter((r) => r.unlabeled?.length && r.width === 1440), key)) {
    console.log(`  ${k}: ${rows[0].unlabeled.slice(0, 6).join(' | ')}`);
  }
}
if (show('slow')) {
  console.log('== SLOWEST (ms, 1440)');
  for (const r of R.filter((r) => r.width === 1440).sort((a, b) => b.ms - a.ms).slice(0, 10)) console.log(`  ${r.ms} ${key(r)}`);
}
if (show('tiny')) {
  console.log('== TEXT < 11 px on phones (text nodes, 375)');
  for (const r of R.filter((r) => r.width === 375 && r.tinyText > 0)) console.log(`  ${r.tinyText} ${key(r)}`);
}
