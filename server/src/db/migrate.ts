import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
const LOCK_ID = 7_420_031;

/** Applies pending SQL migrations in filename order, each in its own transaction. */
export async function migrate(): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const done = new Set(
      (await client.query('SELECT name FROM schema_migrations')).rows.map((r: { name: string }) => r.name),
    );
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        logger.info({ file }, 'Applied migration');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then((applied) => {
      // eslint-disable-next-line no-console
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
      return pool.end();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
