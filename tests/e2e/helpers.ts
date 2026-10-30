import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { expect, type Page } from '@playwright/test';

loadEnv();
const TEST_DB = process.env.TEST_DATABASE_URL ?? '';

export type Seed = { orgSlug: string; orgId: string; locationId: string; dishId: string; plainDishId: string; password: string; owner: string; cook: string; waiter: string; driver: string; qrToken: string };

/** Creates a fictitious restaurant in the TEST database via the real services. */
export function seed(prefix: string): Seed {
  const out = execFileSync('npx', ['tsx', '--conditions=react-server', 'tests/e2e/seed.ts', prefix], { env: { ...process.env, DATABASE_URL: TEST_DB }, encoding: 'utf8' });
  const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'));
  return JSON.parse(line!);
}

export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Inserts a one-time Super Admin setup token (as the CLI would) and returns the raw token. */
export async function issueSetupToken(): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await sql(`INSERT INTO "PlatformSetupToken" (id, "tokenHash", "expiresAt") VALUES ($1, $2, now() + interval '1 hour')`, [
    `e2e${Date.now()}`,
    createHash('sha256').update(token).digest('hex'),
  ]);
  return token;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-form').locator('input[name=email]').fill(email);
  await page.getByTestId('login-form').locator('input[name=password]').fill(password);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Tiny valid PNG (1×1, red) for upload tests. */
export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
