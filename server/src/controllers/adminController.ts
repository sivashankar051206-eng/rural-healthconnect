import type { Request, Response } from 'express';
import { audit } from '../audit/audit';
import { adminRepo } from '../repositories/adminRepo';
import { adminService } from '../services/adminService';
import { paginate } from '../utils/http';
import { notFound } from '../utils/httpError';
import { ADMIN_PERMISSIONS } from '../config/constants';
import { env } from '../config/env';

type Page = { page: number; pageSize: number };

export const adminController = {
  async me(req: Request, res: Response) {
    res.json({ permissions: await adminRepo.permissionsOf(req.auth!.userId), allPermissions: ADMIN_PERMISSIONS });
  },

  async dashboard(_req: Request, res: Response) {
    res.json(await adminService.dashboard());
  },

  async doctors(req: Request, res: Response) {
    const { page, pageSize, status, q } = req.query as unknown as Page & { status?: string; q?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ doctors: await adminRepo.doctors(status, q, limit, offset) });
  },

  async doctorAction(req: Request, res: Response) {
    await adminService.doctorAction(req, req.params.id, req.body.action, req.body.notes ?? null);
    res.json({ ok: true });
  },

  async patients(req: Request, res: Response) {
    const { page, pageSize, q } = req.query as unknown as Page & { q?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ patients: await adminService.patients(q, limit, offset) });
  },

  async patientStatus(req: Request, res: Response) {
    await adminService.setPatientStatus(req, req.params.id, req.body.status);
    res.json({ ok: true });
  },

  async appointments(req: Request, res: Response) {
    const { page, pageSize, status, from, to } = req.query as unknown as Page & { status?: string; from?: string; to?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ appointments: await adminRepo.appointments(status, from, to, env.APP_TIMEZONE, limit, offset) });
  },

  async cancelAppointment(req: Request, res: Response) {
    await adminService.cancelAppointment(req, req.params.id, req.body.reason);
    res.json({ ok: true });
  },

  async auditLogs(req: Request, res: Response) {
    const { page, pageSize, ...filters } = req.query as unknown as Page & { action?: string; result?: string; actorId?: string; from?: string; to?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ logs: await adminService.auditLogs(req, filters, limit, offset) });
  },

  async facilities(_req: Request, res: Response) {
    res.json({ facilities: await adminRepo.facilities(false) });
  },

  async saveFacility(req: Request, res: Response) {
    const id = await adminRepo.upsertFacility(req.params.id ?? null, req.body, req.auth!.userId);
    if (!id) throw notFound();
    await audit(req, { action: req.params.id ? 'FACILITY_UPDATED' : 'FACILITY_CREATED', result: 'SUCCESS', resourceType: 'facility', resourceId: id });
    res.status(req.params.id ? 200 : 201).json({ id });
  },

  async issues(req: Request, res: Response) {
    const { page, pageSize, status } = req.query as unknown as Page & { status?: string };
    const { limit, offset } = paginate(page, pageSize);
    res.json({ issues: await adminRepo.issues(status, limit, offset) });
  },

  async updateIssue(req: Request, res: Response) {
    const n = await adminRepo.updateIssue(req.params.id, req.body.status, req.body.adminNotes ?? null, req.auth!.userId);
    if (n !== 1) throw notFound();
    await audit(req, { action: 'ISSUE_UPDATED', result: 'SUCCESS', resourceType: 'issue', resourceId: req.params.id, metadata: { status: req.body.status } });
    res.json({ ok: true });
  },

  async settings(_req: Request, res: Response) {
    res.json({ settings: await adminRepo.settings() });
  },

  async updateSettings(req: Request, res: Response) {
    await adminService.updateSettings(req, req.body);
    res.json({ settings: await adminRepo.settings() });
  },

  async admins(_req: Request, res: Response) {
    res.json({ admins: await adminRepo.admins() });
  },

  async setPermissions(req: Request, res: Response) {
    await adminService.setAdminPermissions(req, req.params.id, req.body.permissions);
    res.json({ ok: true });
  },

  async breakGlass(req: Request, res: Response) {
    res.json(await adminService.breakGlass(req, req.params.id, req.body.reason));
  },
};
