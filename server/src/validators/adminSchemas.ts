import { z } from 'zod';
import { ADMIN_PERMISSIONS } from '../config/constants';
import { isoDate, optionalText, pageQuery, text } from './common';

export const adminDoctorQuery = pageQuery.extend({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
  q: z.string().trim().max(80).optional(),
});

export const doctorActionBody = z.object({
  action: z.enum(['VERIFY', 'REJECT', 'ACTIVATE', 'DEACTIVATE']),
  notes: optionalText(500),
});

export const adminPatientQuery = pageQuery.extend({ q: z.string().trim().max(80).optional() });
export const patientStatusBody = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });

export const adminAppointmentQuery = pageQuery.extend({
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export const adminCancelBody = z.object({ reason: text(300, 3) });

export const auditQuery = pageQuery.extend({
  action: z
    .string()
    .regex(/^[A-Z_]+$/)
    .optional(),
  result: z.enum(['SUCCESS', 'DENIED', 'FAILURE']).optional(),
  actorId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const facilityBody = z.object({
  name: text(160, 2),
  type: z.enum(['PHC', 'CHC', 'DISTRICT_HOSPITAL', 'PRIVATE_HOSPITAL', 'CLINIC', 'OTHER']),
  district: text(80, 2),
  state: text(80, 2),
  address: optionalText(300),
  phone: z
    .string()
    .regex(/^\+?[0-9]{6,15}$/)
    .nullable()
    .optional(),
  isActive: z.boolean().default(true),
});

export const issueUpdateBody = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']),
  adminNotes: optionalText(1000),
});
export const issueQuery = pageQuery.extend({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional() });

/** Only these settings exist; each has a strict schema. */
export const SETTINGS_SCHEMA = {
  cancellation_window_hours: z.number().int().min(0).max(72),
  max_booking_days_ahead: z.number().int().min(1).max(90),
  consultation_join_early_minutes: z.number().int().min(0).max(60),
  patient_self_upload_enabled: z.boolean(),
} as const;
export type SettingKey = keyof typeof SETTINGS_SCHEMA;

export const settingsBody = z
  .object({
    cancellation_window_hours: SETTINGS_SCHEMA.cancellation_window_hours.optional(),
    max_booking_days_ahead: SETTINGS_SCHEMA.max_booking_days_ahead.optional(),
    consultation_join_early_minutes: SETTINGS_SCHEMA.consultation_join_early_minutes.optional(),
    patient_self_upload_enabled: SETTINGS_SCHEMA.patient_self_upload_enabled.optional(),
  })
  .strict();

export const permissionsBody = z.object({
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)).max(ADMIN_PERMISSIONS.length),
});

export const breakGlassBody = z.object({ reason: text(500, 10) });
