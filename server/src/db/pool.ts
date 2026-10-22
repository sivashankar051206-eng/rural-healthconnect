import { Pool, type PoolClient, type QueryResult } from 'pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

/** Anything that can run a parameterized query: the pool or a transaction client. */
export interface Db {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

/** All queries are parameterized. Never interpolate user input into `text`. */
export async function rows<T>(text: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows as T[];
}

export async function one<T>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const r = await rows<T>(text, params, db);
  return r[0] ?? null;
}

export async function exec(text: string, params: unknown[] = [], db: Db = pool): Promise<number> {
  const result = await db.query(text, params);
  return result.rowCount ?? 0;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** PostgreSQL error codes we translate into API errors. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  EXCLUSION_VIOLATION: '23P01',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : undefined;
}
