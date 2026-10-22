import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { redis } from '../src/redis/client';
import { app, Client, createAdmin, registerPatient, resetDb, ORIGIN } from './helpers';
import request from 'supertest';

beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await redis.quit();
});

describe('Authentication', () => {
  it('registers a patient, sets HttpOnly SameSite=Strict session cookie, never returns secrets', async () => {
    const c = new Client();
    const res = await c.post('/api/auth/patient/register', {
      fullName: 'Lakshmi',
      mobile: '9876543210',
      password: 'village123',
      dateOfBirth: '1970-01-01',
      preferredLanguage: 'ta',
    });
    expect(res.status).toBe(201);
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toMatch(/rhc_sid=[^;]+;.*HttpOnly/);
    expect(cookies).toMatch(/SameSite=Strict/);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|token/i);

    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE mobile = '+919876543210'`);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('uses the same generic error for wrong password and unknown account', async () => {
    const p = await registerPatient();
    const wrong = await new Client().post('/api/auth/patient/login', { identifier: p.mobile, password: 'wrongpass1' });
    const unknown = await new Client().post('/api/auth/patient/login', { identifier: '9123456789', password: 'wrongpass1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
  });

  it('locks the account after repeated failures, even with the right password', async () => {
    const p = await registerPatient();
    for (let i = 0; i < 5; i += 1) {
      await new Client().post('/api/auth/patient/login', { identifier: p.mobile, password: 'wrongpass1' });
    }
    const res = await new Client().post('/api/auth/patient/login', { identifier: p.mobile, password: p.password });
    expect(res.status).toBe(401);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'LOGIN_FAILED'`);
    expect(rows[0].n).toBeGreaterThanOrEqual(6);
  });

  it('a patient cannot log in through the doctor or admin portal', async () => {
    const p = await registerPatient();
    const res = await new Client().post('/api/auth/doctor/login', { identifier: p.mobile, password: p.password });
    expect(res.status).toBe(401);
  });

  it('logout invalidates the session server-side', async () => {
    const p = await registerPatient();
    const stolen = { ...p.client.cookies };
    expect((await p.client.post('/api/auth/logout')).status).toBe(204);
    const replay = new Client();
    replay.cookies = stolen;
    expect((await replay.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const p = await registerPatient();
    p.client.csrf = false;
    const res = await p.client.patch('/api/patient/profile', { village: 'Kovilpatti' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects state-changing requests from a foreign origin', async () => {
    const res = await request(app).post('/api/auth/patient/login').set('Origin', 'https://evil.example').send({ identifier: 'x', password: 'y' });
    expect(res.status).toBe(403);
  });

  it('password reset request is identical for existing and non-existing accounts', async () => {
    const p = await registerPatient();
    const a = await new Client().post('/api/auth/patient/password-reset/request', { identifier: p.mobile });
    const b = await new Client().post('/api/auth/patient/password-reset/request', { identifier: '9000011111' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  it('admin login requires a valid TOTP code', async () => {
    const admin = await createAdmin();
    const noTotp = await new Client().post('/api/auth/admin/login', { identifier: admin.email, password: admin.password });
    expect(noTotp.status).toBe(401);
    const badTotp = await new Client().post('/api/auth/admin/login', { identifier: admin.email, password: admin.password, totp: '000000' });
    expect(badTotp.status).toBe(401);
  });

  it('users can list and revoke their sessions', async () => {
    const p = await registerPatient();
    const second = new Client();
    await second.post('/api/auth/patient/login', { identifier: p.mobile, password: p.password });
    const list = await p.client.get('/api/auth/sessions');
    expect(list.body.sessions).toHaveLength(2);
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    expect((await p.client.delete(`/api/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await second.get('/api/auth/me')).status).toBe(401);
  });
});

describe('Input validation & rate limiting', () => {
  it('rejects malformed input with 400 and field details', async () => {
    const res = await new Client().post('/api/auth/patient/register', { fullName: '', mobile: 'abc', password: '1', dateOfBirth: 'x', preferredLanguage: 'fr' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('strips unknown fields such as a client-supplied role', async () => {
    const c = new Client();
    const res = await c.post('/api/auth/patient/register', {
      fullName: 'Role Tamper',
      mobile: '9811111111',
      password: 'village123',
      dateOfBirth: '1990-01-01',
      preferredLanguage: 'en',
      role: 'ADMIN',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('PATIENT');
    expect((await c.get('/api/admin/dashboard')).status).toBe(403);
  });

  it('rate-limits repeated login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 22; i += 1) {
      last = (await request(app).post('/api/auth/patient/login').set('Origin', ORIGIN).send({ identifier: '9000000000', password: 'x' })).status;
    }
    expect(last).toBe(429);
  });

  it('does not leak internal errors', async () => {
    const res = await request(app).post('/api/auth/patient/login').set('Origin', ORIGIN).set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|stack|at /);
  });

  it('sets no-store and security headers on API responses', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
