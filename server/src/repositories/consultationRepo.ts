import { exec, one, rows, type Db } from '../db/pool';

export interface ConsultationRow {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  roomToken: string;
  startedAt: Date;
  endedAt: Date | null;
  mode: string;
  doctorName: string;
  patientName: string;
  patientCode: string;
}

const SELECT = `SELECT c.id, c.appointment_id AS "appointmentId", c.patient_id AS "patientId", c.doctor_id AS "doctorId",
       c.status, c.room_token AS "roomToken", c.started_at AS "startedAt", c.ended_at AS "endedAt", a.mode,
       du.full_name AS "doctorName", pu.full_name AS "patientName", p.patient_code AS "patientCode"
  FROM consultations c
  JOIN appointments a ON a.id = c.appointment_id
  JOIN users du ON du.id = c.doctor_id
  JOIN users pu ON pu.id = c.patient_id
  JOIN patients p ON p.user_id = c.patient_id`;

export const consultationRepo = {
  async create(db: Db, c: { appointmentId: string; patientId: string; doctorId: string; roomToken: string }) {
    const r = await one<{ id: string }>(
      `INSERT INTO consultations (appointment_id, patient_id, doctor_id, room_token) VALUES ($1, $2, $3, $4) RETURNING id`,
      [c.appointmentId, c.patientId, c.doctorId, c.roomToken],
      db,
    );
    return r!.id;
  },

  byId(id: string, db?: Db) {
    return one<ConsultationRow>(`${SELECT} WHERE c.id = $1`, [id], db);
  },

  byAppointment(appointmentId: string) {
    return one<ConsultationRow>(`${SELECT} WHERE c.appointment_id = $1`, [appointmentId]);
  },

  complete(db: Db, id: string, doctorId: string) {
    return exec(
      `UPDATE consultations SET status = 'COMPLETED', ended_at = now() WHERE id = $1 AND doctor_id = $2 AND status = 'IN_PROGRESS'`,
      [id, doctorId],
      db,
    );
  },

  addMessage(consultationId: string, senderId: string, body: string) {
    return one<{ id: string; createdAt: Date }>(
      `INSERT INTO messages (consultation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, created_at AS "createdAt"`,
      [consultationId, senderId, body],
    );
  },

  messages(consultationId: string, after: string | undefined) {
    return rows<{ id: string; senderId: string; body: string; createdAt: Date }>(
      `SELECT id, sender_id AS "senderId", body, created_at AS "createdAt"
         FROM messages WHERE consultation_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)
        ORDER BY created_at ASC LIMIT 200`,
      [consultationId, after ?? null],
    );
  },

  historyForDoctorPatient(patientId: string, limit: number) {
    return rows<{ id: string; doctorName: string; startedAt: Date; endedAt: Date | null; status: string }>(
      `SELECT c.id, u.full_name AS "doctorName", c.started_at AS "startedAt", c.ended_at AS "endedAt", c.status
         FROM consultations c JOIN users u ON u.id = c.doctor_id
        WHERE c.patient_id = $1 ORDER BY c.started_at DESC LIMIT $2`,
      [patientId, limit],
    );
  },
};
