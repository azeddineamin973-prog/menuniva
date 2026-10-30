import pg from 'pg';

/**
 * Exclusive use of a test database for one whole test run.
 *
 * Root cause of the sporadic E2E 404 (audit 2026-10-30, BUG-02): Vitest truncates every table of
 * menuniva_test in many tests, while Playwright seeds a restaurant there and opens its table page.
 * Running both at the same time deleted the just-seeded table → the page correctly answered 404.
 *
 * The lock is a PostgreSQL session advisory lock held by a dedicated connection until the run
 * ends (released automatically if the process dies). A second run fails at once with a clear
 * message instead of corrupting the first one.
 */
const KEYS = { menuniva_test: 7_316_001, menuniva_demo: 7_316_002 } as const;

export async function acquireExclusiveDb(url: string, suite: string): Promise<() => Promise<void>> {
  const name = new URL(url).pathname.slice(1) as keyof typeof KEYS;
  const key = KEYS[name];
  if (!key) throw new Error(`No test lock defined for database "${name}"`);
  const client = new pg.Client({ connectionString: url, application_name: `menuniva-test-lock:${suite}` });
  await client.connect();
  const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [key]);
  if (!rows[0].ok) {
    const holder = await client
      .query<{ app: string }>(`SELECT application_name AS app FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.objid = $1`, [key])
      .catch(() => ({ rows: [] as { app: string }[] }));
    await client.end();
    throw new Error(
      `${name} is already in use by another test run (${holder.rows[0]?.app ?? 'unknown'}). ` +
        `Run the unit/integration, browser and demo suites one after the other, not at the same time.`,
    );
  }
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => undefined);
    await client.end().catch(() => undefined);
  };
}
