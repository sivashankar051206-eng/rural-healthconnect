import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { withTransaction } from '../db/pool';
import { audit, auditStrict } from '../audit/audit';
import { recordRepo } from '../repositories/recordRepo';
import { assertDoctorPatientAccess, denyNotFound } from '../security/access';
import { detectAllowedType } from '../security/fileSignature';
import { scanBuffer } from '../security/malwareScan';
import { sha256 } from '../security/crypto';
import { settingsService } from './settingsService';
import { forbidden, unprocessable } from '../utils/httpError';
import { logger } from '../utils/logger';

const uploadRoot = path.resolve(env.UPLOAD_DIR);

/** Resolves a storage key to a path, refusing anything that escapes the upload root. */
function storagePath(storageKey: string): string {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(storageKey)) throw new Error('Invalid storage key');
  const full = path.resolve(uploadRoot, storageKey);
  if (path.dirname(full) !== uploadRoot) throw new Error('Path traversal blocked');
  return full;
}

export const reportService = {
  async upload(req: Request, patientId: string, file: Express.Multer.File | undefined, title: string) {
    const actor = req.auth!;
    if (actor.role === 'DOCTOR') await assertDoctorPatientAccess(req, patientId);
    else if (actor.role === 'PATIENT') {
      if (actor.userId !== patientId) throw forbidden();
      if (!(await settingsService.bool('patient_self_upload_enabled'))) throw forbidden('UPLOADS_DISABLED');
    } else throw forbidden();

    if (!file) throw unprocessable('FILE_REQUIRED', 'Please choose a file.');
    const type = detectAllowedType(file.buffer, file.originalname, file.mimetype);
    if (!type) {
      await audit(req, { action: 'REPORT_UPLOAD_REJECTED', result: 'DENIED', metadata: { reason: 'type', size: file.size } });
      throw unprocessable('FILE_TYPE_NOT_ALLOWED', 'Only PDF, JPG or PNG files are allowed.');
    }

    let scan: 'CLEAN' | 'INFECTED' | 'NOT_SCANNED';
    try {
      scan = await scanBuffer(file.buffer);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Malware scan failed');
      throw unprocessable('SCAN_UNAVAILABLE', 'The file could not be checked. Please try again later.');
    }
    if (scan === 'INFECTED') {
      await audit(req, { action: 'REPORT_UPLOAD_REJECTED', result: 'DENIED', metadata: { reason: 'malware' } });
      throw unprocessable('FILE_REJECTED', 'This file cannot be accepted.');
    }

    // Random, unpredictable name; original filename is never used on disk.
    const storageKey = `${crypto.randomUUID()}.${type.ext}`;
    const target = storagePath(storageKey);
    await fs.mkdir(uploadRoot, { recursive: true, mode: 0o700 });
    await fs.writeFile(target, file.buffer, { mode: 0o600, flag: 'wx' });

    try {
      const id = await withTransaction((db) =>
        recordRepo.insertReport(db, {
          patientId,
          title,
          storageKey,
          mimeType: type.mime,
          sizeBytes: file.size,
          sha256: sha256(file.buffer),
          scanStatus: scan,
          actorId: actor.userId,
        }),
      );
      await audit(req, { action: 'REPORT_UPLOADED', result: 'SUCCESS', resourceType: 'medical_report', resourceId: id, metadata: { patientId } });
      return { id, title, mimeType: type.mime, sizeBytes: file.size };
    } catch (err) {
      await fs.unlink(target).catch(() => undefined);
      throw err;
    }
  },

  /** Streams a report after an authorization check. No storage path or URL is ever exposed. */
  async stream(req: Request, res: Response, reportId: string) {
    const actor = req.auth!;
    const report = await recordRepo.reportFile(reportId);
    if (!report) return denyNotFound(req, 'medical_report', reportId);
    if (actor.role === 'PATIENT') {
      if (report.patientId !== actor.userId) return denyNotFound(req, 'medical_report', reportId);
    } else if (actor.role === 'DOCTOR') {
      await assertDoctorPatientAccess(req, report.patientId);
    } else {
      return denyNotFound(req, 'medical_report', reportId);
    }

    const data = await fs.readFile(storagePath(report.storageKey));
    await auditStrict(req, { action: 'REPORT_VIEWED', result: 'SUCCESS', resourceType: 'medical_report', resourceId: reportId, metadata: { patientId: report.patientId } });

    res.setHeader('Content-Type', report.mimeType);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(data);
  },
};
