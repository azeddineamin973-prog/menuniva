// Read-only integrity checks on the TEST, DEMO and DEV databases.
import 'dotenv/config';
import pg from 'pg';
const checks = {
  tablesWithSeveralOpenSessions: `select count(*)::int n from (select "tableId" from "TableSession" where status='OPEN' group by 1 having count(*)>1) x`,
  ordersPaidMoreThanTotal: `select count(*)::int n from "Order" where "paidCents" > "totalCents"`,
  ordersPaidNotEqualPayments: `select count(*)::int n from "Order" o where o."paidCents" <> coalesce((select sum("amountCents") from "PaymentRecord" p where p."orderId"=o.id and p.status='RECORDED'),0)`,
  possibleDuplicatePayments: `select count(*)::int n from (select "orderId","amountCents",method,date_trunc('second',"createdAt") from "PaymentRecord" where status='RECORDED' group by 1,2,3,4 having count(*)>1) x`,
  discountAboveSubtotal: `select count(*)::int n from "Order" where "discountCents" > "subtotalCents"`,
  discountRowsNotMatchingOrder: `select count(*)::int n from "Order" o where o."discountCents" > 0 and o."discountCents" <> coalesce((select sum("amountCents") from "OrderDiscount" d where d."orderId"=o.id),0)`,
  negativeTotals: `select count(*)::int n from "Order" where "totalCents" < 0`,
  totalsNotSubtotalMinusDiscountPlusFee: `select count(*)::int n from "Order" where "totalCents" <> "subtotalCents" - "discountCents" + "deliveryFeeCents"`,
  duplicateIdempotencyKeys: `select count(*)::int n from (select "locationId","idempotencyKey" from "Order" group by 1,2 having count(*)>1) x`,
};
for (const [name, url] of [['test', process.env.TEST_DATABASE_URL], ['demo', process.env.DEMO_DATABASE_URL], ['dev', process.env.DATABASE_URL]]) {
  const c = new pg.Client({ connectionString: url }); await c.connect(); await c.query('SET default_transaction_read_only = on');
  const out = { db: name, orders: (await c.query('select count(*)::int n from "Order"')).rows[0].n };
  for (const [k, q] of Object.entries(checks)) out[k] = (await c.query(q)).rows[0].n;
  console.log(JSON.stringify(out));
  await c.end();
}
