// Phase G: K guests place the FIRST orders on one fresh table at the same moment (K below the
// pool-starvation threshold). Counts how many OPEN table sessions (= separate bills) result.
//   node audit/phaseG-session-race.mjs <baseUrl> <K> <tableLabel> [<tableLabel> …]
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const [base, k, ...labels] = process.argv.slice(2);
const c = new pg.Client({ connectionString: process.env.DEMO_DATABASE_URL }); await c.connect();
const org = (await c.query(`select id from "RestaurantOrganization" where slug like 'audit-plan-%' order by "createdAt" desc limit 1`)).rows[0].id;
const prod = (await c.query(`select p.id from "MenuProduct" p where p."organizationId"=$1 and p.status='ACTIVE' limit 1`, [org])).rows[0].id;
for (const label of labels) {
  const t = (await c.query(`select t.id, q.token from "RestaurantTable" t join "TableQRToken" q on q."tableId"=t.id and q."isActive" where t."organizationId"=$1 and t.label=$2`, [org, label])).rows[0];
  const pre = Number((await c.query(`select count(*) from "TableSession" where "tableId"=$1`, [t.id])).rows[0].count);
  const st = await Promise.all(Array.from({ length: Number(k) }, (_, i) => fetch(`${base}/api/public/orders/table`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'user-agent': `race-${label}-${i}-${Date.now()}` }, body: JSON.stringify({ qrToken: t.token, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: prod, quantity: 1, modifiers: [] }] }) }).then((r) => r.status)));
  const sessions = (await c.query(`select s.id, s.status, (select count(*)::int from "Order" o where o."tableSessionId"=s.id) orders from "TableSession" s where s."tableId"=$1`, [t.id])).rows;
  console.log(JSON.stringify({ table: label, sessionsBefore: pre, statuses: st, openSessions: sessions.filter((s) => s.status === 'OPEN').length, ordersPerSession: sessions.map((s) => s.orders) }));
}
await c.end();
