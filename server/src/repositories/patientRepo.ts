import { exec, one, pool, rows, type Db } from '../db/pool';

export interface PatientProfile {
  userId: string;
  patientCode: string;
  fullName: string;
  mobile: string | null;
  dateOfBirth: string;
  gender: string | null;
  village: string | null;
  preferredLanguage: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export const patientRepo = {
  create(
    db: Db,
    p: {
      userId: string;
      patientCode: string;
      dateOfBirth: string;
      gender: string | null;
      village: string | null;
      emergencyContactName: string | null;
      emergencyContactPhone: string | null;
    },
  ) {
    return exec(
      `INSERT INTO patients (user_id, patient_code, date_of_birth, gender, village, emergency_contact_name, emergency_contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [p.userId, p.patientCode, p.dateOfBirth, p.gender, p.village, p.emergencyContactName, p.emergencyContactPhone],
      db,
    );
  },

  profile(userId: string, db: Db = pool) {
    return one<PatientProfile>(
      `SELECT p.user_id AS "userId", p.patient_code AS "patientCode", u.full_name AS "fullName", u.mobile,
              to_char(p.date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth", p.gender, p.village,
              u.preferred_language AS "preferredLanguage",
              p.emergency_contact_name AS "emergencyContactName", p.emergency_contact_phone AS "emergencyContactPhone"
         FROM patients p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`,
      [userId],
      db,
    );
  },

  update(
    userId: string,
    f: { village?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null },
  ) {
    return exec(
      `UPDATE patients SET
         village = CASE WHEN $2 THEN $3 ELSE village END,
         emergency_contact_name = CASE WHEN $4 THEN $5 ELSE emergency_contact_name END,
         emergency_contact_phone = CASE WHEN $6 THEN $7 ELSE emergency_contact_phone END
       WHERE user_id = $1`,
      [
        userId,
        f.village !== undefined,
        f.village ?? null,
        f.emergencyContactName !== undefined,
        f.emergencyContactName ?? null,
        f.emergencyContactPhone !== undefined,
        f.emergencyContactPhone ?? null,
      ],
    );
  },

  /** Minimal identity for the prescription watermark (spec §15: no unnecessary PII). */
  watermarkIdentity(userId: string, db: Db = pool) {
    return one<{ fullName: string; patientCode: string }>(
      `SELECT u.full_name AS "fullName", p.patient_code AS "patientCode"
         FROM patients p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`,
      [userId],
      db,
    );
  },

  consultationHistory(patientId: string, limit: number) {
    return rows<{ id: string; appointmentId: string; doctorName: string; specialization: string; startedAt: Date; endedAt: Date | null; status: string }>(
      `SELECT c.id, c.appointment_id AS "appointmentId", u.full_name AS "doctorName", d.specialization,
              c.started_at AS "startedAt", c.ended_at AS "endedAt", c.status
         FROM consultations c JOIN doctors d ON d.user_id = c.doctor_id JOIN users u ON u.id = d.user_id
        WHERE c.patient_id = $1 ORDER BY c.started_at DESC LIMIT $2`,
      [patientId, limit],
    );
  },
};
