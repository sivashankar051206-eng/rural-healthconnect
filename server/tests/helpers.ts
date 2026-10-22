import request from 'supertest';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import { redis } from '../src/redis/client';
import { encrypt } from '../src/security/crypto';
import { hashPassword } from '../src/security/password';
import { ADMIN_PERMISSIONS } from '../src/config/constants';

export const app = createApp();
export const ORIGIN = 'http://localhost:5173';

/** Resets all application data between tests (disposable test DB only). */
export async function resetDb() {
  await pool.query(`TRUNCATE audit_logs, notifications, messages, record_corrections, medical_records, medical_reports,
    prescription_items, prescriptions, consultations, appointments, doctor_availability, doctor_verifications,
    issues, sessions, user_permissions, patients, doctors, facilities, users RESTART IDENTITY CASCADE`);
  await redis.flushdb();
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Minimal cookie-aware client that also echoes the CSRF cookie like the real frontend. */
export class Client {
  cookies: Record<string, string> = {};
  csrf = true;

  private store(res: request.Response) {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of set ?? []) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(c)) delete this.cookies[name];
      else this.cookies[name] = value;
    }
  }

  async call(method: Method, url: string, body?: unknown, headers: Record<string, string> = {}) {
    let r = request(app)[method](url).set('Origin', ORIGIN);
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) r = r.set('Cookie', cookie);
    if (this.csrf && this.cookies.rhc_csrf) r = r.set('X-CSRF-Token', decodeURIComponent(this.cookies.rhc_csrf));
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    const res = body !== undefined ? await r.send(body as object) : await r;
    this.store(res);
    return res;
  }

  get(url: string) { return this.call('get', url); }
  post(url: string, body?: unknown, headers?: Record<string, string>) { return this.call('post', url, body ?? {}, headers); }
  put(url: string, body?: unknown) { return this.call('put', url, body ?? {}); }
  patch(url: string, body?: unknown) { return this.call('patch', url, body ?? {}); }
  delete(url: string) { return this.call('delete', url); }
}

let counter = 0;
const nextMobile = () => `9${String(800000000 + (counter += 1)).padStart(9, '0')}`;

export async function registerPatient(name = 'Test Patient') {
  const c = new Client();
  const mobile = nextMobile();
  const password = 'patient123';
  const res = await c.post('/api/auth/patient/register', {
    fullName: name,
    mobile,
    password,
    dateOfBirth: '1985-06-15',
    preferredLanguage: 'ta',
  });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return { client: c, id: res.body.user.id as string, mobile, password };
}

/** Registers a doctor through the API and (optionally) verifies them directly in the DB. */
export async function registerDoctor(opts: { verified?: boolean; name?: string } = {}) {
  const c = new Client();
  const n = (counter += 1);
  const email = `doctor${n}@example.test`;
  const password = 'doctorpass1234';
  const res = await c.post('/api/auth/doctor/register', {
    fullName: opts.name ?? `Dr Test ${n}`,
    email,
    password,
    registrationNumber: `TN-${100000 + n}`,
    specialization: 'General Medicine',
    qualification: 'MBBS',
  });
  if (res.status !== 201) throw new Error(`doctor register failed ${res.status} ${JSON.stringify(res.body)}`);
  const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  const id = rows[0].id as string;
  if (opts.verified !== false) {
    await pool.query(`UPDATE doctors SET verification_status = 'VERIFIED', is_active = TRUE WHERE user_id = $1`, [id]);
  }
  const login = await c.post('/api/auth/doctor/login', { identifier: email, password });
  if (login.status !== 200) throw new Error('doctor login failed');
  return { client: c, id, email, password };
}

export async function createAdmin(permissions: string[] = ADMIN_PERMISSIONS.filter((p) => p !== 'clinical.breakglass')) {
  const n = (counter += 1);
  const email = `admin${n}@example.test`;
  const password = 'Admin-password-123!';
  const secret = authenticator.generateSecret(20);
  const { rows } = await pool.query(
    `INSERT INTO users (role, email, password_hash, full_name, mfa_enabled, mfa_secret_enc)
     VALUES ('ADMIN', $1, $2, 'Test Admin', TRUE, $3) RETURNING id`,
    [email, await hashPassword(password), encrypt(secret)],
  );
  const id = rows[0].id as string;
  for (const p of permissions) await pool.query(`INSERT INTO user_permissions (user_id, permission_code) VALUES ($1, $2)`, [id, p]);
  const c = new Client();
  const res = await c.post('/api/auth/admin/login', { identifier: email, password, totp: authenticator.generate(secret) });
  if (res.status !== 200) throw new Error(`admin login failed ${res.status}`);
  return { client: c, id, email, password, secret };
}

/** Local date (Asia/Kolkata) N days from now, YYYY-MM-DD. */
export function localDate(daysAhead: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + daysAhead * 86_400_000));
}

/** Opens the doctor's whole week so tests always find slots. */
export async function openAvailability(doctor: Client) {
  const slots = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '20:00', slotMinutes: 15 }));
  const r = await doctor.put('/api/doctor/availability', { slots });
  if (r.status !== 200) throw new Error(`availability failed ${r.status} ${JSON.stringify(r.body)}`);
}

/** Books tomorrow's first slot and has the doctor confirm it -> doctor gains access to the patient. */
export async function confirmedAppointment(patient: Client, doctor: { client: Client; id: string }) {
  await openAvailability(doctor.client);
  const slots = await patient.get(`/api/patient/doctors/${doctor.id}/slots?date=${localDate(1)}`);
  const booked = await patient.post('/api/patient/appointments', { doctorId: doctor.id, startsAt: slots.body.slots[0].startsAt, mode: 'CHAT' });
  if (booked.status !== 201) throw new Error(`booking failed ${booked.status} ${JSON.stringify(booked.body)}`);
  const accepted = await doctor.client.post(`/api/doctor/appointments/${booked.body.appointment.id}/accept`);
  if (accepted.status !== 200) throw new Error('accept failed');
  return booked.body.appointment.id as string;
}
