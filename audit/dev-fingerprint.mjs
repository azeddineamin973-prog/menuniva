// Read-only fingerprint of the DEVELOPMENT database: row count + md5 of row contents per table.
// Run before and after the audit to prove the dev data was not touched.
import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const t = (await c.query(`select tablename from pg_tables where schemaname='public' order by 1`)).rows.map(r => r.tablename);
const out = { db: (await c.query('select current_database() d')).rows[0].d, tables: {} };
for (const name of t) {
  const r = await c.query(`select count(*)::int n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from "${name}" x`);
  out.tables[name] = `${r.rows[0].n}:${r.rows[0].h.slice(0, 12)}`;
}
await c.query('COMMIT'); await c.end();
console.log(JSON.stringify(out, null, 1));
