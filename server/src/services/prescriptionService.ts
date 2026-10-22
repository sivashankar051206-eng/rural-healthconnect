import crypto from 'node:crypto';
import type { Request } from 'express';
import { PG, pgCode, withTransaction } from '../db/pool';
import { audit, auditStrict } from '../audit/audit';
import { prescriptionRepo, type PrescriptionItem, type PrescriptionRow } from '../repositories/prescriptionRepo';
import { consultationRepo } from '../repositories/consultationRepo';
import { assertDoctorPatientAccess, denyNotFound } from '../security/access';
import { sha256 } from '../security/crypto';
import { authService } from './authService';
import { notificationService } from './notificationService';
import { badRequest, conflict, forbidden } from '../utils/httpError';

type ItemInput = Omit<PrescriptionItem, 'position'>;

function canonicalHash(p: PrescriptionRow, items: PrescriptionItem[], finalizedAt: Date): string {
  return sha256(
    JSON.stringify({
      id: p.id,
      rootId: p.rootId,
      version: p.version,
      patientId: p.patientId,
      doctorId: p.doctorId,
      notes: p.notes,
      items,
      finalizedAt: finalizedAt.toISOString(),
    }),
  );
}

function present(p: PrescriptionRow, items: PrescriptionItem[]) {
  return {
    id: p.id,
    version: p.version,
    previousVersionId: p.previousVersionId,
    status: p.status,
    notes: p.notes,
    finalizedAt: p.finalizedAt,
    createdAt: p.createdAt,
    cancelReason: p.cancelReason,
    contentHash: p.contentHash,
    doctor: { name: p.doctorName, qualification: p.doctorQualification, registrationNumber: p.doctorRegistration },
    patient: { name: p.patientName, patientCode: p.patientCode },
    items,
  };
}

/** Loads a prescription the requesting doctor is allowed to work on. */
async function loadForDoctor(req: Request, id: string, lockDb?: Parameters<typeof prescriptionRepo.byId>[1]) {
  const p = await prescriptionRepo.byId(id, lockDb, Boolean(lockDb));
  if (!p) return denyNotFound(req, 'prescription', id);
  await assertDoctorPatientAccess(req, p.patientId, lockDb);
  return p;
}

export const prescriptionService = {
  async createDraft(req: Request, body: { patientId: string; consultationId?: string | null; notes: string | null; items: ItemInput[] }) {
    const doctorId = req.auth!.userId;
    await assertDoctorPatientAccess(req, body.patientId);
    if (body.consultationId) {
      const c = await consultationRepo.byId(body.consultationId);
      if (!c || c.doctorId !== doctorId || c.patientId !== body.patientId) throw badRequest('INVALID_CONSULTATION');
    }
    const id = crypto.randomUUID();
    await withTransaction(async (db) => {
      await prescriptionRepo.insert(db, {
        id,
        rootId: id,
        version: 1,
        previousVersionId: null,
        patientId: body.patientId,
        doctorId,
        consultationId: body.consultationId ?? null,
        notes: body.notes,
      });
      await prescriptionRepo.replaceItems(db, id, body.items);
    });
    await audit(req, { action: 'PRESCRIPTION_DRAFTED', result: 'SUCCESS', resourceType: 'prescription', resourceId: id, metadata: { patientId: body.patientId } });
    return this.getForDoctor(req, id, false);
  },

  /** Only the authoring doctor may edit their own DRAFT. */
  async updateDraft(req: Request, id: string, body: { notes: string | null; items: ItemInput[] }) {
    const doctorId = req.auth!.userId;
    await withTransaction(async (db) => {
      const p = await loadForDoctor(req, id, db);
      if (p.doctorId !== doctorId) throw forbidden('NOT_AUTHOR');
      if (p.status !== 'DRAFT') throw conflict('RECORD_IMMUTABLE', 'This prescription can no longer be changed.');
      await prescriptionRepo.updateDraftNotes(db, id, body.notes, doctorId);
      await prescriptionRepo.replaceItems(db, id, body.items);
    });
    await audit(req, { action: 'PRESCRIPTION_MODIFIED', result: 'SUCCESS', resourceType: 'prescription', resourceId: id, metadata: { stage: 'draft' } });
    return this.getForDoctor(req, id, false);
  },

  /**
   * Doctor signs the prescription by re-entering their password. The content is
   * hashed, the row becomes ACTIVE and is immutable from then on (enforced by DB triggers).
   * If this is a revision, the previous version becomes SUPERSEDED.
   */
  async finalize(req: Request, id: string, password: string) {
    const doctorId = req.auth!.userId;
    if (!(await authService.verifyOwnPassword(doctorId, password))) {
      await audit(req, { action: 'PRESCRIPTION_SIGN_FAILED', result: 'FAILURE', resourceType: 'prescription', resourceId: id });
      throw forbidden('SIGNATURE_FAILED', 'Password is not correct.');
    }
    const patientId = await withTransaction(async (db) => {
      const p = await loadForDoctor(req, id, db);
      if (p.doctorId !== doctorId) throw forbidden('NOT_AUTHOR');
      if (p.status !== 'DRAFT') throw conflict('RECORD_IMMUTABLE', 'This prescription is already finalized.');
      const items = await prescriptionRepo.items(id, db);
      if (items.length === 0) throw badRequest('NO_ITEMS', 'Add at least one medicine.');
      const finalizedAt = new Date();
      await prescriptionRepo.finalize(db, id, canonicalHash(p, items, finalizedAt), finalizedAt, doctorId);
      if (p.previousVersionId) {
        await prescriptionRepo.setStatus(db, p.previousVersionId, ['ACTIVE'], 'SUPERSEDED', doctorId);
      }
      // Generic, non-clinical notification text (spec §30-31).
      await notificationService.notify(p.patientId, 'prescription.available', {}, '/patient/prescriptions', db);
      return p.patientId;
    });
    await audit(req, { action: 'PRESCRIPTION_CREATED', result: 'SUCCESS', resourceType: 'prescription', resourceId: id, metadata: { patientId, signed: true } });
    return this.getForDoctor(req, id, false);
  },

  /** Corrections create a new DRAFT version; the original is never overwritten. */
  async revise(req: Request, id: string) {
    const doctorId = req.auth!.userId;
    const newId = crypto.randomUUID();
    try {
      await withTransaction(async (db) => {
        const p = await loadForDoctor(req, id, db);
        if (p.status !== 'ACTIVE') throw conflict('INVALID_STATE', 'Only an active prescription can be revised.');
        const items = await prescriptionRepo.items(id, db);
        await prescriptionRepo.insert(db, {
          id: newId,
          rootId: p.rootId,
          version: p.version + 1,
          previousVersionId: p.id,
          patientId: p.patientId,
          doctorId,
          consultationId: p.consultationId,
          notes: p.notes,
        });
        await prescriptionRepo.replaceItems(db, newId, items.map(({ position: _p, ...rest }) => rest));
      });
    } catch (err) {
      if (pgCode(err) === PG.UNIQUE_VIOLATION) throw conflict('DRAFT_EXISTS', 'A revision is already in progress.');
      throw err;
    }
    await audit(req, { action: 'PRESCRIPTION_MODIFIED', result: 'SUCCESS', resourceType: 'prescription', resourceId: id, metadata: { revisionId: newId } });
    return this.getForDoctor(req, newId, false);
  },

  async cancel(req: Request, id: string, reason: string) {
    const doctorId = req.auth!.userId;
    await withTransaction(async (db) => {
      const p = await loadForDoctor(req, id, db);
      if (p.doctorId !== doctorId) throw forbidden('NOT_AUTHOR');
      const n = await prescriptionRepo.setStatus(db, id, ['DRAFT', 'ACTIVE'], 'CANCELLED', doctorId, reason);
      if (n !== 1) throw conflict('INVALID_STATE', 'This prescription cannot be cancelled.');
    });
    await audit(req, { action: 'PRESCRIPTION_CANCELLED', result: 'SUCCESS', resourceType: 'prescription', resourceId: id, metadata: { reason } });
    return this.getForDoctor(req, id, false);
  },

  async getForDoctor(req: Request, id: string, logView = true) {
    const p = await loadForDoctor(req, id);
    const items = await prescriptionRepo.items(id);
    if (logView) await auditStrict(req, { action: 'PRESCRIPTION_VIEWED', result: 'SUCCESS', resourceType: 'prescription', resourceId: id });
    return present(p, items);
  },

  /** Patient view: own, non-draft prescriptions only; every view is audited before data is returned. */
  async getForPatient(req: Request, id: string) {
    const patientId = req.auth!.userId;
    const p = await prescriptionRepo.byId(id);
    if (!p || p.patientId !== patientId || p.status === 'DRAFT') return denyNotFound(req, 'prescription', id);
    const items = await prescriptionRepo.items(id);
    const viewedAt = new Date();
    await auditStrict(req, { action: 'PRESCRIPTION_VIEWED', result: 'SUCCESS', resourceType: 'prescription', resourceId: id });
    const { contentHash: _h, ...rest } = present(p, items);
    return {
      ...rest,
      verificationCode: p.contentHash ? p.contentHash.slice(0, 12).toUpperCase() : null,
      watermark: { patientName: p.patientName, patientCode: p.patientCode, viewedAt: viewedAt.toISOString(), label: 'Confidential Medical Document' },
    };
  },

  listForPatient(patientId: string) {
    return prescriptionRepo.listForPatient(patientId, false, 100);
  },

  listForDoctor(doctorId: string, limit: number, offset: number) {
    return prescriptionRepo.listForDoctor(doctorId, limit, offset);
  },
};
