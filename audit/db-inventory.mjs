// Read-only inventory of local databases (session set to read-only; no writes).
import 'dotenv/config';
import pg from 'pg';
const urls = { dev: process.env.DATABASE_URL, test: process.env.TEST_DATABASE_URL, demo: process.env.DEMO_DATABASE_URL };
const T = ['RestaurantOrganization','User','RestaurantMembership','RestaurantLocation','MenuProduct','Order','OrderItem','PaymentRecord','CustomerFeedback','Reservation','TableSession','RestaurantTable','LoyaltyAccount'];
for (const [k, url] of Object.entries(urls)) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const db = (await c.query('select current_database() d')).rows[0].d;
  const counts = {};
  for (const t of T) counts[t] = (await c.query(`select count(*)::int n from "${t}"`)).rows[0].n;
  const orgs = (await c.query(`select slug, name, status from "RestaurantOrganization" order by "createdAt" limit 8`)).rows;
  console.log(JSON.stringify({ env: k, db, counts, firstOrgs: orgs }));
  await c.end();
}
