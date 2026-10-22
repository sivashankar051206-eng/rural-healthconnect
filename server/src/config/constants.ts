export const LANGUAGES = ['en', 'ta', 'hi', 'te', 'ml', 'kn'] as const;
export type Language = (typeof LANGUAGES)[number];

export const ROLES = ['ADMIN', 'DOCTOR', 'PATIENT'] as const;
export type Role = (typeof ROLES)[number];

export type Portal = 'patient' | 'doctor' | 'admin';
export const PORTAL_ROLE: Record<Portal, Role> = { patient: 'PATIENT', doctor: 'DOCTOR', admin: 'ADMIN' };

/** Session lifetimes. Admin sessions are the shortest (see spec §33). */
export const SESSION_POLICY: Record<Role, { idleMinutes: number; absoluteHours: number }> = {
  PATIENT: { idleMinutes: 60, absoluteHours: 12 },
  DOCTOR: { idleMinutes: 30, absoluteHours: 12 },
  ADMIN: { idleMinutes: 15, absoluteHours: 4 },
};

export const ADMIN_PERMISSIONS = [
  'admin.doctors.manage',
  'admin.patients.manage',
  'admin.appointments.manage',
  'admin.audit.view',
  'admin.facilities.manage',
  'admin.issues.manage',
  'admin.settings.manage',
  'admin.permissions.manage',
  'clinical.breakglass',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Appointment statuses that occupy a slot. */
export const SLOT_HOLDING_STATUSES = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;
/** Statuses that grant a doctor access to a patient's clinical record. */
export const DOCTOR_ACCESS_STATUSES = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;

export const LOCKOUT = { maxAttempts: 5, minutes: 15 } as const;
export const REAUTH_WINDOW_MINUTES = 5;
export const PASSWORD_RESET = { ttlSeconds: 600, maxAttempts: 5 } as const;

export const COOKIE = { session: 'rhc_sid', csrf: 'rhc_csrf' } as const;

export const PASSWORD_MIN = { PATIENT: 8, DOCTOR: 12, ADMIN: 14 } as const;
