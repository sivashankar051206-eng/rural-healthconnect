import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { asyncHandler as h } from '../utils/http';
import { validate, uuidParam } from '../middleware/validate';
import {
  authenticate,
  requireActiveDoctor,
  requireMfa,
  requirePermission,
  requireRecentReauth,
  requireRole,
} from '../middleware/auth';
import { authLimiter, messageLimiter, uploadLimiter } from '../middleware/rateLimit';
import { authController as auth } from '../controllers/authController';
import { patientController as patient, consultationController as consult, commonController as common } from '../controllers/patientController';
import { doctorController as doctor } from '../controllers/doctorController';
import { adminController as admin } from '../controllers/adminController';
import * as A from '../validators/authSchemas';
import * as C from '../validators/clinicalSchemas';
import * as M from '../validators/adminSchemas';
import { pageQuery } from '../validators/common';

/** Files are held in memory (bounded), validated by signature, then written outside any public dir. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 1024 },
});

const idParam = uuidParam('id');
const patientIdParam = uuidParam('patientId');

export function buildRoutes(): Router {
  const api = Router();

  // ---------------------------------------------------------------- auth (public)
  const pub = Router();
  pub.post('/:portal/login', authLimiter, validate({ params: A.portalParam, body: A.loginBody }), h(auth.login));
  pub.post('/patient/register', authLimiter, validate({ body: A.patientRegisterBody }), h(auth.registerPatient));
  pub.post('/doctor/register', authLimiter, validate({ body: A.doctorRegisterBody }), h(auth.registerDoctor));
  pub.post('/:portal/password-reset/request', authLimiter, validate({ params: A.resetPortalParam, body: A.resetRequestBody }), h(auth.requestReset));
  pub.post('/:portal/password-reset/confirm', authLimiter, validate({ params: A.resetPortalParam, body: A.resetConfirmBody }), h(auth.confirmReset));
  // authenticated auth endpoints
  pub.get('/me', authenticate, h(auth.me));
  pub.post('/logout', authenticate, h(auth.logout));
  pub.post('/reauth', authLimiter, authenticate, validate({ body: A.reauthBody }), h(auth.reauth));
  pub.get('/sessions', authenticate, h(auth.sessions));
  pub.delete('/sessions/:id', authenticate, validate({ params: A.sessionIdParam }), h(auth.revokeSession));
  api.use('/auth', pub);

  // ---------------------------------------------------------------- shared (any authenticated user)
  const shared = Router();
  shared.get('/notifications', authenticate, validate({ query: pageQuery }), h(common.notifications));
  shared.post('/notifications/read-all', authenticate, h(common.readAll));
  shared.post('/notifications/:id/read', authenticate, validate({ params: idParam }), h(common.readNotification));
  shared.post('/issues', authenticate, requireRole('PATIENT', 'DOCTOR'), validate({ body: C.issueBody }), h(common.reportIssue));
  // Consultation chat: participants only (checked in the service).
  shared.get('/consultations/:id/messages', authenticate, requireRole('PATIENT', 'DOCTOR'), validate({ params: idParam, query: C.messagesQuery }), h(consult.messages));
  shared.post('/consultations/:id/messages', authenticate, requireRole('PATIENT', 'DOCTOR'), messageLimiter, validate({ params: idParam, body: C.messageBody }), h(consult.send));
  api.use('/', shared);

  // ---------------------------------------------------------------- patient
  const p = Router();
  p.use(authenticate, requireRole('PATIENT'));
  p.get('/profile', h(patient.profile));
  p.patch('/profile', validate({ body: C.patientProfileUpdate }), h(patient.updateProfile));
  p.get('/records', h(patient.records));
  p.post('/reports', uploadLimiter, upload.single('file'), validate({ body: C.reportUploadFields }), h(patient.uploadReport));
  p.get('/reports/:id/file', validate({ params: idParam }), h(patient.reportFile));
  p.get('/prescriptions', h(patient.prescriptions));
  p.get('/prescriptions/:id', validate({ params: idParam }), h(patient.prescription));
  p.get('/appointments', validate({ query: C.appointmentListQuery }), h(patient.appointments));
  p.post('/appointments', validate({ body: C.bookBody }), h(patient.book));
  p.post('/appointments/:id/cancel', validate({ params: idParam, body: C.cancelBody }), h(patient.cancel));
  p.get('/consultations/:id', validate({ params: idParam }), h(patient.consultation));
  p.get('/doctors', validate({ query: C.doctorSearchQuery }), h(patient.doctors));
  p.get('/doctors/:id/slots', validate({ params: idParam, query: C.slotsQuery }), h(patient.slots));
  p.get('/facilities', h(patient.facilities));
  api.use('/patient', p);

  // ---------------------------------------------------------------- doctor
  const d = Router();
  d.use(authenticate, requireRole('DOCTOR'));
  d.get('/me', h(doctor.me)); // available to unverified doctors (limited access)
  d.use(requireActiveDoctor); // everything below requires a verified, active doctor
  d.get('/dashboard', h(doctor.dashboard));
  d.get('/availability', h(doctor.availability));
  d.put('/availability', validate({ body: C.availabilityBody }), h(doctor.setAvailability));
  d.get('/appointments', validate({ query: C.doctorAppointmentsQuery }), h(doctor.appointments));
  d.post('/appointments/:id/accept', validate({ params: idParam }), h((req, res) => doctor.decide('accept', req, res)));
  d.post('/appointments/:id/reject', validate({ params: idParam, body: C.cancelBody }), h((req, res) => doctor.decide('reject', req, res)));
  d.post('/appointments/:id/cancel', validate({ params: idParam, body: C.cancelBody }), h((req, res) => doctor.decide('cancel', req, res)));
  d.post('/appointments/:id/start', validate({ params: idParam }), h(doctor.startConsultation));
  d.get('/consultations/:id', validate({ params: idParam }), h(doctor.consultation));
  d.post('/consultations/:id/complete', validate({ params: idParam }), h(doctor.completeConsultation));
  d.get('/patients', validate({ query: C.patientSearchQuery }), h(doctor.patients));
  d.get('/patients/:patientId', validate({ params: patientIdParam }), h(doctor.chart));
  d.post('/patients/:patientId/records', validate({ params: patientIdParam, body: C.recordCreateBody }), h(doctor.addRecord));
  d.post('/patients/:patientId/reports', uploadLimiter, validate({ params: patientIdParam }), upload.single('file'), validate({ body: C.reportUploadFields }), h(doctor.uploadReport));
  d.post('/records/:id/correct', validate({ params: idParam, body: C.recordCorrectBody }), h(doctor.correctRecord));
  d.get('/reports/:id/file', validate({ params: idParam }), h(doctor.reportFile));
  d.get('/prescriptions', validate({ query: pageQuery }), h(doctor.prescriptions));
  d.post('/prescriptions', validate({ body: C.prescriptionCreateBody }), h(doctor.createPrescription));
  d.get('/prescriptions/:id', validate({ params: idParam }), h(doctor.prescription));
  d.put('/prescriptions/:id', validate({ params: idParam, body: C.prescriptionUpdateBody }), h(doctor.updatePrescription));
  d.post('/prescriptions/:id/finalize', authLimiter, validate({ params: idParam, body: C.prescriptionFinalizeBody }), h(doctor.finalizePrescription));
  d.post('/prescriptions/:id/revise', validate({ params: idParam }), h(doctor.revisePrescription));
  d.post('/prescriptions/:id/cancel', validate({ params: idParam, body: C.prescriptionCancelBody }), h(doctor.cancelPrescription));
  api.use('/doctor', d);

  // ---------------------------------------------------------------- admin
  const a = Router();
  a.use(authenticate, requireRole('ADMIN'), requireMfa);
  a.get('/me', h(admin.me));
  a.get('/dashboard', h(admin.dashboard));
  a.get('/doctors', requirePermission('admin.doctors.manage'), validate({ query: M.adminDoctorQuery }), h(admin.doctors));
  a.post('/doctors/:id/action', requirePermission('admin.doctors.manage'), validate({ params: idParam, body: M.doctorActionBody }), h(admin.doctorAction));
  a.get('/patients', requirePermission('admin.patients.manage'), validate({ query: M.adminPatientQuery }), h(admin.patients));
  a.post('/patients/:id/status', requirePermission('admin.patients.manage'), validate({ params: idParam, body: M.patientStatusBody }), h(admin.patientStatus));
  a.get('/appointments', requirePermission('admin.appointments.manage'), validate({ query: M.adminAppointmentQuery }), h(admin.appointments));
  a.post('/appointments/:id/cancel', requirePermission('admin.appointments.manage'), validate({ params: idParam, body: M.adminCancelBody }), h(admin.cancelAppointment));
  a.get('/audit-logs', requirePermission('admin.audit.view'), validate({ query: M.auditQuery }), h(admin.auditLogs));
  a.get('/facilities', requirePermission('admin.facilities.manage'), h(admin.facilities));
  a.post('/facilities', requirePermission('admin.facilities.manage'), validate({ body: M.facilityBody }), h(admin.saveFacility));
  a.put('/facilities/:id', requirePermission('admin.facilities.manage'), validate({ params: idParam, body: M.facilityBody }), h(admin.saveFacility));
  a.get('/issues', requirePermission('admin.issues.manage'), validate({ query: M.issueQuery }), h(admin.issues));
  a.patch('/issues/:id', requirePermission('admin.issues.manage'), validate({ params: idParam, body: M.issueUpdateBody }), h(admin.updateIssue));
  a.get('/settings', requirePermission('admin.settings.manage'), h(admin.settings));
  a.put('/settings', requirePermission('admin.settings.manage'), requireRecentReauth, validate({ body: M.settingsBody }), h(admin.updateSettings));
  a.get('/admins', requirePermission('admin.permissions.manage'), h(admin.admins));
  a.put('/admins/:id/permissions', requirePermission('admin.permissions.manage'), requireRecentReauth, validate({ params: idParam, body: M.permissionsBody }), h(admin.setPermissions));
  a.post('/break-glass/patients/:id', requirePermission('clinical.breakglass'), requireRecentReauth, validate({ params: idParam, body: M.breakGlassBody }), h(admin.breakGlass));
  api.use('/admin', a);

  return api;
}

