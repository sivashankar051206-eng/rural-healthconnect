import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { PG, pgCode } from '../db/pool';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
};

/**
 * Consistent error envelope: { error: { code, message, details? } }.
 * Internal errors are logged with the request id and never exposed to clients.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      error: { code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_INVALID', message: 'This file cannot be uploaded.' },
    });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large.' } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Invalid request.' } });
    return;
  }
  if (pgCode(err) === PG.INSUFFICIENT_PRIVILEGE) {
    // A database integrity guard (e.g. immutable prescription) was hit.
    res.status(409).json({ error: { code: 'RECORD_IMMUTABLE', message: 'This record can no longer be changed.' } });
    return;
  }

  logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId: req.requestId },
  });
};
