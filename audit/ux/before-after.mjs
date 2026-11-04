// Side-by-side BEFORE | AFTER images of the ordering journey (UX sandbox screenshots).
//   node audit/ux/before-after.mjs <before-dir> <after-dir> <out-dir>
import { mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';
const [before, after, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pairs = process.argv.slice(5).length ? process.argv.slice(5) : ['mobile-01-storefront', 'mobile-02-delivery-menu', 'mobile-03-dish', 'mobile-05-cart', 'mobile-06-checkout-empty', 'mobile-08-confirmation', 'desktop-02-delivery-menu', 'desktop-05-cart', 'desktop-07-checkout-filled', 'desktop-10-live-orders', 'mobile-11-driver', 'desktop-12-delivery-management'];
for (const name of pairs) {
  const a = `${before}/${name}.png`, b = `${after}/${name}.png`;
  if (!existsSync(a) || !existsSync(b)) continue;
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
  const h = Math.min(ma.height, mb.height, ma.width > 1000 ? 900 : 1300);
  const crop = (f, m) => sharp(f).extract({ left: 0, top: 0, width: m.width, height: Math.min(h, m.height) }).toBuffer();
  const gap = 24, label = 44;
  const [ia, ib] = await Promise.all([crop(a, ma), crop(b, mb)]);
  const W = ma.width + mb.width + gap * 3;
  const svg = (t, x) => ({ input: Buffer.from(`<svg width="${ma.width}" height="${label}"><text x="0" y="30" font-family="Helvetica" font-size="24" font-weight="700" fill="#222">${t}</text></svg>`), left: x, top: 8 });
  await sharp({ create: { width: W, height: h + label + gap, channels: 3, background: '#ececec' } })
    .composite([svg('BEFORE', gap), svg('AFTER', ma.width + gap * 2), { input: ia, left: gap, top: label }, { input: ib, left: ma.width + gap * 2, top: label }])
    .png()
    .toFile(`${out}/${name}.png`);
  console.log('✓', name);
}
