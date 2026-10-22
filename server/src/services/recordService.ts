import type { Request } from 'express';
import { withTransaction } from '../db/pool';
import { audit, auditStrict } from '../audit/audit';
import { recordRepo, type RecordRow } from '../repositories/recordRepo';
import { patientRepo } from '../repositories/patientRepo';
import { consultationRepo } from '../repositories/consultationRepo';
import { prescriptionRepo } from '../repositories/prescriptionRepo';
import { assertDoctorPatientAccess, denyNotFound } from '../security/access';
import { badRequest, conflict, notFound } from '../utils/httpError';

function group(records: RecordRow[], clinician: boolean) {
  const shape = (r: RecordRow) => ({
    id: r.id,
    title: r.title,
    details: r.details,
    createdAt: r.createdAt,
    createdByName: r.createdByName,
    ...(clinician
      ? { entryType: r.entryType, status: r.status, visibleToPatient: r.visibleToPatient, consultationId: r.consultationId, updatedAt: r.updatedAt }
      : {}),
  });
  if (clinician) return records.map(shape);
  return {
    allergies: records.filter((r) => r.entryType === 'ALLERGY').map(shape),
    conditions: records.filter((r) => r.entryType === 'DIAGNOSIS').map(shape),
    medications: records.filter((r) => r.entryType === 'MEDICATION').map(shape),
    notes: records.filter((r) => r.entryType === 'NOTE').map(shape),
  };
}

export const recordService = {
  /** Patient: own records only (identity from session, never from the request). */
  async patientOwnRecords(req: Request) {
    const patientId = req.auth!.userId;
    const [records, reports, visits] = await Promise.all([
      recordRepo.forPatientView(patientId),
      recordRepo.reports(patientId),
      patientRepo.consultationHistory(patientId, 50),
    ]);
    await auditStrict(req, { action: 'MEDICAL_RECORD_VIEWED', result: 'SUCCESS', resourceType: 'patient', resourceId: patientId });
    return {
      ...(group(records, false) as object),
      reports: reports.map(({ patientId: _p, ...r }) => r),
      visits: visits.map((v) => ({ id: v.id, doctorName: v.doctorName, specialization: v.specialization, date: v.startedAt, status: v.status })),
    };
  },

  /** Doctor: full chart, only for an authorized patient. */
  async chartForDoctor(req: Request, patientId: string) {
    await assertDoctorPatientAccess(req, patientId);
    const [profile, records, corrections, reports, prescriptions, consultations] = await Promise.all([
      patientRepo.profile(patientId),
      recordRepo.forClinician(patientId, true),
      recordRepo.corrections(patientId),
      recordRepo.reports(patientId),
      prescriptionRepo.listForPatient(patientId, true, 50),
      consultationRepo.historyForDoctorPatient(patientId, 50),
    ]);
    if (!profile) throw notFound('PATIENT_NOT_FOUND');
    await auditStrict(req, { action: 'MEDICAL_RECORD_VIEWED', result: 'SUCCESS', resourceType: 'patient', resourceId: patientId });
    const { mobile: _m, emergencyContactPhone: _e, ...safeProfile } = profile;
    return { profile: safeProfile, records: group(records, true), corrections, reports, prescriptions, consultations };
  },

  async create(
    req: Request,
    patientId: string,
    body: { entryType: string; title: string; details: string | null; consultationId?: string | null; visibleToPatient: boolean },
  ) {
    await assertDoctorPatientAccess(req, patientId);
    const doctorId = req.auth!.userId;
    if (body.consultationId) {
      const c = await consultationRepo.byId(body.consultationId);
      if (!c || c.doctorId !== doctorId || c.patientId !== patientId) throw badRequest('INVALID_CONSULTATION');
    }
    const id = await withTransaction((db) =>
      recordRepo.insert(db, {
        patientId,
        entryType: body.entryType,
        title: body.title,
        details: body.details,
        consultationId: body.consultationId ?? null,
        visibleToPatient: body.visibleToPatient,
        actorId: doctorId,
      }),
    );
    await audit(req, { action: 'MEDICAL_RECORD_CREATED', result: 'SUCCESS', resourceType: 'medical_record', resourceId: id, metadata: { patientId, entryType: body.entryType } });
    return { id };
  },

  /**
   * Corrections never overwrite: the old entry is marked CORRECTED (or ENTERED_IN_ERROR),
   * a new entry is appended, and a correction row captures who/why/when/previous/new.
   */
  async correct(req: Request, recordId: string, body: { title?: string; details: string | null; reason: string; enteredInError: boolean }) {
    const doctorId = req.auth!.userId;
    const old = await recordRepo.byId(recordId);
    if (!old) return denyNotFound(req, 'medical_record', recordId);
    await assertDoctorPatientAccess(req, old.patientId);
    if (old.status !== 'ACTIVE') throw conflict('ALREADY_CORRECTED', 'This entry has already been corrected.');

    const previous = { title: old.title, details: old.details };
    const result = await withTransaction(async (db) => {
      let newId: string | null = null;
      let next: unknown = null;
      if (!body.enteredInError) {
        next = { title: body.title ?? old.title, details: body.details ?? null };
        newId = await recordRepo.insert(db, {
          patientId: old.patientId,
          entryType: old.entryType,
          title: body.title ?? old.title,
          details: body.details ?? null,
          consultationId: old.consultationId,
          visibleToPatient: old.visibleToPatient,
          actorId: doctorId,
        });
      }
      const n = await recordRepo.markStatus(db, recordId, body.enteredInError ? 'ENTERED_IN_ERROR' : 'CORRECTED', doctorId);
      if (n !== 1) throw conflict('ALREADY_CORRECTED', 'This entry has already been corrected.');
      await recordRepo.insertCorrection(db, { recordId, newRecordId: newId, reason: body.reason, previous, next, actorId: doctorId });
      return { newId };
    });
    await audit(req, {
      action: 'MEDICAL_RECORD_UPDATED',
      result: 'SUCCESS',
      resourceType: 'medical_record',
      resourceId: recordId,
      metadata: { patientId: old.patientId, newRecordId: result.newId, enteredInError: body.enteredInError },
    });
    return { id: result.newId };
  },
};
