import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { COOKIE, REAUTH_WINDOW_MINUTES, type AdminPermission, type Role } from '../config/constants';
import { one } from '../db/pool';
import { audit } from '../audit/audit';
import { hmac, safeEqual } from '../security/crypto';
import { sessionService } from '../services/sessionService';
import { forbidden, unauthorized } from '../utils/httpError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 1. Authentication: identity comes ONLY from the server-side session referenced by
 * the HttpOnly cookie. Role / user id / permissions sent by the client are ignored.
 * 2. CSRF: every state-changing request must echo the CSRF token in X-CSRF-Token.
 */
export const authenticate: RequestHandler = (req, res, next) => {
  void (async () => {
    const token: unknown = req.cookies?.[COOKIE.session];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return next(unauthorized());
    const ctx = await sessionService.resolve(token);
    if (!ctx) {
      sessionService.clearCookies(res);
      return next(unauthorized('SESSION_EXPIRED', 'Your session has ended. Please log in again.'));
    }
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.get('x-csrf-token');
      if (!header || header.length > 200 || !safeEqual(hmac(header), ctx.csrfHash)) {
        await audit(req, { action: 'CSRF_REJECTED', result: 'DENIED', actorId: ctx.userId, actorRole: ctx.role });
        return next(forbidden('CSRF_INVALID', 'Please refresh the page and try again.'));
      }
    }
    req.auth = ctx;
    return next();
  })().catch(next);
};

function deny(req: Request, next: NextFunction, reason: string, code = 'FORBIDDEN') {
  // Audit first (audit() never throws), then respond, so every denial is recorded.
  void audit(req, {
    action: 'PERMISSION_DENIED',
    result: 'DENIED',
    metadata: { reason, method: req.method, path: req.baseUrl + req.path },
  }).then(() => next(forbidden(code)));
}

/** 3. Role check. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return deny(req, next, `role ${req.auth.role} not in ${roles.join(',')}`);
    return next();
  };

/** Admin sessions must have completed MFA at login. */
export const requireMfa: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  if (!req.auth.mfaVerified) return deny(req, next, 'mfa not verified', 'MFA_REQUIRED');
  return next();
};

/** Unverified or deactivated doctors keep only limited access (their own status/profile). */
export const requireActiveDoctor: RequestHandler = (req, _res, next) => {
  void (async () => {
    if (!req.auth || req.auth.role !== 'DOCTOR') return next(unauthorized());
    const d = await one<{ ok: boolean }>(
      `SELECT (verification_status = 'VERIFIED' AND is_active) AS ok FROM doctors WHERE user_id = $1`,
      [req.auth.userId],
    );
    if (!d?.ok) return deny(req, next, 'doctor not verified/active', 'DOCTOR_NOT_ACTIVE');
    return next();
  })().catch(next);
};

/** Explicit, per-administrator permissions (least privilege). */
export const requirePermission =
  (permission: AdminPermission): RequestHandler =>
  (req, _res, next) => {
    void (async () => {
      if (!req.auth || req.auth.role !== 'ADMIN') return next(unauthorized());
      const p = await one<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM user_permissions WHERE user_id = $1 AND permission_code = $2) AS ok`,
        [req.auth.userId, permission],
      );
      if (!p?.ok) return deny(req, next, `missing permission ${permission}`, 'PERMISSION_REQUIRED');
      return next();
    })().catch(next);
  };

/** Highly sensitive actions require re-entering credentials within the last few minutes. */
export const requireRecentReauth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  const at = req.auth.reauthAt?.getTime() ?? 0;
  if (Date.now() - at > REAUTH_WINDOW_MINUTES * 60_000) {
    return next(forbidden('REAUTH_REQUIRED', 'Please confirm your password to continue.'));
  }
  return next();
};

export function currentUserId(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.userId;
}

export type { Response };
