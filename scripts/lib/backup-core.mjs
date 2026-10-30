// MenuNiva logical backup / restore (M13-05). Plain Node + the `pg` driver: no PostgreSQL client
// tools needed, works against managed databases. Format: gzip'd NDJSON
//   line 1: header { format, version, createdAt, database, migrations[], tables{name: rowCount} }
//   then:   { t: "Table", r: { ...row } }   (one line per row)
// The dump is taken inside one REPEATABLE READ READ ONLY transaction (consistent snapshot).
// Restore requires an EMPTY database with exactly the same migrations applied, inserts tables in
// foreign-key order inside one transaction, and verifies row counts before committing.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import pg from 'pg';

const FORMAT = 'menuniva-backup';
const BATCH = 2000;
const q = (name) => `"${name.replace(/"/g, '""')}"`;

async function appTables(c) {
  const r = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`);
  return r.rows.map((x) => x.tablename);
}
async function appliedMigrations(c) {
  const r = await c.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
  return r.rows.map((x) => x.migration_name);
}
/** Parents before children (throws on a cycle). */
async function fkOrder(c, tables) {
  const r = await c.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`);
  const strip = (s) => s.replace(/^"|"$/g, '');
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of r.rows) if (strip(child) !== strip(parent) && deps.has(strip(child))) deps.get(strip(child)).add(strip(parent));
  const out = [];
  const state = new Map();
  const visit = (t) => {
    if (state.get(t) === 'done') return;
    if (state.get(t) === 'busy') throw new Error(`Foreign-key cycle at ${t}`);
    state.set(t, 'busy');
    for (const p of deps.get(t) ?? []) visit(p);
    state.set(t, 'done');
    out.push(t);
  };
  tables.forEach(visit);
  return out;
}

export async function sha256File(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), async function* (src) {
    for await (const chunk of src) h.update(chunk);
  });
  return h.digest('hex');
}

export async function backup(url, file) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = await appTables(c);
    const hasTable = (await c.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`)).rows[0].ok;
    const migrations = hasTable ? await appliedMigrations(c) : [];
    const counts = {};
    for (const t of tables) counts[t] = Number((await c.query(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n);
    const database = (await c.query('SELECT current_database() AS d')).rows[0].d;
    async function* lines() {
      yield `${JSON.stringify({ format: FORMAT, version: 1, createdAt: new Date().toISOString(), database, migrations, tables: counts })}\n`;
      for (const t of tables) {
        for (let off = 0; off < counts[t]; off += BATCH) {
          const r = await c.query(`SELECT row_to_json(x)::text AS j FROM (SELECT * FROM ${q(t)} ORDER BY ctid LIMIT ${BATCH} OFFSET ${off}) x`);
          let chunk = '';
          for (const row of r.rows) chunk += `{"t":${JSON.stringify(t)},"r":${row.j}}\n`;
          yield chunk;
        }
      }
    }
    await pipeline(Readable.from(lines()), createGzip(), createWriteStream(file, { mode: 0o600 }));
    await c.query('COMMIT');
    const digest = await sha256File(file);
    await writeFile(`${file}.sha256`, `${digest}  ${file.split('/').pop()}\n`, { mode: 0o600 });
    return { file, sha256: digest, database, migrations: migrations.length, rows: Object.values(counts).reduce((a, b) => a + b, 0), tables: counts };
  } finally {
    await c.end();
  }
}

async function readBackup(file) {
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let header = null;
  const rows = new Map();
  for await (const line of rl) {
    if (!line) continue;
    if (!header) {
      header = JSON.parse(line);
      if (header.format !== FORMAT || header.version !== 1) throw new Error('Not a MenuNiva backup file (or unsupported version).');
      continue;
    }
    const { t, r } = JSON.parse(line);
    if (!rows.has(t)) rows.set(t, []);
    rows.get(t).push(r);
  }
  if (!header) throw new Error('Empty backup file.');
  return { header, rows };
}

export async function restore(url, file) {
  try {
    const expected = (await readFile(`${file}.sha256`, 'utf8')).split(/\s+/)[0];
    if (expected && expected !== (await sha256File(file))) throw new Error('Checksum mismatch: the backup file is damaged or was modified.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const { header, rows } = await readBackup(file);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const migrations = await appliedMigrations(c).catch(() => {
      throw new Error('Target has no Prisma migrations table. Run `prisma migrate deploy` on it first.');
    });
    if (JSON.stringify(migrations) !== JSON.stringify(header.migrations)) {
      throw new Error(`Schema mismatch: target has ${migrations.length} migrations, backup was taken at ${header.migrations.length}. Apply exactly the backup's migrations first.`);
    }
    const tables = await appTables(c);
    for (const t of tables) {
      const n = Number((await c.query(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n);
      if (n > 0) throw new Error(`Target database is not empty (${t} has ${n} rows). Restore only into a new, empty database.`);
    }
    const unknown = Object.keys(header.tables).filter((t) => !tables.includes(t));
    if (unknown.length) throw new Error(`Backup contains tables missing in the target: ${unknown.join(', ')}`);
    await c.query('BEGIN');
    for (const t of await fkOrder(c, tables)) {
      const list = rows.get(t) ?? [];
      for (let i = 0; i < list.length; i += BATCH) {
        await c.query(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(NULL::${q(t)}, $1::json)`, [JSON.stringify(list.slice(i, i + BATCH))]);
      }
    }
    for (const [t, n] of Object.entries(header.tables)) {
      const got = Number((await c.query(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n);
      if (got !== n) throw new Error(`Row count mismatch in ${t}: expected ${n}, restored ${got}.`);
    }
    await c.query('COMMIT');
    return { restoredRows: Object.values(header.tables).reduce((a, b) => a + b, 0), tables: Object.keys(header.tables).length, backupCreatedAt: header.createdAt };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}
