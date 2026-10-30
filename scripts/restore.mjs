// Usage (restore into a NEW, EMPTY database that has the same migrations applied):
//   DATABASE_URL=postgres://…/menuniva_restore npx prisma migrate deploy
//   npm run restore -- --file=backups/menuniva_prod-2026-….ndjson.gz --url=postgres://…/menuniva_restore --yes
// Refuses non-empty targets, schema mismatches and damaged files. Never point --url at the live
// database; switch the application to the restored database only after checking it.
import 'dotenv/config';
import { restore } from './lib/backup-core.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const file = arg('file');
const url = arg('url');
if (!file || !url) {
  console.error('Both --file=<backup> and --url=<target database> are required.');
  process.exit(1);
}
if (url === process.env.DATABASE_URL && !process.argv.includes('--into-configured-database')) {
  console.error('Refusing to restore into the database configured in DATABASE_URL. Restore into a new database first.');
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.error(`About to restore ${file} into ${new URL(url).host}${new URL(url).pathname}. Re-run with --yes to continue.`);
  process.exit(1);
}
try {
  const r = await restore(url, file);
  console.log(`Restored ${r.restoredRows} rows in ${r.tables} tables (backup from ${r.backupCreatedAt}). Row counts verified.`);
} catch (e) {
  console.error(`Restore failed, nothing was changed: ${e.message}`);
  process.exit(1);
}
