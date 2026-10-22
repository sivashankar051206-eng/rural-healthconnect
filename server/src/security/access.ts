import type { Request } from 'express';
import { DOCTOR_ACCESS_STATUSES } from '../config/constants';
import { one, pool, type Db } from '../db/pool';
import { audit } from '../audit/audit';
import { notFound } from '../utils/httpError';

/**
 * A doctor may access a patient's clinical record only if they have (or had) a
 * confirmed / in-progress / completed appointment with that patient.
 * Admins are NOT covered here: they need the audited break-glass flow.
 */
export async function doctorCanAccessPatient(doctorId: string, patientId: string, db: Db = pool): Promise<boolean> {
  const r = await one<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM appointments
        WHERE doctor_id = $1 AND patient_id = $2 AND status = ANY($3::text[])
     ) AS ok`,
    [doctorId, patientId, DOCTOR_ACCESS_STATUSES],
    db,
  );
  return Boolean(r?.ok);
}

/**
 * Throws 404 (not 403) so that unauthorized callers cannot learn whether a
 * patient exists (prevents IDOR-based enumeration). The denial is audited.
 */
export async function assertDoctorPatientAccess(req: Request, patientId: string, db: Db = pool): Promise<void> {
  const doctorId = req.auth!.userId;
  if (!(await doctorCanAccessPatient(doctorId, patientId, db))) {
    await audit(req, {
      action: 'PERMISSION_DENIED',
      result: 'DENIED',
      resourceType: 'patient',
      resourceId: patientId,
      metadata: { reason: 'doctor not authorized for patient' },
    });
    throw notFound('PATIENT_NOT_FOUND');
  }
}

/** Denies with an audited 404 for any resource the caller does not own. */
export async function denyNotFound(req: Request, resourceType: string, resourceId: string, code = 'NOT_FOUND'): Promise<never> {
  await audit(req, { action: 'PERMISSION_DENIED', result: 'DENIED', resourceType, resourceId });
  throw notFound(code);
}
