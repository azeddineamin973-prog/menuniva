import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { databasePoolConfig } from './db-config';
import { env } from './env';

/**
 * Single Prisma client per process. In development, Next.js hot reload would otherwise
 * create a new connection pool on every edit.
 */
const globalForPrisma = globalThis as unknown as { __menunivaPrisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg(databasePoolConfig(env.DATABASE_URL, env.DATABASE_CA_CERT, env.DATABASE_POOL_MAX));
  // Profiling aid, off unless DB_QUERY_LOG=1: one line per query with its duration and a
  // timestamp, so a page's query count and cost can be measured. Never logs parameters.
  if (process.env.DB_QUERY_LOG === '1' && env.APP_ENV !== 'production') {
    const client = new PrismaClient({ adapter, log: [{ level: 'query', emit: 'event' }, 'warn', 'error'] });
    client.$on('query', (e) => console.log(`[db] ${Date.now()} ${e.duration}ms ${e.query.replace(/\s+/g, ' ').slice(0, 160)}`));
    return client as unknown as PrismaClient;
  }
  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}

export const db: PrismaClient = globalForPrisma.__menunivaPrisma ?? createClient();
if (env.APP_ENV !== 'production') globalForPrisma.__menunivaPrisma = db;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
