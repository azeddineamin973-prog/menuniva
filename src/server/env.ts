import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment configuration, validated once at startup.
 * Importing this file from client code fails the build (`server-only`).
 */
const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'demo', 'staging', 'production']).default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  TRANSLATION_PROVIDER: z.enum(['none', 'deepl', 'libretranslate']).default('none'),
  DEEPL_API_KEY: z.string().optional(),
  LIBRETRANSLATE_URL: z.string().optional(),
  LIBRETRANSLATE_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  GLOVO_PARTNER_API_KEY: z.string().optional(),
  UBER_EATS_CLIENT_ID: z.string().optional(),
  UBER_EATS_CLIENT_SECRET: z.string().optional(),
  BILLING_PROVIDER: z.enum(['manual', 'stripe']).default('manual'),
  ERROR_MONITORING_DSN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`MenuNiva configuration error. Check your .env file:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
export const isProduction = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
