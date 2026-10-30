// Phase G: 15 simultaneous takeaway orders on the latest "Audit Takeaway" restaurant (DEMO DB).
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const base = process.argv[2];
const c = new pg.Client({ connectionString: process.env.DEMO_DATABASE_URL }); await c.connect();
const { id: org, slug } = (await c.query(`select id, slug from "RestaurantOrganization" where slug like 'audit-takeaway-%' order by "createdAt" desc limit 1`)).rows[0];
const loc = (await c.query(`select slug from "RestaurantLocation" where "organizationId"=$1`, [org])).rows[0].slug;
const prod = (await c.query(`select p.id from "MenuProduct" p join "ChannelPrice" cp on cp."productId"=p.id and cp.channel='TAKEAWAY' where p."organizationId"=$1 order by cp."amountCents" desc limit 1`, [org])).rows[0].id;
const before = Number((await c.query(`select count(*) from "Order" where "organizationId"=$1`, [org])).rows[0].count);
const st = await Promise.all(Array.from({ length: 15 }, (_, i) => fetch(`${base}/api/public/orders/pickup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'user-agent': `tk-${i}-${Date.now()}` }, body: JSON.stringify({ orgSlug: slug, locationSlug: loc, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: prod, quantity: 1, modifiers: [] }], pickup: 'asap', customerName: `Guest ${i}`, phone: '+351 911 000 300' }) }).then(async (r) => `${r.status}${r.ok ? '' : ':' + (await r.json()).error}`)));
const after = Number((await c.query(`select count(*) from "Order" where "organizationId"=$1`, [org])).rows[0].count);
console.log(JSON.stringify({ concurrentTakeaway: 15, statuses: st.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}), ordersStored: after - before }));
await c.end();
