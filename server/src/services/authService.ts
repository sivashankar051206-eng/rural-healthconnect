import type { Request, Response } from 'express';
import { authenticator } from 'otplib';
import { LOCKOUT, PASSWORD_MIN, PASSWORD_RESET, PORTAL_ROLE, type Portal } from '../config/constants';
import { pgCode, PG, withTransaction } from '../db/pool';
import { redis } from '../redis/client';
import { audit } from '../audit/audit';
import { decrypt, hmac, randomCode, randomNumericCode, safeEqual } from '../security/crypto';
import { hashPassword, verifyPassword } from '../security/password';
import { userRepo, type UserAuthRow } from '../repositories/userRepo';
import { sessionRepo } from '../repositories/sessionRepo';
import { patientRepo } from '../repositories/patientRepo';
import { doctorRepo } from '../repositories/doctorRepo';
import { sessionService } from './sessionService';
import { messagingService } from './messagingService';
import { notificationService } from './notificationService';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../utils/httpError';
import { email as emailSchema, mobile as mobileSchema } from '../validators/common';
import type { z } from 'zod';
import type { doctorRegisterBody, patientRegisterBody } from '../validators/authSchemas';

authenticator.options = { window: 1, step: 30 };

const INVALID_LOGIN = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'The login details are not correct.');

/** Patients log in with a mobile number; doctors and admins with email. */
async function findForPortal(portal: Portal, identifier: string): Promise<UserAuthRow | null> {
  const role = PORTAL_ROLE[portal];
  if (portal === 'patient') {
    const m = mobileSchema.safeParse(identifier);
    return m.success ? userRepo.findByMobile(m.data, role) : null;
  }
  const e = emailSchema.safeParse(identifier);
  return e.success ? userRepo.findByEmail(e.data, role) : null;
}

/** TOTP check with replay protection (a code can be used only once). */
async function checkTotp(user: UserAuthRow, token: string | undefined): Promise<boolean> {
  if (!user.mfaEnabled || !user.mfaSecretEnc || !token) return false;
  let secret: string;
  try {
    secret = decrypt(user.mfaSecretEnc);
  } catch {
    return false;
  }
  if (!authenticator.check(token, secret)) return false;
  const fresh = await redis.set(`totp:used:${user.id}:${token}`, '1', 'EX', 120, 'NX');
  return fresh === 'OK';
}

function publicUser(u: { id: string; role: string; fullName: string; preferredLanguage: string }) {
  return { id: u.id, role: u.role, fullName: u.fullName, language: u.preferredLanguage };
}

export const authService = {
  async registerPatient(req: Request, res: Response, body: z.infer<typeof patientRegisterBody>) {
    const passwordHash = await hashPassword(body.password);
    try {
      const userId = await withTransaction(async (db) => {
        if (await userRepo.existsByIdentifiers(null, body.mobile, db)) {
          throw conflict('REGISTRATION_FAILED', 'We could not create an account with these details.');
        }
        const id = await userRepo.create(db, {
          role: 'PATIENT',
          email: null,
          mobile: body.mobile,
          passwordHash,
          fullName: body.fullName,
          language: body.preferredLanguage,
        });
        await patientRepo.create(db, {
          userId: id,
          patientCode: `RHC-${randomCode(8)}`,
          dateOfBirth: body.dateOfBirth,
          gender: body.gender ?? null,
          village: body.village,
          emergencyContactName: body.emergencyContactName,
          emergencyContactPhone: body.emergencyContactPhone ?? null,
        });
        await sessionService.create(req, res, { id, role: 'PATIENT' }, { mfaVerified: false }, db);
        return id;
      });
      await audit(req, { action: 'PATIENT_REGISTERED', result: 'SUCCESS', actorId: userId, actorRole: 'PATIENT', resourceType: 'user', resourceId: userId });
      return { id: userId, role: 'PATIENT', fullName: body.fullName, language: body.preferredLanguage };
    } catch (err) {
      if (pgCode(err) === PG.UNIQUE_VIOLATION) {
        throw conflict('REGISTRATION_FAILED', 'We could not create an account with these details.');
      }
      throw err;
    }
  },

  /** Doctors start as PENDING and have no clinical access until an admin verifies them. */
  async registerDoctor(req: Request, body: z.infer<typeof doctorRegisterBody>) {
    const passwordHash = await hashPassword(body.password);
    try {
      const userId = await withTransaction(async (db) => {
        if (
          (await userRepo.existsByIdentifiers(body.email, body.mobile ?? null, db)) ||
          (await doctorRepo.registrationExists(body.registrationNumber, db))
        ) {
          throw conflict('REGISTRATION_FAILED', 'We could not create an account with these details.');
        }
        const id = await userRepo.create(db, {
          role: 'DOCTOR',
          email: body.email,
          mobile: body.mobile ?? null,
          passwordHash,
          fullName: body.fullName,
          language: 'en',
        });
        await doctorRepo.create(db, {
          userId: id,
          registrationNumber: body.registrationNumber,
          specialization: body.specialization,
          qualification: body.qualification,
          facilityId: body.facilityId ?? null,
        });
        return id;
      });
      await audit(req, { action: 'DOCTOR_REGISTERED', result: 'SUCCESS', actorId: userId, actorRole: 'DOCTOR', resourceType: 'doctor', resourceId: userId });
      return { status: 'PENDING_VERIFICATION' };
    } catch (err) {
      if (pgCode(err) === PG.UNIQUE_VIOLATION || pgCode(err) === PG.FOREIGN_KEY_VIOLATION) {
        throw conflict('REGISTRATION_FAILED', 'We could not create an account with these details.');
      }
      throw err;
    }
  },

  async login(req: Request, res: Response, portal: Portal, identifier: string, password: string, totp?: string) {
    const user = await findForPortal(portal, identifier);
    const locked = Boolean(user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
    const passwordOk = await verifyPassword(user?.passwordHash ?? null, password);

    if (!user) {
      await audit(req, { action: 'LOGIN_FAILED', result: 'FAILURE', actorId: null, actorRole: null, metadata: { portal, reason: 'unknown_identifier' } });
      throw INVALID_LOGIN();
    }
    const fail = async (reason: string) => {
      if (reason === 'bad_password' || reason === 'bad_totp') {
        await userRepo.recordFailedLogin(user.id, LOCKOUT.maxAttempts, LOCKOUT.minutes);
      }
      await audit(req, { action: 'LOGIN_FAILED', result: 'FAILURE', actorId: user.id, actorRole: user.role, resourceType: 'user', resourceId: user.id, metadata: { portal, reason } });
      return INVALID_LOGIN();
    };

    if (locked) throw await fail('locked');
    if (!passwordOk) throw await fail('bad_password');
    if (user.status !== 'ACTIVE') throw await fail('disabled');

    let mfaVerified = false;
    if (user.role === 'ADMIN') {
      if (!user.mfaEnabled) throw await fail('mfa_not_enrolled');
      if (!(await checkTotp(user, totp))) throw await fail('bad_totp');
      mfaVerified = true;
    }

    await userRepo.resetFailedLogins(user.id);
    await sessionService.create(req, res, { id: user.id, role: user.role }, { mfaVerified });
    await audit(req, { action: 'LOGIN', result: 'SUCCESS', actorId: user.id, actorRole: user.role, resourceType: 'user', resourceId: user.id, metadata: { portal } });
    return publicUser(user);
  },

  async logout(req: Request, res: Response) {
    if (req.auth) {
      await sessionRepo.revoke(req.auth.sessionId, req.auth.userId);
      await audit(req, { action: 'LOGOUT', result: 'SUCCESS' });
    }
    sessionService.clearCookies(res);
  },

  /**
   * Always responds identically, whether or not the account exists (no enumeration).
   * Admin accounts cannot self-reset: an existing admin (or the CLI) must reset them.
   */
  async requestPasswordReset(req: Request, portal: 'patient' | 'doctor', identifier: string) {
    const user = await findForPortal(portal, identifier);
    if (user && user.status === 'ACTIVE') {
      const code = randomNumericCode(6);
      await redis
        .multi()
        .set(`pwreset:${user.id}`, hmac(code), 'EX', PASSWORD_RESET.ttlSeconds)
        .del(`pwreset:attempts:${user.id}`)
        .exec();
      await messagingService.sendOneTimeCode({ email: user.email, mobile: user.mobile }, code);
      await audit(req, { action: 'PASSWORD_RESET_REQUESTED', result: 'SUCCESS', actorId: null, actorRole: null, resourceType: 'user', resourceId: user.id });
    } else {
      await audit(req, { action: 'PASSWORD_RESET_REQUESTED', result: 'FAILURE', actorId: null, actorRole: null, metadata: { portal } });
    }
  },

  async confirmPasswordReset(req: Request, portal: 'patient' | 'doctor', identifier: string, code: string, newPassword: string) {
    const invalid = () => badRequest('INVALID_OR_EXPIRED_CODE', 'The code is wrong or has expired.');
    const user = await findForPortal(portal, identifier);
    if (!user) throw invalid();
    const min = PASSWORD_MIN[user.role];
    if (newPassword.length < min || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw badRequest('WEAK_PASSWORD', `Password must be at least ${min} characters with letters and numbers.`);
    }
    const attempts = await redis.incr(`pwreset:attempts:${user.id}`);
    await redis.expire(`pwreset:attempts:${user.id}`, PASSWORD_RESET.ttlSeconds);
    const stored = await redis.get(`pwreset:${user.id}`);
    if (!stored || attempts > PASSWORD_RESET.maxAttempts || !safeEqual(stored, hmac(code))) {
      if (attempts > PASSWORD_RESET.maxAttempts) await redis.del(`pwreset:${user.id}`);
      await audit(req, { action: 'PASSWORD_RESET', result: 'FAILURE', actorId: null, actorRole: null, resourceType: 'user', resourceId: user.id });
      throw invalid();
    }
    const hash = await hashPassword(newPassword);
    await withTransaction(async (db) => {
      await userRepo.updatePassword(user.id, hash, db);
      await sessionRepo.revokeAllForUser(user.id, null, db);
      await notificationService.notify(user.id, 'security.password_changed', {}, null, db);
    });
    await redis.del(`pwreset:${user.id}`, `pwreset:attempts:${user.id}`);
    await audit(req, { action: 'PASSWORD_RESET', result: 'SUCCESS', actorId: user.id, actorRole: user.role, resourceType: 'user', resourceId: user.id });
  },

  /** Re-authentication for sensitive actions (admins must also present a TOTP code). */
  async reauth(req: Request, password: string, totp?: string) {
    const auth = req.auth!;
    const user = await userRepo.findById(auth.userId);
    if (!user) throw unauthorized();
    const ok = (await verifyPassword(user.passwordHash, password)) && (user.role !== 'ADMIN' || (await checkTotp(user, totp)));
    if (!ok) {
      await userRepo.recordFailedLogin(user.id, LOCKOUT.maxAttempts, LOCKOUT.minutes);
      await audit(req, { action: 'REAUTH', result: 'FAILURE' });
      throw forbidden('REAUTH_FAILED', 'The details are not correct.');
    }
    await sessionRepo.setReauth(auth.sessionId);
    await audit(req, { action: 'REAUTH', result: 'SUCCESS' });
  },

  /** Used by doctors to "sign" a prescription. */
  async verifyOwnPassword(userId: string, password: string): Promise<boolean> {
    const user = await userRepo.findById(userId);
    return verifyPassword(user?.passwordHash ?? null, password);
  },
};
