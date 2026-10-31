// Looks up IDs the crawler needs (open table session, a kitchen ticket) in menuniva_test_ux.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const u = new URL(process.env.TEST_DATABASE_URL ?? '');
u.pathname = '/menuniva_test_ux';
const c = new pg.Client({ connectionString: u.toString() });
await c.connect();
const one = async (q) => (await c.query(q)).rows[0];
const session = await one(`SELECT s.id FROM "TableSession" s JOIN "Order" o ON o."tableSessionId" = s.id WHERE s.status = 'OPEN' GROUP BY s.id ORDER BY count(o.id) DESC LIMIT 1`);
const ticket = await one(`SELECT id FROM "KitchenTicket" ORDER BY "createdAt" DESC LIMIT 1`);
const ids = { sessionId: session?.id, ticketId: ticket?.id };
writeFileSync('audit/ux/out/ids.json', JSON.stringify(ids));
console.log(ids);
await c.end();
