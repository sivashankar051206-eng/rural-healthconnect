import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Redis is used ONLY for short-lived data: rate limits, slot caches, idempotency keys,
 * password-reset codes, TOTP replay protection and job locks.
 * It is never the source of truth for medical data.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
});

redis.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));

/** Acquire a short lock (for background jobs across multiple instances). */
export async function tryLock(key: string, ttlSeconds: number): Promise<boolean> {
  const res = await redis.set(`lock:${key}`, '1', 'EX', ttlSeconds, 'NX');
  return res === 'OK';
}
