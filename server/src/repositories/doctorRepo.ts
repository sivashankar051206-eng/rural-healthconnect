import { exec, one, pool, rows, type Db } from '../db/pool';
import { DOCTOR_ACCESS_STATUSES } from '../config/constants';
import { likeEscape } from '../utils/http';

export interface DirectoryDoctor {
  id: string;
  fullName: string;
  specialization: string;
  qualification: string;
  facilityName: string | null;
  district: string | null;
  bio: string | null;
}

export const doctorRepo = {
  create(
    db: Db,
    d: { userId: string; registrationNumber: string; specialization: string; qualification: string; facilityId: string | null },
  ) {
    return exec(
      `INSERT INTO doctors (user_id, registration_number, specialization, qualification, facility_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [d.userId, d.registrationNumber, d.specialization, d.qualification, d.facilityId],
      db,
    );
  },

  registrationExists(registrationNumber: string, db: Db = pool) {
    return one<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM doctors WHERE registration_number = $1) AS exists`,
      [registrationNumber],
      db,
    ).then((r) => Boolean(r?.exists));
  },

  status(userId: string) {
    return one<{
      fullName: string;
      email: string | null;
      specialization: string;
      qualification: string;
      registrationNumber: string;
      verificationStatus: string;
      isActive: boolean;
      facilityName: string | null;
    }>(
      `SELECT u.full_name AS "fullName", u.email::text AS email, d.specialization, d.qualification,
              d.registration_number AS "registrationNumber", d.verification_status AS "verificationStatus",
              d.is_active AS "isActive", f.name AS "facilityName"
         FROM doctors d JOIN users u ON u.id = d.user_id LEFT JOIN facilities f ON f.id = d.facility_id
        WHERE d.user_id = $1`,
      [userId],
    );
  },

  /** Public directory: only verified, active doctors, only non-sensitive professional fields. */
  directory(q: string | undefined, specialization: string | undefined, limit: number, offset: number) {
    return rows<DirectoryDoctor>(
      `SELECT d.user_id AS id, u.full_name AS "fullName", d.specialization, d.qualification,
              f.name AS "facilityName", f.district, d.bio
         FROM doctors d JOIN users u ON u.id = d.user_id LEFT JOIN facilities f ON f.id = d.facility_id
        WHERE d.verification_status = 'VERIFIED' AND d.is_active AND u.status = 'ACTIVE'
          AND ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR d.specialization ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR d.specialization ILIKE $2)
        ORDER BY u.full_name LIMIT $3 OFFSET $4`,
      [q ? likeEscape(q) : null, specialization ? likeEscape(specialization) : null, limit, offset],
    );
  },

  isBookable(doctorId: string, db: Db = pool) {
    return one<{ name: string }>(
      `SELECT u.full_name AS name FROM doctors d JOIN users u ON u.id = d.user_id
        WHERE d.user_id = $1 AND d.verification_status = 'VERIFIED' AND d.is_active AND u.status = 'ACTIVE'`,
      [doctorId],
      db,
    );
  },

  lockForBooking(doctorId: string, db: Db) {
    return one<{ user_id: string }>(`SELECT user_id FROM doctors WHERE user_id = $1 FOR UPDATE`, [doctorId], db);
  },

  availability(doctorId: string) {
    return rows<{ dayOfWeek: number; startTime: string; endTime: string; slotMinutes: number }>(
      `SELECT day_of_week AS "dayOfWeek", to_char(start_time, 'HH24:MI') AS "startTime",
              to_char(end_time, 'HH24:MI') AS "endTime", slot_minutes AS "slotMinutes"
         FROM doctor_availability WHERE doctor_id = $1 ORDER BY day_of_week, start_time`,
      [doctorId],
    );
  },

  async replaceAvailability(
    db: Db,
    doctorId: string,
    slots: { dayOfWeek: number; startTime: string; endTime: string; slotMinutes: number }[],
  ) {
    await exec(`DELETE FROM doctor_availability WHERE doctor_id = $1`, [doctorId], db);
    for (const s of slots) {
      await exec(
        `INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, slot_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [doctorId, s.dayOfWeek, s.startTime, s.endTime, s.slotMinutes],
        db,
      );
    }
  },

  /** Doctors can only ever search within patients they are authorized for. */
  authorizedPatients(doctorId: string, q: string | undefined, limit: number, offset: number) {
    return rows<{ id: string; patientCode: string; fullName: string; lastVisit: Date }>(
      `SELECT p.user_id AS id, p.patient_code AS "patientCode", u.full_name AS "fullName", max(a.starts_at) AS "lastVisit"
         FROM appointments a
         JOIN patients p ON p.user_id = a.patient_id
         JOIN users u ON u.id = p.user_id
        WHERE a.doctor_id = $1 AND a.status = ANY($2::text[])
          AND ($3::text IS NULL OR u.full_name ILIKE '%' || $3 || '%' OR p.patient_code ILIKE $3 || '%')
        GROUP BY p.user_id, p.patient_code, u.full_name
        ORDER BY "lastVisit" DESC LIMIT $4 OFFSET $5`,
      [doctorId, DOCTOR_ACCESS_STATUSES, q ? likeEscape(q) : null, limit, offset],
    );
  },

  dashboardCounts(doctorId: string, timezone: string) {
    return one<{ today: number; pending: number; inProgress: number; patients: number }>(
      `SELECT
         count(*) FILTER (WHERE status IN ('CONFIRMED','IN_PROGRESS') AND (starts_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date)::int AS today,
         count(*) FILTER (WHERE status = 'SCHEDULED' AND starts_at > now())::int AS pending,
         count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS "inProgress",
         count(DISTINCT patient_id) FILTER (WHERE status = ANY($2::text[]))::int AS patients
       FROM appointments WHERE doctor_id = $1`,
      [doctorId, DOCTOR_ACCESS_STATUSES, timezone],
    );
  },
};
