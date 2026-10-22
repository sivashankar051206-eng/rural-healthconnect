import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from '../redis/client';

function store(prefix: string) {
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });
}

const common: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait and try again.' } });
  },
};

/** General API limit per client IP. */
export const apiLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 600, store: store('api') });

/** Login / registration / password reset: strict per-IP limit (brute force & credential stuffing). */
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 20,
  store: store('auth'),
});

/** Uploads are expensive on rural links and storage: keep them modest. */
export const uploadLimiter = rateLimit({ ...common, windowMs: 60 * 60_000, limit: 30, store: store('upload') });

/** Chat messages. */
export const messageLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 40, store: store('msg') });
