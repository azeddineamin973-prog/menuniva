// Safe production/staging migration (M13-07):
//   npm run db:migrate:safe            # status → backup → migrate deploy → verify
//   npm run db:migrate:safe -- --dry-run
// Never use `prisma migrate dev` or `migrate reset` outside development: they can drop data.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { backup } from './lib/backup-core.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const dry = process.argv.includes('--dry-run');
const prisma = (args) => execFileSync('npx', ['prisma', ...args], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const target = `${new URL(url).host}${new URL(url).pathname}`;

console.log(`1/4 Migration status for ${target} (APP_ENV=${process.env.APP_ENV ?? 'development'})`);
let status = '';
try {
  status = prisma(['migrate', 'status']);
} catch (e) {
  status = `${e.stdout ?? ''}${e.stderr ?? ''}`; // exit code 1 = pending migrations
}
console.log(status.split('\n').filter((l) => /migration|pending|up to date|not yet been applied|failed/i.test(l)).map((l) => `   ${l}`).join('\n'));
if (/failed/i.test(status) && !/no failed/i.test(status)) {
  console.error('A previous migration failed. Resolve it first (see docs/DEPLOYMENT.md → Migrations). Nothing was changed.');
  process.exit(1);
}
if (/up to date/i.test(status)) {
  console.log('Database schema is up to date. Nothing to do.');
  process.exit(0);
}
if (dry) {
  console.log('--dry-run: stopping before backup and migration.');
  process.exit(0);
}

console.log('2/4 Backup before migrating');
const dir = path.resolve(process.env.BACKUP_DIR ?? 'backups');
await mkdir(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, `${new URL(url).pathname.slice(1)}-pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson.gz`);
const b = await backup(url, file);
console.log(`   ${b.rows} rows saved to ${b.file} (sha256 ${b.sha256.slice(0, 12)}…)`);

console.log('3/4 prisma migrate deploy');
try {
  console.log(prisma(['migrate', 'deploy']).split('\n').map((l) => `   ${l}`).join('\n'));
} catch (e) {
  console.error(`Migration failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`);
  console.error(`The pre-migration backup is ${file}. See docs/DEPLOYMENT.md → "If a migration fails".`);
  process.exit(1);
}

console.log('4/4 Verify');
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query(`SELECT count(*)::int AS n, bool_and(finished_at IS NOT NULL) AS ok FROM _prisma_migrations WHERE rolled_back_at IS NULL`);
await c.end();
if (!r.rows[0].ok) {
  console.error('A migration is recorded as unfinished. Investigate before restarting the app.');
  process.exit(1);
}
console.log(`   ${r.rows[0].n} migrations applied, all finished. Restart the application now.`);
