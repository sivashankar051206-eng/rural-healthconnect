import { z } from 'zod';
import { isoDate, language, mobile, optionalText, pageQuery, text } from './common';

export const patientProfileUpdate = z
  .object({
    preferredLanguage: language.optional(),
    village: optionalText(120),
    emergencyContactName: optionalText(120),
    emergencyContactPhone: mobile.nullable().optional(),
  })
  .strict();

export const doctorSearchQuery = pageQuery.extend({
  q: z.string().trim().max(80).optional(),
  specialization: z.string().trim().max(80).optional(),
});

export const slotsQuery = z.object({ date: isoDate });

export const bookBody = z.object({
  doctorId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  mode: z.enum(['VIDEO', 'AUDIO', 'CHAT']).default('VIDEO'),
  reason: optionalText(500),
});

export const appointmentListQuery = pageQuery.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});

export const cancelBody = z.object({ reason: optionalText(300) });

export const messageBody = z.object({ body: text(2000) });
export const messagesQuery = z.object({ after: z.string().datetime({ offset: true }).optional() });

export const availabilityBody = z.object({
  slots: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        slotMinutes: z.number().int().min(10).max(60).default(15),
      }),
    )
    .max(42)
    .refine((s) => s.every((x) => x.startTime < x.endTime), 'Start time must be before end time'),
});

export const doctorAppointmentsQuery = pageQuery.extend({
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED']).optional(),
  date: isoDate.optional(),
});

export const patientSearchQuery = pageQuery.extend({ q: z.string().trim().max(80).optional() });

export const recordCreateBody = z.object({
  entryType: z.enum(['ALLERGY', 'DIAGNOSIS', 'MEDICATION', 'NOTE']),
  title: text(200),
  details: optionalText(4000),
  consultationId: z.string().uuid().nullable().optional(),
  visibleToPatient: z.boolean().default(true),
});

export const recordCorrectBody = z.object({
  title: text(200).optional(),
  details: optionalText(4000),
  reason: text(500, 3),
  enteredInError: z.boolean().default(false),
});

const item = z.object({
  medicineName: text(160),
  dosage: text(80),
  frequency: text(80),
  duration: text(80),
  instructions: optionalText(300),
});

export const prescriptionCreateBody = z.object({
  patientId: z.string().uuid(),
  consultationId: z.string().uuid().nullable().optional(),
  notes: optionalText(1000),
  items: z.array(item).min(1).max(30),
});

export const prescriptionUpdateBody = z.object({
  notes: optionalText(1000),
  items: z.array(item).min(1).max(30),
});

export const prescriptionFinalizeBody = z.object({ password: z.string().min(1).max(128) });
export const prescriptionCancelBody = z.object({ reason: text(300, 3) });

export const reportUploadFields = z.object({ title: text(120) });

export const issueBody = z.object({
  category: z.enum(['TECHNICAL', 'ACCOUNT', 'APPOINTMENT', 'OTHER']),
  description: text(1000, 3),
});
