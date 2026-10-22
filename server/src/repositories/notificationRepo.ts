import { exec, one, pool, rows, type Db } from '../db/pool';

export interface NotificationRow {
  id: string;
  type: string;
  params: Record<string, string | number>;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export const notificationRepo = {
  insert(db: Db, userId: string, type: string, params: Record<string, string | number>, link: string | null) {
    return exec(`INSERT INTO notifications (user_id, type, params, link) VALUES ($1, $2, $3, $4)`, [
      userId,
      type,
      JSON.stringify(params),
      link,
    ], db);
  },

  list(userId: string, limit: number, offset: number) {
    return rows<NotificationRow>(
      `SELECT id, type, params, link, read_at AS "readAt", created_at AS "createdAt"
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
  },

  unreadCount(userId: string) {
    return one<{ count: number }>(
      `SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    ).then((r) => r?.count ?? 0);
  },

  markRead(userId: string, id: string) {
    return exec(`UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`, [id, userId]);
  },

  markAllRead(userId: string) {
    return exec(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  },

  mobileFor(userId: string, db: Db = pool) {
    return one<{ mobile: string | null }>(`SELECT mobile FROM users WHERE id = $1`, [userId], db);
  },
};
