import crypto from 'node:crypto';
import { env } from '../config/env';

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/** Keyed hash for tokens stored server-side (session tokens, CSRF tokens, reset codes). */
export const hmac = (value: string): string =>
  crypto.createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex');

export const sha256 = (data: Buffer | string): string => crypto.createHash('sha256').update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function randomNumericCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += crypto.randomInt(0, 10).toString();
  return out;
}

const RANDOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += RANDOM_ALPHABET[crypto.randomInt(0, RANDOM_ALPHABET.length)];
  return out;
}

const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');

/** AES-256-GCM application-level encryption for small secrets (e.g. TOTP seeds). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('Unsupported ciphertext format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
