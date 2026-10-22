import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async handler so rejected promises reach the central error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function paginate(page: number, pageSize: number) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

export function maskMobile(mobile: string | null): string | null {
  if (!mobile) return null;
  return mobile.length <= 4 ? '****' : `${'*'.repeat(mobile.length - 4)}${mobile.slice(-4)}`;
}

/** Escapes LIKE/ILIKE wildcards in user search input (the value is still passed as a parameter). */
export function likeEscape(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
