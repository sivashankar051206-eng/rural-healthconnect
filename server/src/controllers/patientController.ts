import type { Request, Response } from 'express';
import { audit } from '../audit/audit';
import { patientRepo } from '../repositories/patientRepo';
import { userRepo } from '../repositories/userRepo';
import { adminRepo } from '../repositories/adminRepo';
import { notificationRepo } from '../repositories/notificationRepo';
import { appointmentService } from '../services/appointmentService';
import { consultationService } from '../services/consultationService';
import { prescriptionService } from '../services/prescriptionService';
import { recordService } from '../services/recordService';
import { reportService } from '../services/reportService';
import { doctorRepo } from '../repositories/doctorRepo';
import { paginate } from '../utils/http';
import { notFound } from '../utils/httpError';

/** Every handler derives the patient id from the session (req.auth), never from the request. */
export const patientController = {
  async profile(req: Request, res: Response) {
    const p = await patientRepo.profile(req.auth!.userId);
    if (!p) throw notFound();
    const { userId: _u, ...rest } = p;
    res.json({ profile: rest });
  },

  async updateProfile(req: Request, res: Response) {
    const id = req.auth!.userId;
    const { preferredLanguage, ...rest } = req.body as { preferredLanguage?: 'en'; village?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null };
    if (preferredLanguage) await userRepo.setLanguage(id, preferredLanguage);
    await patientRepo.update(id, rest);
    await audit(req, { action: 'PATIENT_INFO_UPDATED', result: 'SUCCESS', resourceType: 'patient', resourceId: id, metadata: { fields: Object.keys(req.body) } });
    res.json({ ok: true });
  },

  async records(req: Request, res: Response) {
    res.json(await recordService.patientOwnRecords(req));
  },

  async uploadReport(req: Request, res: Response) {
    const r = await reportService.upload(req, req.auth!.userId, req.file, req.body.title);
    res.status(201).json({ report: r });
  },

  async reportFile(req: Request, res: Response) {
    await reportService.stream(req, res, req.params.id);
  },

  async prescriptions(req: Request, res: Response) {
    res.json({ prescriptions: await prescriptionService.listForPatient(req.auth!.userId) });
  },

  async prescription(req: Request, res: Response) {
    res.json({ prescription: await prescriptionService.getForPatient(req, req.params.id) });
  },

  async appointments(req: Request, res: Response) {
    const { page, pageSize, scope } = req.query as unknown as { page: number; pageSize: number; scope: 'upcoming' | 'past' };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ appointments: await appointmentService.listForPatient(req.auth!.userId, scope, limit, offset) });
  },

  async book(req: Request, res: Response) {
    const appt = await appointmentService.book(req, req.body, req.get('idempotency-key') ?? undefined);
    res.status(201).json({ appointment: appt });
  },

  async cancel(req: Request, res: Response) {
    await appointmentService.cancelByPatient(req, req.params.id, req.body.reason ?? null);
    res.json({ ok: true });
  },

  async consultation(req: Request, res: Response) {
    res.json({ consultation: await consultationService.get(req, req.params.id) });
  },

  async doctors(req: Request, res: Response) {
    const { page, pageSize, q, specialization } = req.query as unknown as { page: number; pageSize: number; q?: string; specialization?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ doctors: await doctorRepo.directory(q, specialization, limit, offset) });
  },

  async slots(req: Request, res: Response) {
    res.json({ slots: await appointmentService.slots(req.params.id, String(req.query.date)) });
  },

  async facilities(_req: Request, res: Response) {
    res.json({ facilities: await adminRepo.facilities(true) });
  },
};

/** Shared by patients and doctors (participants of a consultation). */
export const consultationController = {
  async messages(req: Request, res: Response) {
    res.json({ messages: await consultationService.messages(req, req.params.id, req.query.after as string | undefined) });
  },
  async send(req: Request, res: Response) {
    res.status(201).json({ message: await consultationService.send(req, req.params.id, req.body.body) });
  },
};

export const commonController = {
  async notifications(req: Request, res: Response) {
    const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
    const { limit, offset } = paginate(page, pageSize);
    const [items, unread] = await Promise.all([
      notificationRepo.list(req.auth!.userId, limit, offset),
      notificationRepo.unreadCount(req.auth!.userId),
    ]);
    res.json({ notifications: items, unread });
  },
  async readNotification(req: Request, res: Response) {
    await notificationRepo.markRead(req.auth!.userId, req.params.id);
    res.status(204).end();
  },
  async readAll(req: Request, res: Response) {
    await notificationRepo.markAllRead(req.auth!.userId);
    res.status(204).end();
  },
  async reportIssue(req: Request, res: Response) {
    const r = await adminRepo.insertIssue(req.auth!.userId, req.body.category, req.body.description);
    await audit(req, { action: 'ISSUE_REPORTED', result: 'SUCCESS', resourceType: 'issue', resourceId: r!.id });
    res.status(201).json({ id: r!.id });
  },
};
