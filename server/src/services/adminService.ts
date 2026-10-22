import type { Request } from 'express';
import { env } from '../config/env';
import { withTransaction } from '../db/pool';
import { audit, auditStrict } from '../audit/audit';
import { adminRepo } from '../repositories/adminRepo';
import { appointmentRepo } from '../repositories/appointmentRepo';
import { patientRepo } from '../repositories/patientRepo';
import { prescriptionRepo } from '../repositories/prescriptionRepo';
import { recordRepo } from '../repositories/recordRepo';
import { sessionRepo } from '../repositories/sessionRepo';
import { userRepo } from '../repositories/userRepo';
import { notificationService } from './notificationService';
import { settingsService } from './settingsService';
import { maskMobile } from '../utils/http';
import { badRequest, conflict, notFound } from '../utils/httpError';
import type { SettingKey } from '../validators/adminSchemas';

export const adminService = {
  async dashboard() {
    const [stats, perDay] = await Promise.all([adminRepo.stats(env.APP_TIMEZONE), adminRepo.appointmentsByDay(env.APP_TIMEZONE)]);
    return { stats, appointmentsByDay: perDay };
  },

  /** VERIFY => VERIFIED+active; REJECT => REJECTED; ACTIVATE/DEACTIVATE toggle an already verified doctor. */
  async doctorAction(req: Request, doctorId: string, action: 'VERIFY' | 'REJECT' | 'ACTIVATE' | 'DEACTIVATE', notes: string | null) {
    const adminId = req.auth!.userId;
    await withTransaction(async (db) => {
      const d = await adminRepo.doctorState(doctorId, db);
      if (!d) throw notFound('DOCTOR_NOT_FOUND');
      let next: { status: string; active: boolean; log: string; note: 'account.verified' | 'account.rejected' | 'account.deactivated' | null };
      switch (action) {
        case 'VERIFY':
          if (d.verificationStatus === 'VERIFIED') throw conflict('ALREADY_VERIFIED');
          next = { status: 'VERIFIED', active: true, log: 'VERIFIED', note: 'account.verified' };
          break;
        case 'REJECT':
          if (d.verificationStatus !== 'PENDING') throw conflict('INVALID_STATE', 'Only pending doctors can be rejected.');
          next = { status: 'REJECTED', active: false, log: 'REJECTED', note: 'account.rejected' };
          break;
        case 'ACTIVATE':
          if (d.verificationStatus !== 'VERIFIED') throw conflict('NOT_VERIFIED', 'Verify the doctor first.');
          next = { status: 'VERIFIED', active: true, log: 'ACTIVATED', note: null };
          break;
        case 'DEACTIVATE':
          next = { status: d.verificationStatus, active: false, log: 'DEACTIVATED', note: 'account.deactivated' };
          break;
        default:
          throw badRequest();
      }
      await adminRepo.setDoctorState(db, doctorId, next.status, next.active);
      await adminRepo.insertVerification(db, doctorId, next.log, notes, adminId);
      if (next.note) await notificationService.notify(doctorId, next.note, {}, '/doctor/dashboard', db);
    });
    await audit(req, { action: 'DOCTOR_VERIFICATION', result: 'SUCCESS', resourceType: 'doctor', resourceId: doctorId, metadata: { action } });
  },

  async patients(q: string | undefined, limit: number, offset: number) {
    return (await adminRepo.patients(q, limit, offset)).map((p) => ({ ...p, mobile: maskMobile(p.mobile) }));
  },

  async setPatientStatus(req: Request, patientId: string, status: 'ACTIVE' | 'DISABLED') {
    await withTransaction(async (db) => {
      const n = await userRepo.setStatus(patientId, 'PATIENT', status, db);
      if (n !== 1) throw notFound('PATIENT_NOT_FOUND');
      if (status === 'DISABLED') await sessionRepo.revokeAllForUser(patientId, null, db);
    });
    await audit(req, { action: 'PATIENT_STATUS_CHANGED', result: 'SUCCESS', resourceType: 'patient', resourceId: patientId, metadata: { status } });
  },

  async cancelAppointment(req: Request, id: string, reason: string) {
    const appt = await appointmentRepo.byId(id);
    if (!appt) throw notFound('APPOINTMENT_NOT_FOUND');
    const ok = await withTransaction(async (db) => {
      const done = await appointmentRepo.transition(db, id, {}, ['SCHEDULED', 'CONFIRMED'], 'CANCELLED', {
        cancelledBy: req.auth!.userId,
        cancelReason: reason,
      });
      if (done) {
        const when = new Date(appt.startsAt).toISOString();
        await notificationService.notify(appt.patientId, 'appointment.cancelled', { when }, '/patient/appointments', db);
        await notificationService.notify(appt.doctorId, 'appointment.cancelled', { when }, '/doctor/appointments', db);
      }
      return done;
    });
    if (!ok) throw conflict('INVALID_STATE', 'This appointment cannot be cancelled.');
    await audit(req, { action: 'APPOINTMENT_CANCELLED', result: 'SUCCESS', resourceType: 'appointment', resourceId: id, metadata: { by: 'admin' } });
  },

  async auditLogs(req: Request, filters: Parameters<typeof adminRepo.auditLogs>[0], limit: number, offset: number) {
    await audit(req, { action: 'AUDIT_LOG_VIEWED', result: 'SUCCESS', metadata: { filters } });
    return adminRepo.auditLogs(filters, limit, offset);
  },

  async updateSettings(req: Request, values: Partial<Record<SettingKey, unknown>>) {
    await settingsService.update(values, req.auth!.userId);
    await audit(req, { action: 'SETTINGS_UPDATED', result: 'SUCCESS', metadata: { keys: Object.keys(values) } });
  },

  async setAdminPermissions(req: Request, targetId: string, permissions: string[]) {
    const self = req.auth!.userId;
    const target = await userRepo.findById(targetId);
    if (!target || target.role !== 'ADMIN') throw notFound('ADMIN_NOT_FOUND');
    if (targetId === self && !permissions.includes('admin.permissions.manage')) {
      throw conflict('SELF_LOCKOUT', 'You cannot remove your own permission-management access.');
    }
    const before = await adminRepo.permissionsOf(targetId);
    await withTransaction((db) => adminRepo.setPermissions(db, targetId, [...new Set(permissions)], self));
    await audit(req, { action: 'PERMISSIONS_CHANGED', result: 'SUCCESS', resourceType: 'user', resourceId: targetId, metadata: { before, after: permissions } });
  },

  /**
   * Break-glass clinical access. Requires the explicit `clinical.breakglass`
   * permission, a recent re-authentication, and a written reason. The access is
   * strictly audited BEFORE data is returned, and the patient is notified.
   */
  async breakGlass(req: Request, patientId: string, reason: string) {
    const profile = await patientRepo.profile(patientId);
    if (!profile) throw notFound('PATIENT_NOT_FOUND');
    await auditStrict(req, { action: 'BREAKGLASS_CLINICAL_ACCESS', result: 'SUCCESS', resourceType: 'patient', resourceId: patientId, metadata: { reason } });
    await notificationService.notify(patientId, 'security.admin_record_access', {}, null);
    const [records, prescriptions] = await Promise.all([
      recordRepo.forClinician(patientId, false),
      prescriptionRepo.listForPatient(patientId, false, 50),
    ]);
    return {
      patient: { patientCode: profile.patientCode, fullName: profile.fullName, dateOfBirth: profile.dateOfBirth },
      records: records.map((r) => ({ id: r.id, entryType: r.entryType, title: r.title, details: r.details, createdAt: r.createdAt, createdByName: r.createdByName })),
      prescriptions,
    };
  },
};
