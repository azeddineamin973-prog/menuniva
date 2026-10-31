// Lists every problem the crawler recorded in one or more runs.
import { readFileSync } from 'node:fs';
let total = 0, bad = 0;
for (const run of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(`audit/artifacts/ux/${run}/results.json`, 'utf8'));
  const v = r.views ?? r;
  total += v.length;
  for (const x of v) {
    const p = [];
    if (x.status >= 500 || (x.status >= 400 && x.status !== 404)) p.push(`HTTP ${x.status}`);
    if (x.scrollWidth > x.innerWidth) p.push(`overflow ${x.scrollWidth}px`);
    if (x.consoleErrors?.length) p.push(`console: ${x.consoleErrors.slice(0, 2).join(' | ').slice(0, 160)}`);
    if (x.overflowers?.length) p.push(`overflowing: ${JSON.stringify(x.overflowers.slice(0, 2)).slice(0, 160)}`);
    const small = (x.small ?? []).filter((s) => s.fail);
    if (small.length) p.push(`tap<24: ${small.slice(0, 2).map((s) => s.d).join(' | ').slice(0, 160)}`);
    if (x.clippedControls?.length) p.push(`clipped: ${JSON.stringify(x.clippedControls.slice(0, 2)).slice(0, 160)}`);
    if (x.brokenImages?.length) p.push(`broken img ${x.brokenImages.length}`);
    if (x.unlabeled?.length) p.push(`unlabeled: ${JSON.stringify(x.unlabeled.slice(0, 2)).slice(0, 160)}`);
    if (x.cls > 0.1) p.push(`CLS ${x.cls.toFixed(2)}`);
    if (p.length) { bad++; console.log(`${x.width} ${x.role} ${x.route}\n   ${p.join('\n   ')}`); }
  }
}
console.log(`${bad} of ${total} views with issues`);
