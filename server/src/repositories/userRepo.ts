import { exec, one, pool, rows, type Db } from '../db/pool';
import type { Language, Role } from '../config/constants';

export interface UserAuthRow {
  id: string;
  role: Role;
  email: string | null;
  mobile: string | null;
  passwordHash: string;
  status: 'ACTIVE' | 'DISABLED';
  fullName: string;
  preferredLanguage: Language;
  failedLoginCount: number;
  lockedUntil: Date | null;
  mfaEnabled: boolean;
  mfaSecretEnc: string | null;
}

const AUTH_COLS = `id, role, email::text AS email, mobile, password_hash AS "passwordHash", status,
  full_name AS "fullName", preferred_language AS "preferredLanguage",
  failed_login_count AS "failedLoginCount", locked_until AS "lockedUntil",
  mfa_enabled AS "mfaEnabled", mfa_secret_enc AS "mfaSecretEnc"`;

export const userRepo = {
  findByEmail(email: string, role: Role, db: Db = pool) {
    return one<UserAuthRow>(`SELECT ${AUTH_COLS} FROM users WHERE email = $1 AND role = $2`, [email, role], db);
  },

  findByMobile(mobile: string, role: Role, db: Db = pool) {
    return one<UserAuthRow>(`SELECT ${AUTH_COLS} FROM users WHERE mobile = $1 AND role = $2`, [mobile, role], db);
  },

  findById(id: string, db: Db = pool) {
    return one<UserAuthRow>(`SELECT ${AUTH_COLS} FROM users WHERE id = $1`, [id], db);
  },

  existsByIdentifiers(email: string | null, mobile: string | null, db: Db = pool) {
    return one<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM users WHERE ($1::citext IS NOT NULL AND email = $1::citext)
                                            OR ($2::text IS NOT NULL AND mobile = $2)) AS exists`,
      [email, mobile],
      db,
    ).then((r) => Boolean(r?.exists));
  },

  async create(
    db: Db,
    u: { role: Role; email: string | null; mobile: string | null; passwordHash: string; fullName: string; language: Language },
  ): Promise<string> {
    const r = await one<{ id: string }>(
      `INSERT INTO users (role, email, mobile, password_hash, full_name, preferred_language)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [u.role, u.email, u.mobile, u.passwordHash, u.fullName, u.language],
      db,
    );
    return r!.id;
  },

  recordFailedLogin(id: string, maxAttempts: number, lockMinutes: number) {
    return exec(
      `UPDATE users SET
         failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
         locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3::int) ELSE locked_until END
       WHERE id = $1`,
      [id, maxAttempts, lockMinutes],
    );
  },

  resetFailedLogins(id: string) {
    return exec(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL
       WHERE id = $1 AND (failed_login_count <> 0 OR locked_until IS NOT NULL)`,
      [id],
    );
  },

  updatePassword(id: string, passwordHash: string, db: Db = pool) {
    return exec(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL
       WHERE id = $1`,
      [id, passwordHash],
      db,
    );
  },

  setLanguage(id: string, language: Language) {
    return exec(`UPDATE users SET preferred_language = $2 WHERE id = $1`, [id, language]);
  },

  setStatus(id: string, role: Role, status: 'ACTIVE' | 'DISABLED', db: Db = pool) {
    return exec(`UPDATE users SET status = $3 WHERE id = $1 AND role = $2`, [id, role, status], db);
  },

  adminIds(db: Db = pool) {
    return rows<{ id: string }>(`SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`, [], db);
  },
};
