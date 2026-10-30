// Compares databases table by table (row count + md5 of all rows, ordered). Read-only.
import pg from 'pg';
const urls = process.argv.slice(2);
const fp = async (url) => {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const t = (await c.query(`select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1`)).rows.map((r) => r.tablename);
  const out = {};
  for (const name of t) { const r = await c.query(`select count(*)::int n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from "${name}" x`); out[name] = `${r.rows[0].n}:${r.rows[0].h}`; }
  await c.query('COMMIT'); await c.end(); return out;
};
const prints = await Promise.all(urls.map(fp));
const names = Object.keys(prints[0]);
let diff = 0, rows = 0;
for (const n of names) { const vals = prints.map((p) => p[n]); rows += Number(vals[0].split(':')[0]); if (new Set(vals).size > 1) { diff++; console.log('DIFF', n, vals.join(' vs ')); } }
console.log(`tables=${names.length} rows(first db)=${rows} tablesDiffering=${diff} databases=${urls.map((u) => new URL(u).pathname.slice(1)).join(',')}`);
