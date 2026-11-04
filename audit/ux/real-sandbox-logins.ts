// Sets a known password on the restaurant's staff accounts in the real-data UX SANDBOX only
// (menuniva_ux_real), so the staff screens can be captured. Never run against another database.
//   npx tsx --conditions=react-server audit/ux/real-sandbox-logins.ts
import 'dotenv/config';
const u = new URL(process.env.DATABASE_URL ?? '');
u.pathname = '/menuniva_ux_real';
process.env.DATABASE_URL = u.toString();
process.env.APP_ENV = 'test';

async function main() {
  const { hashPassword } = await import('../../src/server/auth/password');
  const { db } = await import('../../src/server/db');
  if (!process.env.DATABASE_URL?.includes('/menuniva_ux_real')) throw new Error('Refusing: not the UX sandbox');
  const passwordHash = await hashPassword('sandbox-password-123');
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { slug: 'huihugiy' } });
  const members = await db.restaurantMembership.findMany({ where: { organizationId: org.id }, include: { user: true } });
  for (const m of members) await db.user.update({ where: { id: m.userId }, data: { passwordHash } });
  console.log(JSON.stringify(members.map((m) => ({ role: m.role, email: m.user.email }))));
  await db.$disconnect();
}
main();
