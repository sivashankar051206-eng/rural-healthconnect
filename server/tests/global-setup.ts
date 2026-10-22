import crypto from 'node:crypto';

/** Runs migrations once against the disposable test database. */
export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
  process.env.SESSION_SECRET ??= crypto.randomBytes(48).toString('base64url');
  process.env.DATA_ENCRYPTION_KEY ??= crypto.randomBytes(32).toString('base64');
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.NODE_ENV = 'test';
  const { migrate } = await import('../src/db/migrate');
  const { pool } = await import('../src/db/pool');
  await migrate();
  await pool.end();
}
