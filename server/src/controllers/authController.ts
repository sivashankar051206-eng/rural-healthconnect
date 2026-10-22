import type { Request, Response } from 'express';
import type { Portal } from '../config/constants';
import { authService } from '../services/authService';
import { sessionRepo } from '../repositories/sessionRepo';
import { audit } from '../audit/audit';
import { notFound } from '../utils/httpError';

const GENERIC_RESET = { message: 'If this account exists, a code has been sent.' };

export const authController = {
  async login(req: Request, res: Response) {
    const portal = req.params.portal as Portal;
    const user = await authService.login(req, res, portal, req.body.identifier, req.body.password, req.body.totp);
    res.json({ user });
  },

  async registerPatient(req: Request, res: Response) {
    const user = await authService.registerPatient(req, res, req.body);
    res.status(201).json({ user });
  },

  async registerDoctor(req: Request, res: Response) {
    res.status(201).json(await authService.registerDoctor(req, req.body));
  },

  async me(req: Request, res: Response) {
    const a = req.auth!;
    res.json({ user: { id: a.userId, role: a.role, fullName: a.fullName, language: a.language, mfaVerified: a.mfaVerified } });
  },

  async logout(req: Request, res: Response) {
    await authService.logout(req, res);
    res.status(204).end();
  },

  async requestReset(req: Request, res: Response) {
    await authService.requestPasswordReset(req, req.params.portal as 'patient' | 'doctor', req.body.identifier);
    res.json(GENERIC_RESET);
  },

  async confirmReset(req: Request, res: Response) {
    await authService.confirmPasswordReset(req, req.params.portal as 'patient' | 'doctor', req.body.identifier, req.body.code, req.body.newPassword);
    res.json({ message: 'Password updated. Please log in.' });
  },

  async reauth(req: Request, res: Response) {
    await authService.reauth(req, req.body.password, req.body.totp);
    res.json({ ok: true });
  },

  async sessions(req: Request, res: Response) {
    const list = await sessionRepo.listActive(req.auth!.userId);
    res.json({ sessions: list.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })) });
  },

  async revokeSession(req: Request, res: Response) {
    const n = await sessionRepo.revoke(req.params.id, req.auth!.userId);
    if (n !== 1) throw notFound();
    await audit(req, { action: 'SESSION_REVOKED', result: 'SUCCESS', resourceType: 'session', resourceId: req.params.id });
    res.status(204).end();
  },
};
