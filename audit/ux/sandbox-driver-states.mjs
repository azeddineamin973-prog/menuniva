// Real-data UX SANDBOX only (menuniva_ux_real): gives the delivery driver three active sandbox
// orders (ready, out for delivery, being prepared) so the driver screen can be reviewed in every
// state. Uses only the sandbox test orders ("Cliente Teste (sandbox)"). Never the real database.
//   node audit/ux/sandbox-driver-states.mjs
import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;
(async () => {
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = '/menuniva_ux_real';
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  const [driver] = (await c.query(`SELECT m.id FROM "RestaurantMembership" m JOIN "RestaurantOrganization" o ON o.id = m."organizationId" WHERE o.slug = 'huihugiy' AND m.role = 'DELIVERY_STAFF' LIMIT 1`)).rows;
  const orders = (await c.query(`SELECT o.id FROM "Order" o JOIN "DeliveryOrderDetails" d ON d."orderId" = o.id WHERE o."customerName" = 'Cliente Teste (sandbox)' ORDER BY o.number DESC LIMIT 3`)).rows;
  const states = ['READY', 'OUT_FOR_DELIVERY', 'PREPARING'];
  for (const [i, o] of orders.entries()) {
    await c.query(`UPDATE "Order" SET status = $1, "cancelReason" = NULL, "cancelledAt" = NULL, "createdAt" = now() - ($2 || ' minutes')::interval WHERE id = $3`, [states[i], String(8 + i * 6), o.id]);
    await c.query(`UPDATE "DeliveryOrderDetails" SET "driverMembershipId" = $1, notes = $2 WHERE "orderId" = $3`, [driver.id, i === 1 ? '2.º andar, tocar à campainha B' : null, o.id]);
  }
  console.log(`sandbox: ${orders.length} driver orders set to ${states.slice(0, orders.length).join(', ')}`);
  await c.end();
})();
