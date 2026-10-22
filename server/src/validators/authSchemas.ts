import { z } from 'zod';
import { PASSWORD_MIN } from '../config/constants';
import { email, isoDate, language, mobile, optionalText, password, text } from './common';

export const portalParam = z.object({ portal: z.enum(['patient', 'doctor', 'admin']) });
export const resetPortalParam = z.object({ portal: z.enum(['patient', 'doctor']) });

export const loginBody = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const patientRegisterBody = z.object({
  fullName: text(120),
  mobile,
  password: password(PASSWORD_MIN.PATIENT),
  dateOfBirth: isoDate.refine((d) => {
    const t = Date.parse(d);
    return !Number.isNaN(t) && t < Date.now() && t > Date.parse('1900-01-01');
  }, 'Enter a valid date of birth'),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER']).nullable().optional(),
  village: optionalText(120),
  preferredLanguage: language,
  emergencyContactName: optionalText(120),
  emergencyContactPhone: mobile.nullable().optional(),
});

export const doctorRegisterBody = z.object({
  fullName: text(120),
  email,
  mobile: mobile.nullable().optional(),
  password: password(PASSWORD_MIN.DOCTOR),
  registrationNumber: text(40, 3),
  specialization: text(80, 2),
  qualification: text(120, 2),
  facilityId: z.string().uuid().nullable().optional(),
});

export const resetRequestBody = z.object({ identifier: z.string().trim().min(3).max(254) });

export const resetConfirmBody = z.object({
  identifier: z.string().trim().min(3).max(254),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(128),
});

export const reauthBody = z.object({
  password: z.string().min(1).max(128),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const sessionIdParam = z.object({ id: z.string().uuid() });
