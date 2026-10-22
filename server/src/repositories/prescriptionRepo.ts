import { exec, one, pool, rows, type Db } from '../db/pool';

export interface PrescriptionRow {
  id: string;
  rootId: string;
  version: number;
  previousVersionId: string | null;
  patientId: string;
  doctorId: string;
  consultationId: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';
  notes: string | null;
  contentHash: string | null;
  finalizedAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  doctorName: string;
  doctorQualification: string;
  doctorRegistration: string;
  patientName: string;
  patientCode: string;
}

export interface PrescriptionItem {
  position: number;
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}

const SELECT = `SELECT p.id, p.root_id AS "rootId", p.version, p.previous_version_id AS "previousVersionId",
       p.patient_id AS "patientId", p.doctor_id AS "doctorId", p.consultation_id AS "consultationId",
       p.status, p.notes, p.content_hash AS "contentHash", p.finalized_at AS "finalizedAt",
       p.cancel_reason AS "cancelReason", p.created_at AS "createdAt",
       du.full_name AS "doctorName", d.qualification AS "doctorQualification", d.registration_number AS "doctorRegistration",
       pu.full_name AS "patientName", pt.patient_code AS "patientCode"
  FROM prescriptions p
  JOIN doctors d ON d.user_id = p.doctor_id JOIN users du ON du.id = d.user_id
  JOIN patients pt ON pt.user_id = p.patient_id JOIN users pu ON pu.id = pt.user_id`;

export const prescriptionRepo = {
  byId(id: string, db: Db = pool, lock = false) {
    return one<PrescriptionRow>(`${SELECT} WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`, [id], db);
  },

  items(prescriptionId: string, db: Db = pool) {
    return rows<PrescriptionItem>(
      `SELECT position, medicine_name AS "medicineName", dosage, frequency, duration, instructions
         FROM prescription_items WHERE prescription_id = $1 ORDER BY position`,
      [prescriptionId],
      db,
    );
  },

  async insert(
    db: Db,
    p: { id: string; rootId: string; version: number; previousVersionId: string | null; patientId: string; doctorId: string; consultationId: string | null; notes: string | null },
  ) {
    await exec(
      `INSERT INTO prescriptions (id, root_id, version, previous_version_id, patient_id, doctor_id, consultation_id, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6, $6)`,
      [p.id, p.rootId, p.version, p.previousVersionId, p.patientId, p.doctorId, p.consultationId, p.notes],
      db,
    );
  },

  async replaceItems(db: Db, prescriptionId: string, items: Omit<PrescriptionItem, 'position'>[]) {
    await exec(`DELETE FROM prescription_items WHERE prescription_id = $1`, [prescriptionId], db);
    let pos = 1;
    for (const it of items) {
      await exec(
        `INSERT INTO prescription_items (prescription_id, position, medicine_name, dosage, frequency, duration, instructions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [prescriptionId, pos, it.medicineName, it.dosage, it.frequency, it.duration, it.instructions],
        db,
      );
      pos += 1;
    }
  },

  updateDraftNotes(db: Db, id: string, notes: string | null, actorId: string) {
    return exec(`UPDATE prescriptions SET notes = $2, updated_by = $3 WHERE id = $1 AND status = 'DRAFT'`, [id, notes, actorId], db);
  },

  finalize(db: Db, id: string, contentHash: string, finalizedAt: Date, actorId: string) {
    return exec(
      `UPDATE prescriptions SET status = 'ACTIVE', content_hash = $2, finalized_at = $3, updated_by = $4
        WHERE id = $1 AND status = 'DRAFT'`,
      [id, contentHash, finalizedAt, actorId],
      db,
    );
  },

  setStatus(db: Db, id: string, from: string[], to: 'SUPERSEDED' | 'CANCELLED', actorId: string, reason: string | null = null) {
    return exec(
      `UPDATE prescriptions SET status = $3, updated_by = $4, cancel_reason = COALESCE($5, cancel_reason)
        WHERE id = $1 AND status = ANY($2::text[])`,
      [id, from, to, actorId, reason],
      db,
    );
  },

  listForPatient(patientId: string, includeDrafts: boolean, limit: number) {
    return rows<{ id: string; version: number; status: string; doctorName: string; finalizedAt: Date | null; createdAt: Date; itemCount: number }>(
      `SELECT p.id, p.version, p.status, u.full_name AS "doctorName", p.finalized_at AS "finalizedAt", p.created_at AS "createdAt",
              (SELECT count(*)::int FROM prescription_items i WHERE i.prescription_id = p.id) AS "itemCount"
         FROM prescriptions p JOIN users u ON u.id = p.doctor_id
        WHERE p.patient_id = $1 AND ($2 OR p.status <> 'DRAFT')
        ORDER BY COALESCE(p.finalized_at, p.created_at) DESC LIMIT $3`,
      [patientId, includeDrafts, limit],
    );
  },

  listForDoctor(doctorId: string, limit: number, offset: number) {
    return rows<{ id: string; version: number; status: string; patientName: string; patientCode: string; createdAt: Date; finalizedAt: Date | null }>(
      `SELECT p.id, p.version, p.status, u.full_name AS "patientName", pt.patient_code AS "patientCode",
              p.created_at AS "createdAt", p.finalized_at AS "finalizedAt"
         FROM prescriptions p JOIN patients pt ON pt.user_id = p.patient_id JOIN users u ON u.id = p.patient_id
        WHERE p.doctor_id = $1 ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
      [doctorId, limit, offset],
    );
  },
};
