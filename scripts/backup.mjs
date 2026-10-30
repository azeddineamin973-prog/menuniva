// Usage:
//   npm run backup                         # backs up DATABASE_URL into ./backups
//   npm run backup -- --url=postgres://… --dir=/secure/backups --keep=14
// Writes <db>-<UTC timestamp>.ndjson.gz (+ .sha256), file mode 600. Keeps the newest --keep files.
// Backups contain guest personal data: store them encrypted, off the application server.
import 'dotenv/config';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { backup } from './lib/backup-core.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const url = arg('url') ?? process.env.DATABASE_URL;
const dir = path.resolve(arg('dir') ?? process.env.BACKUP_DIR ?? 'backups');
const keep = Number(arg('keep') ?? process.env.BACKUP_KEEP ?? 14);
if (!url) {
  console.error('DATABASE_URL (or --url) is required.');
  process.exit(1);
}
await mkdir(dir, { recursive: true, mode: 0o700 });
const db = new URL(url).pathname.slice(1) || 'db';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = path.join(dir, `${db}-${stamp}.ndjson.gz`);
const r = await backup(url, file);
console.log(`Backup written: ${r.file}\n  rows: ${r.rows}  migrations: ${r.migrations}  sha256: ${r.sha256}`);
const old = (await readdir(dir)).filter((f) => f.startsWith(`${db}-`) && f.endsWith('.ndjson.gz')).sort().reverse().slice(keep);
for (const f of old) {
  await rm(path.join(dir, f));
  await rm(path.join(dir, `${f}.sha256`), { force: true });
  console.log(`  pruned old backup ${f}`);
}
