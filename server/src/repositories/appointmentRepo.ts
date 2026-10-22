import { exec, one, pool, rows, type Db } from '../db/pool';
import { SLOT_HOLDING_STATUSES } from '../config/constants';

export interface AppointmentRow {
  id: string;
  patientId: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  mode: string;
  status: string;
  reason: string | null;
  doctorName: string;
  specialization: string;
  patientName: string;
  patientCode: string;
  consultationId: string | null;
}

const SELECT = `SELECT a.id, a.patient_id AS "patientId", a.doctor_id AS "doctorId", a.starts_at AS "startsAt",
         a.ends_at AS "endsAt", a.mode, a.status, a.reason,
         du.full_name AS "doctorName", d.specialization,
         pu.full_name AS "patientName", p.patient_code AS "patientCode",
         c.id AS "consultationId"
    FROM appointments a
    JOIN doctors d ON d.user_id = a.doctor_id JOIN users du ON du.id = d.user_id
    JOIN patients p ON p.user_id = a.patient_id JOIN users pu ON pu.id = p.user_id
    LEFT JOIN consultations c ON c.appointment_id = a.id`;

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Generates free slots for a doctor on a local calendar date entirely in SQL:
 * availability windows are expanded with generate_series in the platform time
 * zone, and any slot overlapping a slot-holding appointment is removed.
 */
const SLOTS_SQL = `
  SELECT s AS "startsAt", s + make_interval(mins => a.slot_minutes) AS "endsAt"
    FROM doctor_availability a,
         LATERAL generate_series(
           ($2::date + a.start_time) AT TIME ZONE $3,
           (($2::date + a.end_time) AT TIME ZONE $3) - make_interval(mins => a.slot_minutes),
           make_interval(mins => a.slot_minutes)
         ) AS s
   WHERE a.doctor_id = $1
     AND a.day_of_week = EXTRACT(DOW FROM $2::date)
     AND s > now()
     AND NOT EXISTS (
       SELECT 1 FROM appointments ap
        WHERE ap.doctor_id = $1 AND ap.status = ANY($4::text[])
          AND tstzrange(ap.starts_at, ap.ends_at, '[)') && tstzrange(s, s + make_interval(mins => a.slot_minutes), '[)')
     )
   ORDER BY s
   LIMIT 200`;

export const appointmentRepo = {
  freeSlots(doctorId: string, date: string, timezone: string, db: Db = pool) {
    return rows<Slot>(SLOTS_SQL, [doctorId, date, timezone, SLOT_HOLDING_STATUSES], db);
  },

  async insert(
    db: Db,
    a: { patientId: string; doctorId: string; startsAt: Date; endsAt: Date; mode: string; reason: string | null },
  ): Promise<string> {
    const r = await one<{ id: string }>(
      `INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at, mode, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [a.patientId, a.doctorId, a.startsAt, a.endsAt, a.mode, a.reason],
      db,
    );
    return r!.id;
  },

  byId(id: string, db: Db = pool) {
    return one<AppointmentRow>(`${SELECT} WHERE a.id = $1`, [id], db);
  },

  forPatient(patientId: string, scope: 'upcoming' | 'past', limit: number, offset: number) {
    const cond =
      scope === 'upcoming'
        ? `a.ends_at >= now() AND a.status IN ('SCHEDULED','CONFIRMED','IN_PROGRESS') ORDER BY a.starts_at ASC`
        : `(a.ends_at < now() OR a.status IN ('COMPLETED','CANCELLED','REJECTED')) ORDER BY a.starts_at DESC`;
    return rows<AppointmentRow>(`${SELECT} WHERE a.patient_id = $1 AND ${cond} LIMIT $2 OFFSET $3`, [patientId, limit, offset]);
  },

  forDoctor(doctorId: string, status: string | undefined, date: string | undefined, tz: string, limit: number, offset: number) {
    return rows<AppointmentRow>(
      `${SELECT} WHERE a.doctor_id = $1
         AND ($2::text IS NULL OR a.status = $2)
         AND ($3::date IS NULL OR (a.starts_at AT TIME ZONE $4)::date = $3::date)
       ORDER BY a.starts_at ASC LIMIT $5 OFFSET $6`,
      [doctorId, status ?? null, date ?? null, tz, limit, offset],
    );
  },

  /** Conditional state transition: only succeeds if the row is in one of the `from` states. */
  async transition(
    db: Db,
    id: string,
    owner: { doctorId?: string; patientId?: string },
    from: string[],
    to: string,
    extra: { cancelledBy?: string; cancelReason?: string | null } = {},
  ): Promise<boolean> {
    const n = await exec(
      `UPDATE appointments SET status = $2,
              cancelled_by = COALESCE($5, cancelled_by), cancel_reason = COALESCE($6, cancel_reason)
        WHERE id = $1 AND status = ANY($3::text[])
          AND ($4::uuid IS NULL OR doctor_id = $4::uuid)
          AND ($7::uuid IS NULL OR patient_id = $7::uuid)`,
      [id, to, from, owner.doctorId ?? null, extra.cancelledBy ?? null, extra.cancelReason ?? null, owner.patientId ?? null],
      db,
    );
    return n === 1;
  },

  dueReminders(withinMinutes: number) {
    return rows<{ id: string; patientId: string; startsAt: Date }>(
      `UPDATE appointments SET reminder_sent_at = now()
        WHERE status = 'CONFIRMED' AND reminder_sent_at IS NULL
          AND starts_at BETWEEN now() AND now() + make_interval(mins => $1::int)
        RETURNING id, patient_id AS "patientId", starts_at AS "startsAt"`,
      [withinMinutes],
    );
  },
};
