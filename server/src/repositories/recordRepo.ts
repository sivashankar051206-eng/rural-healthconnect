import { exec, one, rows, type Db } from '../db/pool';

export interface RecordRow {
  id: string;
  patientId: string;
  entryType: 'ALLERGY' | 'DIAGNOSIS' | 'MEDICATION' | 'NOTE';
  title: string;
  details: string | null;
  consultationId: string | null;
  visibleToPatient: boolean;
  status: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT = `SELECT r.id, r.patient_id AS "patientId", r.entry_type AS "entryType", r.title, r.details,
       r.consultation_id AS "consultationId", r.visible_to_patient AS "visibleToPatient", r.status,
       r.created_by AS "createdBy", u.full_name AS "createdByName", r.created_at AS "createdAt", r.updated_at AS "updatedAt"
  FROM medical_records r JOIN users u ON u.id = r.created_by`;

export interface ReportRow {
  id: string;
  patientId: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
  uploadedByName: string;
  createdAt: Date;
}

export const recordRepo = {
  forPatientView(patientId: string) {
    return rows<RecordRow>(
      `${SELECT} WHERE r.patient_id = $1 AND r.visible_to_patient AND r.status = 'ACTIVE' ORDER BY r.created_at DESC LIMIT 200`,
      [patientId],
    );
  },

  forClinician(patientId: string, includeHistory: boolean) {
    return rows<RecordRow>(
      `${SELECT} WHERE r.patient_id = $1 AND ($2 OR r.status = 'ACTIVE') ORDER BY r.created_at DESC LIMIT 500`,
      [patientId, includeHistory],
    );
  },

  byId(id: string, db?: Db) {
    return one<RecordRow>(`${SELECT} WHERE r.id = $1`, [id], db);
  },

  async insert(
    db: Db,
    r: { patientId: string; entryType: string; title: string; details: string | null; consultationId: string | null; visibleToPatient: boolean; actorId: string },
  ) {
    const res = await one<{ id: string }>(
      `INSERT INTO medical_records (patient_id, entry_type, title, details, consultation_id, visible_to_patient, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
      [r.patientId, r.entryType, r.title, r.details, r.consultationId, r.visibleToPatient, r.actorId],
      db,
    );
    return res!.id;
  },

  markStatus(db: Db, id: string, status: 'CORRECTED' | 'ENTERED_IN_ERROR', actorId: string) {
    return exec(`UPDATE medical_records SET status = $2, updated_by = $3 WHERE id = $1 AND status = 'ACTIVE'`, [id, status, actorId], db);
  },

  insertCorrection(
    db: Db,
    c: { recordId: string; newRecordId: string | null; reason: string; previous: unknown; next: unknown; actorId: string },
  ) {
    return exec(
      `INSERT INTO record_corrections (record_id, new_record_id, reason, previous_value, new_value, corrected_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [c.recordId, c.newRecordId, c.reason, JSON.stringify(c.previous), c.next === null ? null : JSON.stringify(c.next), c.actorId],
      db,
    );
  },

  corrections(patientId: string) {
    return rows<{ recordId: string; newRecordId: string | null; reason: string; correctedByName: string; createdAt: Date }>(
      `SELECT rc.record_id AS "recordId", rc.new_record_id AS "newRecordId", rc.reason, u.full_name AS "correctedByName", rc.created_at AS "createdAt"
         FROM record_corrections rc JOIN medical_records r ON r.id = rc.record_id JOIN users u ON u.id = rc.corrected_by
        WHERE r.patient_id = $1 ORDER BY rc.created_at DESC LIMIT 200`,
      [patientId],
    );
  },

  reports(patientId: string) {
    return rows<ReportRow>(
      `SELECT m.id, m.patient_id AS "patientId", m.title, m.mime_type AS "mimeType", m.size_bytes AS "sizeBytes",
              m.scan_status AS "scanStatus", u.full_name AS "uploadedByName", m.created_at AS "createdAt"
         FROM medical_reports m JOIN users u ON u.id = m.created_by
        WHERE m.patient_id = $1 ORDER BY m.created_at DESC LIMIT 100`,
      [patientId],
    );
  },

  /** Internal only: includes the storage key, which is never returned to clients. */
  reportFile(id: string) {
    return one<{ id: string; patientId: string; storageKey: string; mimeType: string; sizeBytes: number }>(
      `SELECT id, patient_id AS "patientId", storage_key AS "storageKey", mime_type AS "mimeType", size_bytes AS "sizeBytes"
         FROM medical_reports WHERE id = $1`,
      [id],
    );
  },

  async insertReport(
    db: Db,
    r: { patientId: string; title: string; storageKey: string; mimeType: string; sizeBytes: number; sha256: string; scanStatus: string; actorId: string },
  ) {
    const res = await one<{ id: string }>(
      `INSERT INTO medical_reports (patient_id, title, storage_key, mime_type, size_bytes, sha256, scan_status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [r.patientId, r.title, r.storageKey, r.mimeType, r.sizeBytes, r.sha256, r.scanStatus, r.actorId],
      db,
    );
    return res!.id;
  },
};
