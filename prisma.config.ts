import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations need a session connection: Supabase's transaction pooler (port 6543, what the app
  // uses on Vercel) does not support them. MIGRATE_DATABASE_URL points at the session pooler or
  // the direct connection (port 5432); without it, DATABASE_URL is used (local development).
  datasource: { url: process.env.MIGRATE_DATABASE_URL || env('DATABASE_URL') },
});
