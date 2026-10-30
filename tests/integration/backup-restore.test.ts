import { execFileSync } from 'node:child_process';
import { appendFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { submitFeedback } from '@/server/services/feedback';
import { submitTableOrder } from '@/server/services/orders';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';
// @ts-expect-error plain ESM script without type declarations
import { backup, restore } from '../../scripts/lib/backup-core.mjs';

/** M13-05: a real backup of the test database is restored into a brand-new database and compared. */
const SOURCE = process.env.DATABASE_URL!;
const scratchUrl = (name: string) => {
  const u = new URL(SOURCE);
  u.pathname = `/${name}`;
  return u.toString();
};
const SCRATCH = 'menuniva_restore_check';
async function admin(sql: string) {
  const c = new pg.Client({ connectionString: scratchUrl('postgres') });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}
async function rows(url: string, sql: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql)).rows;
  } finally {
    await c.end();
  }
}
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mn-backup-'));
  await admin(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${SCRATCH}`);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: scratchUrl(SCRATCH) }, stdio: 'pipe' });
}, 120_000);
afterAll(async () => {
  await admin(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await rm(dir, { recursive: true, force: true });
});

describe('M13-05 backup & restore', () => {
  it('backs up a consistent snapshot and restores it exactly into an empty, migrated database', async () => {
    await resetDatabase();
    const f = await createOrderingFixture();
    await db.restaurantLocation.update({ where: { id: f.location.id }, data: { openingHours: { mon: [{ open: '12:00', close: '15:00' }] } } });
    await submitTableOrder({ qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: [{ productId: f.tea.id, quantity: 2, modifiers: [{ optionId: f.honey.id, quantity: 1 }] }] }, 'k');
    await submitFeedback({ orgSlug: f.org.slug, rating: 2, categories: ['SERVICE', 'WAITING_TIME'], comment: 'Ação “lenta”, 😀', language: 'pt' }, 'k');

    const file = path.join(dir, 'test.ndjson.gz');
    const b = await backup(SOURCE, file);
    expect(b.rows).toBeGreaterThan(20);
    expect(b.sha256).toMatch(/^[a-f0-9]{64}$/);

    const r = await restore(scratchUrl(SCRATCH), file);
    expect(r.restoredRows).toBe(b.rows);
    for (const table of ['Order', 'OrderItem', 'CustomerFeedback', 'RestaurantLocation', 'MenuProduct', 'ModifierOption', 'AuditLog']) {
      const sql = `SELECT row_to_json(t)::text AS j FROM "${table}" t ORDER BY id`;
      expect(await rows(scratchUrl(SCRATCH), sql), table).toEqual(await rows(SOURCE, sql));
    }

    // A second restore into the now non-empty database is refused and changes nothing.
    await expect(restore(scratchUrl(SCRATCH), file)).rejects.toThrow(/not empty/);

    // A damaged file is refused by its checksum.
    const bad = path.join(dir, 'bad.ndjson.gz');
    await copyFile(file, bad);
    await copyFile(`${file}.sha256`, `${bad}.sha256`);
    await appendFile(bad, 'x');
    await expect(restore(scratchUrl(SCRATCH), bad)).rejects.toThrow(/Checksum mismatch/);
  }, 120_000);

  it('refuses a target that does not have the backup migrations applied', async () => {
    await resetDatabase();
    const file = path.join(dir, 'empty.ndjson.gz');
    await backup(SOURCE, file);
    await admin(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${SCRATCH}`);
    await expect(restore(scratchUrl(SCRATCH), file)).rejects.toThrow(/migrate deploy/);
  }, 60_000);
});
