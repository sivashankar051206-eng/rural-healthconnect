import type { RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { badRequest } from '../utils/httpError';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and REPLACES req.body / req.query / req.params with parsed values,
 * so unknown fields (e.g. a client-sent "role" or "userId") are stripped.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
        return next(badRequest('VALIDATION_FAILED', 'Please check the information you entered.', details));
      }
      Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    return next();
  };

export const uuidParam = (name = 'id') => z.object({ [name]: z.string().uuid() });
