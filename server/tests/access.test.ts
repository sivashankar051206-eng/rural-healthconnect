import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db/pool';
import { redis } from '../src/redis/client';
import { app, confirmedAppointment, createAdmin, registerDoctor, registerPatient, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await redis.quit();
});

describe('RBAC & resource authorization', () => {
  it('unauthenticated user cannot read medical records (401)', async () => {
    expect((await request(app).get('/api/patient/records')).status).toBe(401);
    expect((await request(app).get('/api/doctor/patients')).status).toBe(401);
  });

  it('patient cannot access the admin dashboard (403) or doctor APIs (403)', async () => {
    const p = await registerPatient();
    expect((await p.client.get('/api/admin/dashboard')).status).toBe(403);
    expect((await p.client.get('/api/doctor/dashboard')).status).toBe(403);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PERMISSION_DENIED'`);
    expect(rows[0].n).toBe(2);
  });

  it("patient cannot access another patient's prescription or report (404, audited)", async () => {
    const a = await registerPatient('A');
    const b = await registerPatient('B');
    const doctor = await registerDoctor();
    await confirmedAppointment(a.client, doctor);
    const rx = await doctor.client.post('/api/doctor/prescriptions', {
      patientId: a.id,
      items: [{ medicineName: 'Paracetamol 500mg', dosage: '1 tablet', frequency: 'Twice a day', duration: '3 days' }],
    });
    await doctor.client.post(`/api/doctor/prescriptions/${rx.body.prescription.id}/finalize`, { password: doctor.password });

    expect((await a.client.get(`/api/patient/prescriptions/${rx.body.prescription.id}`)).status).toBe(200);
    expect((await b.client.get(`/api/patient/prescriptions/${rx.body.prescription.id}`)).status).toBe(404);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PERMISSION_DENIED' AND actor_id = $1`, [b.id]);
    expect(rows[0].n).toBe(1);
  });

  it('doctor cannot access an unassigned patient (404) and cannot search them', async () => {
    const p = await registerPatient();
    const doctor = await registerDoctor();
    expect((await doctor.client.get(`/api/doctor/patients/${p.id}`)).status).toBe(404);
    const search = await doctor.client.get('/api/doctor/patients?q=Test');
    expect(search.body.patients).toHaveLength(0);
    const rx = await doctor.client.post('/api/doctor/prescriptions', {
      patientId: p.id,
      items: [{ medicineName: 'X', dosage: '1', frequency: '1', duration: '1' }],
    });
    expect(rx.status).toBe(404);
  });

  it('doctor gains access only after confirming an appointment', async () => {
    const p = await registerPatient();
    const doctor = await registerDoctor();
    await confirmedAppointment(p.client, doctor);
    const chart = await doctor.client.get(`/api/doctor/patients/${p.id}`);
    expect(chart.status).toBe(200);
    expect(JSON.stringify(chart.body)).not.toMatch(/password|storage_key|storageKey/);
  });

  it('unverified doctor has limited access', async () => {
    const doctor = await registerDoctor({ verified: false });
    expect((await doctor.client.get('/api/doctor/me')).status).toBe(200);
    expect((await doctor.client.get('/api/doctor/dashboard')).status).toBe(403);
  });

  it('admin has no clinical access without break-glass permission + re-auth', async () => {
    const p = await registerPatient();
    const admin = await createAdmin();
    // No clinical endpoints in the admin API without clinical.breakglass
    const bg = await admin.client.post(`/api/admin/break-glass/patients/${p.id}`, { reason: 'Patient support escalation request' });
    expect(bg.status).toBe(403);
    // Admin patient list is non-clinical and masks mobile numbers
    const list = await admin.client.get('/api/admin/patients');
    expect(list.status).toBe(200);
    expect(list.body.patients[0].mobile).toMatch(/^\*+\d{4}$/);
    expect(list.body.patients[0]).not.toHaveProperty('dateOfBirth');
  });

  it('break-glass works only with the permission and a recent re-auth, and is audited', async () => {
    const { authenticator } = await import('otplib');
    const p = await registerPatient();
    const admin = await createAdmin(['clinical.breakglass']);
    const before = await admin.client.post(`/api/admin/break-glass/patients/${p.id}`, { reason: 'Emergency request from district hospital' });
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('REAUTH_REQUIRED');
    // The login code was consumed (replay protection); clear it so the test can reuse the current window.
    await redis.flushdb();
    const code = authenticator.generate(admin.secret);
    const re = await admin.client.post('/api/auth/reauth', { password: admin.password, totp: code });
    expect(re.status).toBe(200);
    const res = await admin.client.post(`/api/admin/break-glass/patients/${p.id}`, { reason: 'Emergency request from district hospital' });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'BREAKGLASS_CLINICAL_ACCESS'`);
    expect(rows[0].n).toBe(1);
  });

  it('admin without a given permission is denied that area', async () => {
    const admin = await createAdmin(['admin.issues.manage']);
    expect((await admin.client.get('/api/admin/audit-logs')).status).toBe(403);
    expect((await admin.client.get('/api/admin/issues')).status).toBe(200);
  });

  it('audit logs cannot be modified, even directly in the database', async () => {
    await registerPatient();
    await expect(pool.query(`UPDATE audit_logs SET result = 'SUCCESS'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
  });
});
