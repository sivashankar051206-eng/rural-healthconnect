import type { Request } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env';
import { PG, pgCode, pgConstraint, withTransaction } from '../db/pool';
import { redis } from '../redis/client';
import { audit } from '../audit/audit';
import { appointmentRepo, type AppointmentRow } from '../repositories/appointmentRepo';
import { doctorRepo } from '../repositories/doctorRepo';
import { notificationService } from './notificationService';
import { settingsService } from './settingsService';
import { badRequest, conflict, notFound, unprocessable } from '../utils/httpError';
import { denyNotFound } from '../security/access';

const SLOT_CACHE_TTL = 30;
const slotKey = (doctorId: string, date: string) => `slots:${doctorId}:${date}`;

function localDate(d: Date): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** What a patient may see about an appointment. */
function forPatient(a: AppointmentRow) {
  return {
    id: a.id,
    doctorId: a.doctorId,
    doctorName: a.doctorName,
    specialization: a.specialization,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    mode: a.mode,
    status: a.status,
    consultationId: a.consultationId,
  };
}

/** What a doctor may see (doctor is a party to the appointment). */
function forDoctor(a: AppointmentRow) {
  return { ...forPatient(a), patientId: a.patientId, patientName: a.patientName, patientCode: a.patientCode, reason: a.reason };
}

async function invalidateSlots(doctorId: string, startsAt: Date) {
  await redis.del(slotKey(doctorId, localDate(startsAt))).catch(() => undefined);
}

export const appointmentService = {
  async slots(doctorId: string, date: string) {
    if (!(await doctorRepo.isBookable(doctorId))) throw notFound('DOCTOR_NOT_FOUND');
    const maxDays = await settingsService.number('max_booking_days_ahead');
    const target = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(target) || target > Date.now() + (maxDays + 1) * 86_400_000) return [];

    const cached = await redis.get(slotKey(doctorId, date)).catch(() => null);
    if (cached) return JSON.parse(cached) as { startsAt: string; endsAt: string }[];
    const slots = (await appointmentRepo.freeSlots(doctorId, date, env.APP_TIMEZONE)).map((s) => ({
      startsAt: new Date(s.startsAt).toISOString(),
      endsAt: new Date(s.endsAt).toISOString(),
    }));
    // Non-sensitive availability data; short TTL. The DB constraint remains the real guard.
    await redis.set(slotKey(doctorId, date), JSON.stringify(slots), 'EX', SLOT_CACHE_TTL).catch(() => undefined);
    return slots;
  },

  /**
   * Books a slot. Protection against double booking is layered:
   * 1) idempotency key (duplicate taps / retries on weak networks),
   * 2) row lock on the doctor + re-validation of the slot inside the transaction,
   * 3) PostgreSQL exclusion constraints (final, race-proof guarantee).
   */
  async book(
    req: Request,
    body: { doctorId: string; startsAt: string; mode: string; reason: string | null },
    idempotencyKey: string | undefined,
  ) {
    const patientId = req.auth!.userId;
    const idemKey = idempotencyKey && /^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey) ? `idem:book:${patientId}:${idempotencyKey}` : null;
    if (idemKey) {
      const reserved = await redis.set(idemKey, 'PENDING', 'EX', 600, 'NX');
      if (reserved !== 'OK') {
        const prev = await redis.get(idemKey);
        if (prev && prev !== 'PENDING') {
          const existing = await appointmentRepo.byId(prev);
          if (existing && existing.patientId === patientId) return forPatient(existing);
        }
        throw conflict('REQUEST_IN_PROGRESS', 'Your booking is already being processed.');
      }
    }

    const startsAt = new Date(body.startsAt);
    try {
      const maxDays = await settingsService.number('max_booking_days_ahead');
      if (startsAt.getTime() <= Date.now()) throw badRequest('SLOT_IN_PAST', 'Please choose a future time.');
      if (startsAt.getTime() > Date.now() + maxDays * 86_400_000) throw badRequest('SLOT_TOO_FAR', 'Please choose an earlier date.');

      const id = await withTransaction(async (db) => {
        if (!(await doctorRepo.isBookable(body.doctorId, db))) throw notFound('DOCTOR_NOT_FOUND');
        await doctorRepo.lockForBooking(body.doctorId, db);
        const free = await appointmentRepo.freeSlots(body.doctorId, localDate(startsAt), env.APP_TIMEZONE, db);
        const slot = free.find((s) => new Date(s.startsAt).getTime() === startsAt.getTime());
        if (!slot) throw conflict('SLOT_UNAVAILABLE', 'This time is no longer available.');
        const newId = await appointmentRepo.insert(db, {
          patientId,
          doctorId: body.doctorId,
          startsAt,
          endsAt: new Date(slot.endsAt),
          mode: body.mode,
          reason: body.reason,
        });
        const when = startsAt.toISOString();
        await notificationService.notify(patientId, 'appointment.requested', { when }, '/patient/appointments', db);
        await notificationService.notify(body.doctorId, 'appointment.new_request', { when }, '/doctor/appointments', db);
        return newId;
      });

      if (idemKey) await redis.set(idemKey, id, 'EX', 600);
      await invalidateSlots(body.doctorId, startsAt);
      await audit(req, { action: 'APPOINTMENT_CREATED', result: 'SUCCESS', resourceType: 'appointment', resourceId: id, metadata: { doctorId: body.doctorId } });
      return forPatient((await appointmentRepo.byId(id))!);
    } catch (err) {
      if (idemKey) await redis.del(idemKey);
      if (pgCode(err) === PG.EXCLUSION_VIOLATION) {
        const patientClash = pgConstraint(err) === 'appointments_no_patient_overlap';
        await audit(req, { action: 'APPOINTMENT_CREATED', result: 'FAILURE', metadata: { reason: patientClash ? 'patient_overlap' : 'slot_taken' } });
        throw conflict(
          patientClash ? 'PATIENT_BUSY' : 'SLOT_UNAVAILABLE',
          patientClash ? 'You already have an appointment at this time.' : 'This time is no longer available.',
        );
      }
      throw err;
    }
  },

  async listForPatient(patientId: string, scope: 'upcoming' | 'past', limit: number, offset: number) {
    return (await appointmentRepo.forPatient(patientId, scope, limit, offset)).map(forPatient);
  },

  async listForDoctor(doctorId: string, status: string | undefined, date: string | undefined, limit: number, offset: number) {
    return (await appointmentRepo.forDoctor(doctorId, status, date, env.APP_TIMEZONE, limit, offset)).map(forDoctor);
  },

  async cancelByPatient(req: Request, id: string, reason: string | null) {
    const patientId = req.auth!.userId;
    const appt = await appointmentRepo.byId(id);
    if (!appt || appt.patientId !== patientId) return denyNotFound(req, 'appointment', id);
    const windowHours = await settingsService.number('cancellation_window_hours');
    if (new Date(appt.startsAt).getTime() - Date.now() < windowHours * 3_600_000) {
      throw unprocessable('TOO_LATE_TO_CANCEL', 'It is too late to cancel this appointment.');
    }
    const ok = await withTransaction(async (db) => {
      const done = await appointmentRepo.transition(db, id, { patientId }, ['SCHEDULED', 'CONFIRMED'], 'CANCELLED', {
        cancelledBy: patientId,
        cancelReason: reason,
      });
      if (done) {
        await notificationService.notify(appt.doctorId, 'appointment.cancelled', { when: new Date(appt.startsAt).toISOString() }, '/doctor/appointments', db);
      }
      return done;
    });
    if (!ok) throw conflict('INVALID_STATE', 'This appointment cannot be cancelled.');
    await invalidateSlots(appt.doctorId, new Date(appt.startsAt));
    await audit(req, { action: 'APPOINTMENT_CANCELLED', result: 'SUCCESS', resourceType: 'appointment', resourceId: id });
  },

  /** Doctor accept / reject / cancel. */
  async doctorDecision(req: Request, id: string, decision: 'accept' | 'reject' | 'cancel', reason: string | null = null) {
    const doctorId = req.auth!.userId;
    const appt = await appointmentRepo.byId(id);
    if (!appt || appt.doctorId !== doctorId) return denyNotFound(req, 'appointment', id);
    const plan = {
      accept: { from: ['SCHEDULED'], to: 'CONFIRMED', note: 'appointment.confirmed', action: 'APPOINTMENT_CONFIRMED' },
      reject: { from: ['SCHEDULED'], to: 'REJECTED', note: 'appointment.rejected', action: 'APPOINTMENT_REJECTED' },
      cancel: { from: ['SCHEDULED', 'CONFIRMED'], to: 'CANCELLED', note: 'appointment.cancelled', action: 'APPOINTMENT_CANCELLED' },
    }[decision];
    const ok = await withTransaction(async (db) => {
      const done = await appointmentRepo.transition(db, id, { doctorId }, plan.from, plan.to, {
        cancelledBy: decision === 'accept' ? undefined : doctorId,
        cancelReason: reason,
      });
      if (done) {
        await notificationService.notify(
          appt.patientId,
          plan.note as 'appointment.confirmed',
          { when: new Date(appt.startsAt).toISOString(), doctor: appt.doctorName },
          '/patient/appointments',
          db,
        );
      }
      return done;
    });
    if (!ok) throw conflict('INVALID_STATE', 'This appointment cannot be changed now.');
    if (decision !== 'accept') await invalidateSlots(doctorId, new Date(appt.startsAt));
    await audit(req, { action: plan.action, result: 'SUCCESS', resourceType: 'appointment', resourceId: id });
    return forDoctor((await appointmentRepo.byId(id))!);
  },

  forPatientView: forPatient,
  forDoctorView: forDoctor,
  newRoomToken: () => crypto.randomBytes(24).toString('base64url'),
};
