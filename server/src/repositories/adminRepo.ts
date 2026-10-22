import { exec, one, pool, rows, type Db } from '../db/pool';
import { likeEscape } from '../utils/http';

export const adminRepo = {
  stats(tz: string) {
    return one<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM patients) AS "patients",
         (SELECT count(*)::int FROM doctors WHERE verification_status = 'VERIFIED' AND is_active) AS "activeDoctors",
         (SELECT count(*)::int FROM doctors WHERE verification_status = 'PENDING') AS "pendingDoctors",
         (SELECT count(*)::int FROM appointments WHERE (starts_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS "appointmentsToday",
         (SELECT count(*)::int FROM appointments WHERE status = 'COMPLETED' AND starts_at > now() - interval '30 days') AS "completed30d",
         (SELECT count(*)::int FROM appointments WHERE status = 'CANCELLED' AND starts_at > now() - interval '30 days') AS "cancelled30d",
         (SELECT count(*)::int FROM issues WHERE status <> 'RESOLVED') AS "openIssues",
         (SELECT count(*)::int FROM audit_logs WHERE action = 'LOGIN_FAILED' AND created_at > now() - interval '24 hours') AS "failedLogins24h",
         (SELECT count(*)::int FROM audit_logs WHERE result = 'DENIED' AND created_at > now() - interval '24 hours') AS "deniedRequests24h",
         (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - interval '15 minutes') AS "activeSessions"`,
      [tz],
    );
  },

  appointmentsByDay(tz: string) {
    return rows<{ day: string; total: number }>(
      `SELECT to_char((starts_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, count(*)::int AS total
         FROM appointments WHERE starts_at > now() - interval '14 days' AND starts_at <= now() + interval '1 day'
        GROUP BY 1 ORDER BY 1`,
      [tz],
    );
  },

  doctors(status: string | undefined, q: string | undefined, limit: number, offset: number) {
    return rows(
      `SELECT d.user_id AS id, u.full_name AS "fullName", u.email::text AS email, d.registration_number AS "registrationNumber",
              d.specialization, d.qualification, f.name AS "facilityName", d.verification_status AS "verificationStatus",
              d.is_active AS "isActive", u.status AS "accountStatus", d.created_at AS "createdAt"
         FROM doctors d JOIN users u ON u.id = d.user_id LEFT JOIN facilities f ON f.id = d.facility_id
        WHERE ($1::text IS NULL OR d.verification_status = $1)
          AND ($2::text IS NULL OR u.full_name ILIKE '%' || $2 || '%' OR d.registration_number ILIKE '%' || $2 || '%')
        ORDER BY d.created_at DESC LIMIT $3 OFFSET $4`,
      [status ?? null, q ? likeEscape(q) : null, limit, offset],
    );
  },

  doctorState(id: string, db: Db = pool) {
    return one<{ verificationStatus: string; isActive: boolean }>(
      `SELECT verification_status AS "verificationStatus", is_active AS "isActive" FROM doctors WHERE user_id = $1 FOR UPDATE`,
      [id],
      db,
    );
  },

  setDoctorState(db: Db, id: string, verificationStatus: string, isActive: boolean) {
    return exec(`UPDATE doctors SET verification_status = $2, is_active = $3 WHERE user_id = $1`, [id, verificationStatus, isActive], db);
  },

  insertVerification(db: Db, doctorId: string, action: string, notes: string | null, adminId: string) {
    return exec(
      `INSERT INTO doctor_verifications (doctor_id, action, notes, performed_by) VALUES ($1, $2, $3, $4)`,
      [doctorId, action, notes, adminId],
      db,
    );
  },

  /** Non-clinical account data only. */
  patients(q: string | undefined, limit: number, offset: number) {
    return rows<{ id: string; patientCode: string; fullName: string; mobile: string | null; village: string | null; status: string; createdAt: Date }>(
      `SELECT p.user_id AS id, p.patient_code AS "patientCode", u.full_name AS "fullName", u.mobile, p.village,
              u.status, p.created_at AS "createdAt"
         FROM patients p JOIN users u ON u.id = p.user_id
        WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR p.patient_code ILIKE $1 || '%')
        ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
      [q ? likeEscape(q) : null, limit, offset],
    );
  },

  /** Appointment metadata only: no reason / clinical content. */
  appointments(status: string | undefined, from: string | undefined, to: string | undefined, tz: string, limit: number, offset: number) {
    return rows(
      `SELECT a.id, a.starts_at AS "startsAt", a.status, a.mode, du.full_name AS "doctorName", p.patient_code AS "patientCode",
              a.created_at AS "createdAt"
         FROM appointments a JOIN users du ON du.id = a.doctor_id JOIN patients p ON p.user_id = a.patient_id
        WHERE ($1::text IS NULL OR a.status = $1)
          AND ($2::date IS NULL OR (a.starts_at AT TIME ZONE $4)::date >= $2::date)
          AND ($3::date IS NULL OR (a.starts_at AT TIME ZONE $4)::date <= $3::date)
        ORDER BY a.starts_at DESC LIMIT $5 OFFSET $6`,
      [status ?? null, from ?? null, to ?? null, tz, limit, offset],
    );
  },

  auditLogs(f: { action?: string; result?: string; actorId?: string; from?: string; to?: string }, limit: number, offset: number) {
    return rows(
      `SELECT l.id::text, l.created_at AS "createdAt", l.actor_id AS "actorId", u.full_name AS "actorName", l.actor_role AS "actorRole",
              l.action, l.resource_type AS "resourceType", l.resource_id AS "resourceId", l.result, l.ip,
              l.request_id AS "requestId", l.metadata
         FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
        WHERE ($1::text IS NULL OR l.action = $1)
          AND ($2::text IS NULL OR l.result = $2)
          AND ($3::uuid IS NULL OR l.actor_id = $3::uuid)
          AND ($4::date IS NULL OR l.created_at >= $4::date)
          AND ($5::date IS NULL OR l.created_at < $5::date + 1)
        ORDER BY l.created_at DESC LIMIT $6 OFFSET $7`,
      [f.action ?? null, f.result ?? null, f.actorId ?? null, f.from ?? null, f.to ?? null, limit, offset],
    );
  },

  facilities(activeOnly: boolean) {
    return rows(
      `SELECT id, name, type, district, state, address, phone, is_active AS "isActive"
         FROM facilities WHERE ($1 = false OR is_active) ORDER BY state, district, name LIMIT 500`,
      [activeOnly],
    );
  },

  async upsertFacility(
    id: string | null,
    f: { name: string; type: string; district: string; state: string; address: string | null; phone?: string | null; isActive: boolean },
    adminId: string,
  ) {
    if (id) {
      const n = await exec(
        `UPDATE facilities SET name = $2, type = $3, district = $4, state = $5, address = $6, phone = $7, is_active = $8, updated_by = $9
          WHERE id = $1`,
        [id, f.name, f.type, f.district, f.state, f.address, f.phone ?? null, f.isActive, adminId],
      );
      return n === 1 ? id : null;
    }
    const r = await one<{ id: string }>(
      `INSERT INTO facilities (name, type, district, state, address, phone, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [f.name, f.type, f.district, f.state, f.address, f.phone ?? null, f.isActive, adminId],
    );
    return r!.id;
  },

  insertIssue(userId: string, category: string, description: string) {
    return one<{ id: string }>(
      `INSERT INTO issues (reported_by, category, description) VALUES ($1, $2, $3) RETURNING id`,
      [userId, category, description],
    );
  },

  issues(status: string | undefined, limit: number, offset: number) {
    return rows(
      `SELECT i.id, i.category, i.description, i.status, i.admin_notes AS "adminNotes", u.role AS "reporterRole",
              u.full_name AS "reporterName", i.created_at AS "createdAt", i.updated_at AS "updatedAt"
         FROM issues i JOIN users u ON u.id = i.reported_by
        WHERE ($1::text IS NULL OR i.status = $1) ORDER BY i.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset],
    );
  },

  updateIssue(id: string, status: string, notes: string | null, adminId: string) {
    return exec(`UPDATE issues SET status = $2, admin_notes = COALESCE($3, admin_notes), updated_by = $4 WHERE id = $1`, [
      id,
      status,
      notes,
      adminId,
    ]);
  },

  settings() {
    return rows<{ key: string; value: unknown; updatedAt: Date }>(
      `SELECT key, value, updated_at AS "updatedAt" FROM system_settings ORDER BY key`,
    );
  },

  admins() {
    return rows<{ id: string; fullName: string; email: string; status: string; mfaEnabled: boolean; permissions: string[] }>(
      `SELECT u.id, u.full_name AS "fullName", u.email::text AS email, u.status, u.mfa_enabled AS "mfaEnabled",
              COALESCE(array_agg(up.permission_code ORDER BY up.permission_code) FILTER (WHERE up.permission_code IS NOT NULL), '{}') AS permissions
         FROM users u LEFT JOIN user_permissions up ON up.user_id = u.id
        WHERE u.role = 'ADMIN' GROUP BY u.id ORDER BY u.full_name`,
    );
  },

  permissionsOf(userId: string) {
    return rows<{ code: string }>(`SELECT permission_code AS code FROM user_permissions WHERE user_id = $1`, [userId]).then((r) =>
      r.map((x) => x.code),
    );
  },

  async setPermissions(db: Db, userId: string, permissions: string[], grantedBy: string) {
    await exec(`DELETE FROM user_permissions WHERE user_id = $1`, [userId], db);
    for (const p of permissions) {
      await exec(`INSERT INTO user_permissions (user_id, permission_code, granted_by) VALUES ($1, $2, $3)`, [userId, p, grantedBy], db);
    }
  },
};
