// Removes ONLY the restaurants/users created by this audit (slug "audit-…", email "@audit.menuniva.invalid",
// the audit Super Admin) from the DEMO database, in one transaction. A backup is taken first (audit/backups).
import 'dotenv/config';
import pg from 'pg';
const url = process.env.DEMO_DATABASE_URL;
if (!url?.includes('menuniva_demo')) throw new Error('demo only');
const c = new pg.Client({ connectionString: url }); await c.connect();
await c.query('BEGIN');
const orgs = (await c.query(`SELECT id FROM "RestaurantOrganization" WHERE slug LIKE 'audit-%'`)).rows.map((r) => r.id);
const users = (await c.query(`SELECT id FROM "User" WHERE email LIKE '%@audit.menuniva.invalid' OR email = 'audit.admin@demo.menuniva.invalid'`)).rows.map((r) => r.id);
// Child tables that reference the organization without ON DELETE CASCADE
const fks = (await c.query(`SELECT conrelid::regclass::text AS t, a.attname AS col, confdeltype FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey) WHERE k.contype='f' AND k.confrelid = '"RestaurantOrganization"'::regclass`)).rows;
for (const f of fks.filter((f) => f.confdeltype !== 'c')) await c.query(`DELETE FROM ${f.t} WHERE "${f.col}" = ANY($1)`, [orgs]);
await c.query(`DELETE FROM "AuditLog" WHERE "organizationId" = ANY($1) OR "actorUserId" = ANY($2)`, [orgs, users]).catch(() => undefined);
const o = await c.query(`DELETE FROM "RestaurantOrganization" WHERE id = ANY($1)`, [orgs]);
const ufks = (await c.query(`SELECT conrelid::regclass::text AS t, a.attname AS col, confdeltype FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey) WHERE k.contype='f' AND k.confrelid = '"User"'::regclass AND confdeltype NOT IN ('c','n')`)).rows;
for (const f of ufks) await c.query(`UPDATE ${f.t} SET "${f.col}" = NULL WHERE "${f.col}" = ANY($1)`, [users]).catch(async () => c.query(`DELETE FROM ${f.t} WHERE "${f.col}" = ANY($1)`, [users]));
const u = await c.query(`DELETE FROM "User" WHERE id = ANY($1)`, [users]);
await c.query(`DELETE FROM "RateLimitBucket"`);
const left = (await c.query(`SELECT name, "isDemo" FROM "RestaurantOrganization" ORDER BY name`)).rows;
await c.query('COMMIT'); await c.end();
console.log(JSON.stringify({ deletedOrganizations: o.rowCount, deletedUsers: u.rowCount, remaining: left }));
