// Phase G: N guests submit at the same moment, spread over all tables of the latest "Audit Security" restaurant (DEMO DB).
//   node audit/phaseG-concurrency.mjs <baseUrl> 5 8 10 12 20
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const [base, ...ns] = process.argv.slice(2);
const c = new pg.Client({ connectionString: process.env.DEMO_DATABASE_URL }); await c.connect();
const org = (await c.query(`select id from "RestaurantOrganization" where slug like 'audit-security-%' order by "createdAt" desc limit 1`)).rows[0].id;
const toks = (await c.query(`select q.token from "TableQRToken" q join "RestaurantTable" t on t.id=q."tableId" where t."organizationId"=$1 and q."isActive" order by t.label`, [org])).rows.map((r) => r.token);
const prod = (await c.query(`select p.id from "MenuProduct" p where p."organizationId"=$1 order by p."createdAt" limit 1`, [org])).rows[0].id;
for (const n of ns.map(Number)) {
  const before = Number((await c.query(`select count(*) from "Order" where "organizationId"=$1`, [org])).rows[0].count);
  const t0 = Date.now();
  const res = await Promise.all(Array.from({ length: n }, (_, i) => fetch(`${base}/api/public/orders/table`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'user-agent': `conc-${n}-${i}-${Date.now()}` }, body: JSON.stringify({ qrToken: toks[i % toks.length], idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: prod, quantity: 1, modifiers: [] }] }) }).then((r) => r.status).catch((e) => e.cause?.code ?? 'ERR')));
  const after = Number((await c.query(`select count(*) from "Order" where "organizationId"=$1`, [org])).rows[0].count);
  const tally = res.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ concurrent: n, tables: Math.min(n, toks.length), statuses: tally, ordersStored: after - before, ms: Date.now() - t0 }));
  await new Promise((r) => setTimeout(r, 1500));
}
await c.end();
