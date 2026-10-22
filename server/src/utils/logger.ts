import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured logger. Anything that could carry credentials or tokens is redacted.
 * Never log request bodies of clinical endpoints.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.token',
      '*.totp',
      '*.code',
    ],
    censor: '[REDACTED]',
  },
  base: undefined,
});
