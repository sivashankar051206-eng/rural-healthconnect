import type { Request } from 'express';
import { env } from '../config/env';
import { withTransaction } from '../db/pool';
import { audit } from '../audit/audit';
import { appointmentRepo } from '../repositories/appointmentRepo';
import { consultationRepo, type ConsultationRow } from '../repositories/consultationRepo';
import { denyNotFound } from '../security/access';
import { appointmentService } from './appointmentService';
import { notificationService } from './notificationService';
import { settingsService } from './settingsService';
import { conflict, unprocessable } from '../utils/httpError';

/** The video link is only ever returned to the two participants, and only while in progress. */
function view(c: ConsultationRow, viewerRole: 'PATIENT' | 'DOCTOR') {
  const base = {
    id: c.id,
    appointmentId: c.appointmentId,
    status: c.status,
    mode: c.mode,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    doctorName: c.doctorName,
    videoUrl: c.status === 'IN_PROGRESS' && env.VIDEO_BASE_URL && c.mode !== 'CHAT' ? `${env.VIDEO_BASE_URL}/rhc-${c.roomToken}` : null,
  };
  return viewerRole === 'DOCTOR' ? { ...base, patientId: c.patientId, patientName: c.patientName, patientCode: c.patientCode } : base;
}

async function loadAsParticipant(req: Request, id: string): Promise<ConsultationRow> {
  const c = await consultationRepo.byId(id);
  const uid = req.auth!.userId;
  if (!c || (c.patientId !== uid && c.doctorId !== uid)) return denyNotFound(req, 'consultation', id);
  return c;
}

export const consultationService = {
  async start(req: Request, appointmentId: string) {
    const doctorId = req.auth!.userId;
    const appt = await appointmentRepo.byId(appointmentId);
    if (!appt || appt.doctorId !== doctorId) return denyNotFound(req, 'appointment', appointmentId);
    if (appt.status === 'IN_PROGRESS' && appt.consultationId) {
      return view((await consultationRepo.byId(appt.consultationId))!, 'DOCTOR');
    }
    const early = await settingsService.number('consultation_join_early_minutes');
    if (new Date(appt.startsAt).getTime() - Date.now() > early * 60_000) {
      throw unprocessable('TOO_EARLY', 'This consultation cannot be started yet.');
    }
    const id = await withTransaction(async (db) => {
      const ok = await appointmentRepo.transition(db, appointmentId, { doctorId }, ['CONFIRMED'], 'IN_PROGRESS');
      if (!ok) throw conflict('INVALID_STATE', 'Only confirmed appointments can be started.');
      const cid = await consultationRepo.create(db, {
        appointmentId,
        patientId: appt.patientId,
        doctorId,
        roomToken: appointmentService.newRoomToken(),
      });
      await notificationService.notify(appt.patientId, 'consultation.started', { doctor: appt.doctorName }, `/patient/consultation/${cid}`, db);
      return cid;
    });
    await audit(req, { action: 'CONSULTATION_STARTED', result: 'SUCCESS', resourceType: 'consultation', resourceId: id });
    return view((await consultationRepo.byId(id))!, 'DOCTOR');
  },

  async complete(req: Request, id: string) {
    const doctorId = req.auth!.userId;
    const c = await consultationRepo.byId(id);
    if (!c || c.doctorId !== doctorId) return denyNotFound(req, 'consultation', id);
    await withTransaction(async (db) => {
      const n = await consultationRepo.complete(db, id, doctorId);
      if (n !== 1) throw conflict('INVALID_STATE', 'This consultation is not in progress.');
      await appointmentRepo.transition(db, c.appointmentId, { doctorId }, ['IN_PROGRESS'], 'COMPLETED');
    });
    await audit(req, { action: 'CONSULTATION_COMPLETED', result: 'SUCCESS', resourceType: 'consultation', resourceId: id });
    return view((await consultationRepo.byId(id))!, 'DOCTOR');
  },

  async get(req: Request, id: string) {
    const c = await loadAsParticipant(req, id);
    return view(c, req.auth!.role === 'DOCTOR' ? 'DOCTOR' : 'PATIENT');
  },

  async messages(req: Request, id: string, after: string | undefined) {
    await loadAsParticipant(req, id);
    const uid = req.auth!.userId;
    return (await consultationRepo.messages(id, after)).map((m) => ({ id: m.id, mine: m.senderId === uid, body: m.body, createdAt: m.createdAt }));
  },

  async send(req: Request, id: string, body: string) {
    const c = await loadAsParticipant(req, id);
    if (c.status !== 'IN_PROGRESS') throw conflict('CONSULTATION_CLOSED', 'This consultation has ended.');
    const m = await consultationRepo.addMessage(id, req.auth!.userId, body);
    return { id: m!.id, mine: true, body, createdAt: m!.createdAt };
  },
};
