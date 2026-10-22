import { z } from 'zod';
import { LANGUAGES } from '../config/constants';

/** Strips control characters and trims. Output encoding is done by React on the client. */
export const text = (max: number, min = 1) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().min(min).max(max));

export const optionalText = (max: number) =>
  z
    .union([text(max, 0), z.null()])
    .optional()
    .transform((v) => (v ? v : null));

/** Indian-style mobile normalization: 10 digits => +91 prefix. */
export const mobile = z
  .string()
  .transform((s) => s.replace(/[\s\-()]/g, ''))
  .transform((s) => (/^[6-9]\d{9}$/.test(s) ? `+91${s}` : s.startsWith('00') ? `+${s.slice(2)}` : s))
  .pipe(z.string().regex(/^\+[0-9]{10,15}$/, 'Enter a valid mobile number'));

export const email = z.string().trim().toLowerCase().email().max(254);

export const language = z.enum(LANGUAGES);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const password = (min: number) =>
  z
    .string()
    .min(min, `Password must be at least ${min} characters`)
    .max(128)
    .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and numbers');
