// Local development PostgreSQL server for MenuNiva.
//
// Runs a real PostgreSQL 18 server from the `embedded-postgres` npm package,
// so no Homebrew, Docker or Postgres.app installation is needed on this Mac.
// Data is stored in ./.data/postgres (git-ignored).
//
// Usage:  npm run db:local      (leave this terminal open while developing)
//
// Production must use a managed PostgreSQL server instead (see docs/DEPLOYMENT.md).
import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const password = process.env.LOCAL_PG_PASSWORD;
if (!password) {
  console.error('LOCAL_PG_PASSWORD is missing. Copy .env.example to .env and set it.');
  process.exit(1);
}

const databaseDir = path.resolve('.data/postgres');
const pg = new EmbeddedPostgres({
  databaseDir,
  port,
  user: 'menuniva',
  password,
  authMethod: 'scram-sha-256',
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (e) => console.error('[postgres]', e),
});

const firstRun = !existsSync(path.join(databaseDir, 'PG_VERSION'));
if (firstRun) {
  console.log('Initialising local PostgreSQL data directory…');
  await pg.initialise();
}
await pg.start();

// Separate databases: development (real tenants), test (automated tests), demo (fake labelled data).
const client = pg.getPgClient('postgres', '127.0.0.1');
await client.connect();
for (const db of ['menuniva_dev', 'menuniva_test', 'menuniva_demo']) {
  const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
  if (res.rowCount === 0) {
    await client.query(`CREATE DATABASE "${db}"`);
    console.log(`Created database ${db}`);
  }
}
await client.end();

console.log(`MenuNiva local PostgreSQL is running on 127.0.0.1:${port}. Press Ctrl+C to stop.`);

const shutdown = async () => {
  console.log('Stopping PostgreSQL…');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
