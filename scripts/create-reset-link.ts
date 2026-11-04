// Password reset link from the terminal, for when nobody can create one in the app.
//
//   npm run reset-link -- --email=owner@example.com
//
// MenuNiva has no email sender yet, so "Forgot your password?" cannot deliver a link. Inside the app
// only a restaurant owner (for their staff) or the Super Admin can create one; an owner who forgets
// their own password, with no Super Admin, has no way back in. This prints the same single-use,
// 30-minute link the app creates. Running it requires access to this machine's .env and database,
// which already gives full control of the data, so it grants nothing new. Recorded in the audit log.
import 'dotenv/config';
import { createPasswordResetLink } from '../src/server/auth/reset';
import { db } from '../src/server/db';
import { env } from '../src/server/env';

async function main() {
  const email = process.argv.find((a) => a.startsWith('--email='))?.slice('--email='.length).trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run reset-link -- --email=<account email>');
    process.exitCode = 1;
    return;
  }
  const target = new URL(env.DATABASE_URL);
  console.log(`Database: ${target.host}${target.pathname} (APP_ENV=${env.APP_ENV})`);
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (!user) {
    console.error(`No account with the email ${email} in this database. Nothing was changed.`);
    process.exitCode = 1;
    return;
  }
  const link = await createPasswordResetLink(user.id);
  await db.auditLog.create({ data: { actorUserId: null, action: 'platform.reset_link_created', entityType: 'User', entityId: user.id, metadata: { via: 'terminal' } } });
  console.log(`\nPassword reset link for ${user.name} <${email}>. Open it within 30 minutes:\n`);
  console.log(`  ${link}\n`);
  console.log('The link works once. Any older reset link for this account no longer works. Do not share it.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
