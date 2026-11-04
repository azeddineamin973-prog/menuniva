// Sets a random temporary password for an account, from the terminal (local recovery).
//
//   npm run set-temp-password -- --email=owner@example.com
//
// For when a reset link is not enough (e.g. the person cannot tell which password they saved).
// Running it requires this machine's .env and database, which already give full control of the
// data, so it grants nothing new. Signs the account out everywhere, checks the new password with
// the same code the login page uses, and records the change in the audit log.
// Change the temporary password after signing in (My account).
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { attemptLogin } from '../src/server/auth/login';
import { hashPassword } from '../src/server/auth/password';
import { db } from '../src/server/db';
import { env } from '../src/server/env';

// No look-alike characters (0/O, 1/l/I), so it can be typed from the screen without mistakes.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
function tempPassword() {
  const groups = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''));
  return groups.join('-');
}

async function main() {
  const email = process.argv.find((a) => a.startsWith('--email='))?.slice('--email='.length).trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run set-temp-password -- --email=<account email>');
    process.exitCode = 1;
    return;
  }
  const target = new URL(env.DATABASE_URL);
  console.log(`Database: ${target.host}${target.pathname} (APP_ENV=${env.APP_ENV})`);
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, disabledAt: true } });
  if (!user) {
    console.error(`No account with the email ${email} in this database. Nothing was changed.`);
    process.exitCode = 1;
    return;
  }
  if (user.disabledAt) {
    console.error('This account is disabled. Nothing was changed.');
    process.exitCode = 1;
    return;
  }
  const password = tempPassword();
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash } }),
    db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    // Clears this email's failed-login counter so earlier wrong attempts cannot block the first sign-in.
    db.rateLimitBucket.deleteMany({ where: { key: `login:email:${email}` } }),
    db.auditLog.create({ data: { actorUserId: null, action: 'user.password_set_by_operator', entityType: 'User', entityId: user.id, metadata: { via: 'terminal' } } }),
  ]);
  const check = await attemptLogin(email, password, null);
  if (!check.ok) {
    console.error(`The new password was saved but the login check failed (${check.error}). Do not rely on it.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nTemporary password set for ${user.name}. Login check: OK.\n`);
  console.log(`  Sign in at: ${env.APP_BASE_URL}/login`);
  console.log(`  Email:      ${email}`);
  console.log(`  Password:   ${password}\n`);
  console.log('All earlier sessions of this account were signed out. Change this password after signing in.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
