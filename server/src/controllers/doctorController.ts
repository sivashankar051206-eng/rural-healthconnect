import type { Request, Response } from 'express';
import { env } from '../config/env';
import { withTransaction } from '../db/pool';
import { audit } from '../audit/audit';
import { doctorRepo } from '../repositories/doctorRepo';
import { appointmentService } from '../services/appointmentService';
import { consultationService } from '../services/consultationService';
import { prescriptionService } from '../services/prescriptionService';
import { recordService } from '../services/recordService';
import { reportService } from '../services/reportService';
import { paginate } from '../utils/http';
import { notFound } from '../utils/httpError';
import { redis } from '../redis/client';

export const doctorController = {
  /** Available to pending doctors too (limited access). */
  async me(req: Request, res: Response) {
    const s = await doctorRepo.status(req.auth!.userId);
    if (!s) throw notFound();
    res.json({ doctor: s });
  },

  async dashboard(req: Request, res: Response) {
    const doctorId = req.auth!.userId;
    const [counts, today] = await Promise.all([
      doctorRepo.dashboardCounts(doctorId, env.APP_TIMEZONE),
      appointmentService.listForDoctor(doctorId, undefined, new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE }).format(new Date()), 50, 0),
    ]);
    res.json({ counts, today });
  },

  async availability(req: Request, res: Response) {
    res.json({ slots: await doctorRepo.availability(req.auth!.userId) });
  },

  async setAvailability(req: Request, res: Response) {
    const doctorId = req.auth!.userId;
    await withTransaction((db) => doctorRepo.replaceAvailability(db, doctorId, req.body.slots));
    // Invalidate cached slot lists for this doctor.
    await new Promise<void>((resolve) => {
      const stream = redis.scanStream({ match: `slots:${doctorId}:*`, count: 100 });
      stream.on('data', (keys: string[]) => {
        if (keys.length) void redis.del(...keys);
      });
      stream.on('end', () => resolve());
      stream.on('error', () => resolve());
    });
    await audit(req, { action: 'AVAILABILITY_UPDATED', result: 'SUCCESS', resourceType: 'doctor', resourceId: doctorId });
    res.json({ slots: await doctorRepo.availability(doctorId) });
  },

  async appointments(req: Request, res: Response) {
    const { page, pageSize, status, date } = req.query as unknown as { page: number; pageSize: number; status?: string; date?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ appointments: await appointmentService.listForDoctor(req.auth!.userId, status, date, limit, offset) });
  },

  async decide(decision: 'accept' | 'reject' | 'cancel', req: Request, res: Response) {
    res.json({ appointment: await appointmentService.doctorDecision(req, req.params.id, decision, req.body?.reason ?? null) });
  },

  async startConsultation(req: Request, res: Response) {
    res.json({ consultation: await consultationService.start(req, req.params.id) });
  },

  async completeConsultation(req: Request, res: Response) {
    res.json({ consultation: await consultationService.complete(req, req.params.id) });
  },

  async consultation(req: Request, res: Response) {
    res.json({ consultation: await consultationService.get(req, req.params.id) });
  },

  async patients(req: Request, res: Response) {
    const { page, pageSize, q } = req.query as unknown as { page: number; pageSize: number; q?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ patients: await doctorRepo.authorizedPatients(req.auth!.userId, q, limit, offset) });
  },

  async chart(req: Request, res: Response) {
    res.json(await recordService.chartForDoctor(req, req.params.patientId));
  },

  async addRecord(req: Request, res: Response) {
    res.status(201).json(await recordService.create(req, req.params.patientId, req.body));
  },

  async correctRecord(req: Request, res: Response) {
    res.json(await recordService.correct(req, req.params.id, req.body));
  },

  async uploadReport(req: Request, res: Response) {
    res.status(201).json({ report: await reportService.upload(req, req.params.patientId, req.file, req.body.title) });
  },

  async reportFile(req: Request, res: Response) {
    await reportService.stream(req, res, req.params.id);
  },

  async prescriptions(req: Request, res: Response) {
    const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ prescriptions: await prescriptionService.listForDoctor(req.auth!.userId, limit, offset) });
  },

  async prescription(req: Request, res: Response) {
    res.json({ prescription: await prescriptionService.getForDoctor(req, req.params.id) });
  },

  async createPrescription(req: Request, res: Response) {
    res.status(201).json({ prescription: await prescriptionService.createDraft(req, req.body) });
  },

  async updatePrescription(req: Request, res: Response) {
    res.json({ prescription: await prescriptionService.updateDraft(req, req.params.id, req.body) });
  },

  async finalizePrescription(req: Request, res: Response) {
    res.json({ prescription: await prescriptionService.finalize(req, req.params.id, req.body.password) });
  },

  async revisePrescription(req: Request, res: Response) {
    res.status(201).json({ prescription: await prescriptionService.revise(req, req.params.id) });
  },

  async cancelPrescription(req: Request, res: Response) {
    res.json({ prescription: await prescriptionService.cancel(req, req.params.id, req.body.reason) });
  },
};
