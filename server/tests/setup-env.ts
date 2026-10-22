/**
 * Test environment. Requires a DEDICATED, disposable PostgreSQL database and Redis DB:
 *   TEST_DATABASE_URL=postgres://.../rhc_test  TEST_REDIS_URL=redis://localhost:6379/15  npm test
 * Tables in that database are truncated between tests. Secrets below are random per run.
 */
import crypto from 'node:crypto';
import os from 'node:os';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL) {
  throw new Error('Set TEST_DATABASE_URL and TEST_REDIS_URL to a disposable database before running tests.');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REDIS_URL = process.env.TEST_REDIS_URL;
process.env.SESSION_SECRET ??= crypto.randomBytes(48).toString('base64url');
process.env.DATA_ENCRYPTION_KEY ??= crypto.randomBytes(32).toString('base64');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.COOKIE_SECURE = 'false';
process.env.UPLOAD_DIR = process.env.TEST_UPLOAD_DIR ?? `${os.tmpdir()}/rhc-test-uploads`;
process.env.APP_TIMEZONE = 'Asia/Kolkata';
