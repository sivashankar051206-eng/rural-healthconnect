import type { Request, Response } from 'express';
import { COOKIE, SESSION_POLICY, type Role } from '../config/constants';
import { env } from '../config/env';
import { withTransaction, type Db } from '../db/pool';
import { sessionRepo } from '../repositories/sessionRepo';
import { hmac, randomToken } from '../security/crypto';
import type { AuthContext } from '../types/express';

const TOUCH_INTERVAL_MS = 60_000;

function cookieBase(maxAgeMs: number) {
  return {
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export const sessionService = {
  /**
   * Creates a brand-new session (fresh random token => no session fixation) and
   * sets an HttpOnly session cookie plus a readable CSRF cookie (double submit).
   */
  async create(
    req: Request,
    res: Response,
    user: { id: string; role: Role },
    opts: { mfaVerified: boolean },
    db?: Db,
  ): Promise<void> {
    const policy = SESSION_POLICY[user.role];
    const token = randomToken(32);
    const csrf = randomToken(24);
    const absoluteMs = policy.absoluteHours * 3600_000;
    const expiresAt = new Date(Date.now() + absoluteMs);
    const ua = (req.get('user-agent') ?? '').slice(0, 255) || null;

    const insert = (d: Db) =>
      sessionRepo.insert(d, {
        userId: user.id,
        tokenHash: hmac(token),
        csrfHash: hmac(csrf),
        expiresAt,
        ip: req.ip ?? null,
        userAgent: ua,
        mfaVerified: opts.mfaVerified,
      });
    if (db) await insert(db);
    else await withTransaction((c) => insert(c));

    res.cookie(COOKIE.session, token, { ...cookieBase(absoluteMs), httpOnly: true });
    res.cookie(COOKIE.csrf, csrf, { ...cookieBase(absoluteMs), httpOnly: false });
  },

  /** Resolves a raw cookie token to an auth context, enforcing absolute + idle expiry. */
  async resolve(token: string): Promise<AuthContext | null> {
    const s = await sessionRepo.findByTokenHash(hmac(token));
    if (!s || s.userStatus !== 'ACTIVE') return null;
    const now = Date.now();
    if (new Date(s.expiresAt).getTime() <= now) return null;
    const idleMs = SESSION_POLICY[s.role].idleMinutes * 60_000;
    if (now - new Date(s.lastSeenAt).getTime() > idleMs) {
      await sessionRepo.revoke(s.id, s.userId);
      return null;
    }
    if (now - new Date(s.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
      await sessionRepo.touch(s.id);
    }
    return {
      userId: s.userId,
      role: s.role,
      sessionId: s.id,
      fullName: s.fullName,
      language: s.language,
      mfaVerified: s.mfaVerified,
      reauthAt: s.reauthAt ? new Date(s.reauthAt) : null,
      csrfHash: s.csrfHash,
    };
  },

  clearCookies(res: Response): void {
    const base = { secure: env.COOKIE_SECURE, sameSite: 'strict' as const, path: '/' };
    res.clearCookie(COOKIE.session, { ...base, httpOnly: true });
    res.clearCookie(COOKIE.csrf, base);
  },
};
