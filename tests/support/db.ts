import { db } from '@/server/db';

/** Removes all rows from every application table in the TEST database. */
export async function resetDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('menuniva_test')) throw new Error('Refusing to reset a non-test database');
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;
export async function createTestUser(name = 'Test User') {
  counter += 1;
  return db.user.create({
    data: { name, email: `user${Date.now()}${counter}@test.menuniva.local`, passwordHash: 'not-a-real-hash' },
  });
}
