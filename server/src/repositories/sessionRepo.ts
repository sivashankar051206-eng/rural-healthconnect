import { exec, one, pool, rows, type Db } from '../db/pool';
import type { Language, Role } from '../config/constants';

export interface SessionWithUser {
  id: string;
  userId: string;
  csrfHash: string;
  mfaVerified: boolean;
  reauthAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  role: Role;
  fullName: string;
  language: Language;
  userStatus: 'ACTIVE' | 'DISABLED';
}

export const sessionRepo = {
  async insert(
    db: Db,
    s: { userId: string; tokenHash: string; csrfHash: string; expiresAt: Date; ip: string | null; userAgent: string | null; mfaVerified: boolean },
  ): Promise<string> {
    const r = await one<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, csrf_hash, expires_at, ip, user_agent, mfa_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [s.userId, s.tokenHash, s.csrfHash, s.expiresAt, s.ip, s.userAgent, s.mfaVerified],
      db,
    );
    return r!.id;
  },

  findByTokenHash(tokenHash: string) {
    return one<SessionWithUser>(
      `SELECT s.id, s.user_id AS "userId", s.csrf_hash AS "csrfHash", s.mfa_verified AS "mfaVerified",
              s.reauth_at AS "reauthAt", s.created_at AS "createdAt", s.last_seen_at AS "lastSeenAt",
              s.expires_at AS "expiresAt", u.role, u.full_name AS "fullName",
              u.preferred_language AS "language", u.status AS "userStatus"
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
      [tokenHash],
    );
  },

  touch(id: string) {
    return exec(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [id]);
  },

  setReauth(id: string) {
    return exec(`UPDATE sessions SET reauth_at = now() WHERE id = $1`, [id]);
  },

  revoke(id: string, userId: string) {
    return exec(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [id, userId]);
  },

  revokeAllForUser(userId: string, exceptSessionId: string | null = null, db: Db = pool) {
    return exec(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, exceptSessionId],
      db,
    );
  },

  listActive(userId: string) {
    return rows<{ id: string; createdAt: Date; lastSeenAt: Date; ip: string | null; userAgent: string | null }>(
      `SELECT id, created_at AS "createdAt", last_seen_at AS "lastSeenAt", ip, user_agent AS "userAgent"
         FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_seen_at DESC LIMIT 20`,
      [userId],
    );
  },

  purgeExpired() {
    return exec(`DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`);
  },
};
