import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { allowedOrigins } from '../config/env';
import { forbidden } from '../utils/httpError';

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/** API responses may contain medical data: never cache them anywhere. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

export const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth against CSRF (on top of SameSite=Strict cookies and the CSRF token):
 * reject state-changing requests coming from an origin that is not allowlisted.
 */
export const originCheck: RequestHandler = (req, _res, next) => {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !allowedOrigins.includes(origin)) return next(forbidden('ORIGIN_NOT_ALLOWED'));
  const site = req.get('sec-fetch-site');
  if (site && site === 'cross-site') return next(forbidden('ORIGIN_NOT_ALLOWED'));
  return next();
};
