import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M13-07 migration safety lint. Statements that can lose data must be reviewed explicitly:
 * the migration has to contain the line `-- menuniva: reviewed-destructive <reason>` (and the
 * release notes must describe the data step). Applied migrations must never be edited.
 */
const DIR = path.resolve(__dirname, '../../prisma/migrations');
const migrations = readdirSync(DIR)
  .filter((d) => statSync(path.join(DIR, d)).isDirectory())
  .sort();
const DESTRUCTIVE = [/\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA)\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i, /\bRENAME\s+(COLUMN|TO)\b/i, /\bSET\s+NOT\s+NULL\b/i];

describe('M13-07 migration safety', () => {
  it('migration folders are timestamped, in order, each with a migration.sql', () => {
    expect(migrations.length).toBeGreaterThan(0);
    for (const m of migrations) {
      expect(m).toMatch(/^\d{14}_[a-z0-9_]+$/);
      expect(statSync(path.join(DIR, m, 'migration.sql')).isFile()).toBe(true);
    }
  });

  it('no unreviewed destructive SQL', () => {
    const problems: string[] = [];
    for (const m of migrations) {
      const sql = readFileSync(path.join(DIR, m, 'migration.sql'), 'utf8');
      if (/--\s*menuniva:\s*reviewed-destructive\s+\S/.test(sql)) continue;
      for (const re of DESTRUCTIVE) if (re.test(sql)) problems.push(`${m}: ${re.source}`);
    }
    expect(problems).toEqual([]);
  });

  it('new NOT NULL columns on existing tables have a default', () => {
    const problems: string[] = [];
    for (const m of migrations.slice(1)) {
      const sql = readFileSync(path.join(DIR, m, 'migration.sql'), 'utf8');
      for (const line of sql.split('\n')) if (/ADD COLUMN/i.test(line) && /NOT NULL/i.test(line) && !/DEFAULT/i.test(line)) problems.push(`${m}: ${line.trim()}`);
    }
    expect(problems).toEqual([]);
  });
});
