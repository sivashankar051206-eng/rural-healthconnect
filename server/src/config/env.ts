import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 random bytes, base64 encoded'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required (comma-separated list of allowed origins)'),
  COOKIE_SECURE: bool.default('true'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  UPLOAD_DIR: z.string().default('/var/lib/rhc/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  VIDEO_BASE_URL: z
    .string()
    .optional()
    .refine((v) => !v || /^https:\/\/[^\s]+[^/]$/.test(v), 'VIDEO_BASE_URL must be an https URL without a trailing slash'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  SMS_API_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  EMAIL_API_URL: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),
  DEV_PRINT_OTP: bool.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Never print values: they may be secrets.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.DEV_PRINT_OTP) throw new Error('DEV_PRINT_OTP must never be enabled in production');
  if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
}

export const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';
