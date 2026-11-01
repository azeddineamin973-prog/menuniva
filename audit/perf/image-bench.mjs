// Read-only benchmark of WebP/AVIF variants on a folder of photos (nothing is written).
// For each width: encoded size vs the original, encode time, and PSNR against a lossless resize
// of the original (higher = closer to it). Compare each format with the JPEG q82 row, the quality
// a typical web pipeline serves: equal or higher PSNR at fewer bytes is a strict improvement.
//   node audit/perf/image-bench.mjs <folder> [maxFiles=24]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = process.argv[2];
const max = Number(process.argv[3] ?? 24);
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jpe?g|png|webp)$/i.test(n) && !/\.w\d+\./.test(n)) files.push(p);
  }
})(dir);
const sample = files.filter((f) => f.includes(`${path.sep}products${path.sep}`)).slice(0, max);
const WIDTHS = (process.env.WIDTHS ?? '160,480,960').split(',').map(Number);
const ENC = {
  // Reference: what a normal web pipeline would serve (resized JPEG, quality 82).
  jpeg82: (s) => s.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }),
  // Defaults = the settings used by src/server/media-variants.ts.
  webp: (s) => s.webp({ quality: Number(process.env.WEBP_Q ?? 82), effort: 4 }),
  avif: (s) => s.avif({ quality: Number(process.env.AVIF_Q ?? 62), effort: 3 }),
};
async function psnr(encoded, original, width) {
  // Both flattened onto white: colours under fully transparent pixels are invisible and may change.
  const ref = await sharp(original).rotate().resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const got = await sharp(encoded).resize(ref.info.width, ref.info.height, { fit: 'fill' }).flatten({ background: '#ffffff' }).raw().toBuffer();
  let se = 0;
  for (let i = 0; i < ref.data.length; i++) se += (ref.data[i] - got[i]) ** 2;
  const mse = se / ref.data.length;
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}
const rows = {};
let originalTotal = 0;
for (const f of sample) {
  const original = readFileSync(f);
  originalTotal += original.length;
  for (const w of WIDTHS)
    for (const [fmt, enc] of Object.entries(ENC)) {
      const t0 = performance.now();
      const out = await enc(sharp(original).rotate().resize({ width: w, withoutEnlargement: true })).toBuffer();
      const ms = performance.now() - t0;
      const q = await psnr(out, original, w);
      const k = `${fmt} ${w}`;
      (rows[k] ??= []).push({ bytes: out.length, ms, q, orig: original.length });
    }
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`${sample.length} photos, originals: median ${Math.round(med(sample.map((f) => statSync(f).size)) / 1024)} KB, total ${(originalTotal / 1024 / 1024).toFixed(1)} MB`);
console.log('variant      median KB  % of original  median encode ms  p90 encode ms  median PSNR dB  min PSNR dB');
for (const [k, r] of Object.entries(rows)) {
  const pct = med(r.map((x) => (x.bytes / x.orig) * 100));
  const ms = r.map((x) => x.ms).sort((a, b) => a - b);
  console.log(
    `${k.padEnd(11)}  ${(med(r.map((x) => x.bytes)) / 1024).toFixed(1).padStart(9)}  ${pct.toFixed(1).padStart(13)}  ${med(ms).toFixed(0).padStart(16)}  ${ms[Math.floor(ms.length * 0.9)].toFixed(0).padStart(13)}  ${med(r.map((x) => x.q)).toFixed(1).padStart(14)}  ${Math.min(...r.map((x) => x.q)).toFixed(1).padStart(11)}`,
  );
}
