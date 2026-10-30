// One-time Super Admin bootstrap.
//
//   npm run setup:admin-token
//
// Prints a single-use link (valid 60 minutes) that lets you create the first MenuNiva
// platform administrator. Refuses to run once an administrator exists. There is no
// default admin password anywhere in MenuNiva.
import 'dotenv/config';
import { hashToken, newSecretToken } from '../src/server/crypto';
import { db } from '../src/server/db';
import { env } from '../src/server/env';
import { ensureDefaultPlans } from '../src/server/services/plans';

async function main() {
  const admins = await db.user.count({ where: { platformRole: 'PLATFORM_SUPER_ADMIN' } });
  if (admins > 0) {
    console.log('A platform administrator already exists. Setup links can no longer be created.');
    console.log('Sign in at', `${env.APP_BASE_URL}/login`);
    return;
  }
  await ensureDefaultPlans();
  await db.platformSetupToken.deleteMany({ where: { usedAt: null } });
  const token = newSecretToken();
  await db.platformSetupToken.create({
    data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60_000) },
  });
  console.log('\nOpen this link within 60 minutes to create the MenuNiva Super Admin account:\n');
  console.log(`  ${env.APP_BASE_URL}/setup?token=${token}\n`);
  console.log('The link works only once. Do not share it.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
