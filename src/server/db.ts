import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from './env';

/**
 * Single Prisma client per process. In development, Next.js hot reload would otherwise
 * create a new connection pool on every edit.
 */
const globalForPrisma = globalThis as unknown as { __menunivaPrisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 10 });
  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}

export const db: PrismaClient = globalForPrisma.__menunivaPrisma ?? createClient();
if (env.APP_ENV !== 'production') globalForPrisma.__menunivaPrisma = db;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
