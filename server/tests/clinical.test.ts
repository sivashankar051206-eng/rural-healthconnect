import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { redis } from '../src/redis/client';
import { confirmedAppointment, localDate, openAvailability, registerDoctor, registerPatient, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await redis.quit();
});

describe('Appointments', () => {
  it('lists slots, books, and removes the booked slot', async () => {
    const p = await registerPatient();
    const d = await registerDoctor();
    await openAvailability(d.client);
    const date = localDate(2);
    const slots = await p.client.get(`/api/patient/doctors/${d.id}/slots?date=${date}`);
    expect(slots.status).toBe(200);
    expect(slots.body.slots.length).toBe(48);
    const res = await p.client.post('/api/patient/appointments', { doctorId: d.id, startsAt: slots.body.slots[3].startsAt, mode: 'AUDIO' });
    expect(res.status).toBe(201);
    expect(res.body.appointment.status).toBe('SCHEDULED');
    const after = await p.client.get(`/api/patient/doctors/${d.id}/slots?date=${date}`);
    expect(after.body.slots.length).toBe(47);
  });

  it('prevents double booking under concurrent requests (exactly one wins)', async () => {
    const d = await registerDoctor();
    await openAvailability(d.client);
    const patients = await Promise.all([1, 2, 3, 4, 5].map((i) => registerPatient(`P${i}`)));
    const slots = await patients[0].client.get(`/api/patient/doctors/${d.id}/slots?date=${localDate(1)}`);
    const startsAt = slots.body.slots[0].startsAt;
    const results = await Promise.all(
      patients.map((p) => p.client.post('/api/patient/appointments', { doctorId: d.id, startsAt, mode: 'CHAT' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1`, [d.id]);
    expect(rows[0].n).toBe(1);
  });

  it('rejects slots outside availability and the past', async () => {
    const p = await registerPatient();
    const d = await registerDoctor();
    await openAvailability(d.client);
    const odd = await p.client.post('/api/patient/appointments', { doctorId: d.id, startsAt: `${localDate(1)}T08:07:00+05:30`, mode: 'CHAT' });
    expect(odd.status).toBe(409);
    const past = await p.client.post('/api/patient/appointments', { doctorId: d.id, startsAt: '2020-01-01T10:00:00+05:30', mode: 'CHAT' });
    expect(past.status).toBe(400);
  });

  it('idempotency key prevents duplicate bookings on retries (weak network)', async () => {
    const p = await registerPatient();
    const d = await registerDoctor();
    await openAvailability(d.client);
    const slots = await p.client.get(`/api/patient/doctors/${d.id}/slots?date=${localDate(1)}`);
    const body = { doctorId: d.id, startsAt: slots.body.slots[1].startsAt, mode: 'CHAT' };
    const first = await p.client.post('/api/patient/appointments', body, { 'Idempotency-Key': 'retry-key-0001' });
    const second = await p.client.post('/api/patient/appointments', body, { 'Idempotency-Key': 'retry-key-0001' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.appointment.id).toBe(first.body.appointment.id);
  });

  it('patient cannot cancel someone else’s appointment', async () => {
    const a = await registerPatient('A');
    const b = await registerPatient('B');
    const d = await registerDoctor();
    const id = await confirmedAppointment(a.client, d);
    expect((await b.client.post(`/api/patient/appointments/${id}/cancel`, {})).status).toBe(404);
    expect((await a.client.post(`/api/patient/appointments/${id}/cancel`, {})).status).toBe(200);
  });

  it('pending doctors are not bookable', async () => {
    const p = await registerPatient();
    const d = await registerDoctor({ verified: false });
    expect((await p.client.get(`/api/patient/doctors/${d.id}/slots?date=${localDate(1)}`)).status).toBe(404);
  });
});

describe('Prescriptions', () => {
  async function setup() {
    const p = await registerPatient('Rx Patient');
    const d = await registerDoctor();
    await confirmedAppointment(p.client, d);
    const draft = await d.client.post('/api/doctor/prescriptions', {
      patientId: p.id,
      notes: 'After food',
      items: [{ medicineName: 'Amoxicillin 500mg', dosage: '1 capsule', frequency: 'Three times a day', duration: '5 days' }],
    });
    expect(draft.status).toBe(201);
    return { p, d, id: draft.body.prescription.id as string };
  }

  it('draft is invisible to the patient until signed with the doctor password', async () => {
    const { p, d, id } = await setup();
    expect((await p.client.get(`/api/patient/prescriptions/${id}`)).status).toBe(404);
    expect((await d.client.post(`/api/doctor/prescriptions/${id}/finalize`, { password: 'not-my-password' })).status).toBe(403);
    const fin = await d.client.post(`/api/doctor/prescriptions/${id}/finalize`, { password: d.password });
    expect(fin.status).toBe(200);
    expect(fin.body.prescription.status).toBe('ACTIVE');

    const view = await p.client.get(`/api/patient/prescriptions/${id}`);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toMatch(/no-store/);
    expect(view.body.prescription.watermark.patientCode).toMatch(/^RHC-/);
    expect(view.body.prescription.watermark.label).toBe('Confidential Medical Document');
    expect(JSON.stringify(view.body)).not.toMatch(/https?:\/\/|\.pdf|storage/i);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PRESCRIPTION_VIEWED' AND resource_id = $1`, [id]);
    expect(rows[0].n).toBe(1);
  });

  it('finalized prescriptions are immutable; corrections create a new version', async () => {
    const { p, d, id } = await setup();
    await d.client.post(`/api/doctor/prescriptions/${id}/finalize`, { password: d.password });
    const edit = await d.client.put(`/api/doctor/prescriptions/${id}`, { items: [{ medicineName: 'Changed', dosage: '1', frequency: '1', duration: '1' }] });
    expect(edit.status).toBe(409);

    const rev = await d.client.post(`/api/doctor/prescriptions/${id}/revise`);
    expect(rev.status).toBe(201);
    expect(rev.body.prescription.version).toBe(2);
    expect(rev.body.prescription.previousVersionId).toBe(id);
    const revId = rev.body.prescription.id;
    await d.client.put(`/api/doctor/prescriptions/${revId}`, { items: [{ medicineName: 'Amoxicillin 250mg', dosage: '1 capsule', frequency: 'Twice a day', duration: '5 days' }] });
    await d.client.post(`/api/doctor/prescriptions/${revId}/finalize`, { password: d.password });

    const list = await p.client.get('/api/patient/prescriptions');
    const statuses = Object.fromEntries(list.body.prescriptions.map((x: { id: string; status: string }) => [x.id, x.status]));
    expect(statuses[id]).toBe('SUPERSEDED');
    expect(statuses[revId]).toBe('ACTIVE');
  });

  it('patient cannot modify a prescription (403)', async () => {
    const { p, id } = await setup();
    expect((await p.client.put(`/api/doctor/prescriptions/${id}`, { items: [] })).status).toBe(403);
    expect((await p.client.post(`/api/doctor/prescriptions/${id}/finalize`, { password: 'x' })).status).toBe(403);
  });

  it('notification text contains no medicine names', async () => {
    const { p, d, id } = await setup();
    await d.client.post(`/api/doctor/prescriptions/${id}/finalize`, { password: d.password });
    const n = await p.client.get('/api/notifications');
    expect(JSON.stringify(n.body)).not.toMatch(/Amoxicillin/i);
    expect(n.body.notifications.some((x: { type: string }) => x.type === 'prescription.available')).toBe(true);
  });
});

describe('Medical records', () => {
  it('corrections keep history instead of overwriting', async () => {
    const p = await registerPatient();
    const d = await registerDoctor();
    await confirmedAppointment(p.client, d);
    const created = await d.client.post(`/api/doctor/patients/${p.id}/records`, { entryType: 'ALLERGY', title: 'Penicilin' });
    expect(created.status).toBe(201);
    const fix = await d.client.post(`/api/doctor/records/${created.body.id}/correct`, { title: 'Penicillin', reason: 'Spelling correction' });
    expect(fix.status).toBe(200);
    const chart = await d.client.get(`/api/doctor/patients/${p.id}`);
    const statuses = chart.body.records.map((r: { status: string }) => r.status).sort();
    expect(statuses).toEqual(['ACTIVE', 'CORRECTED']);
    expect(chart.body.corrections[0].reason).toBe('Spelling correction');
    const own = await p.client.get('/api/patient/records');
    expect(own.body.allergies).toHaveLength(1);
    expect(own.body.allergies[0].title).toBe('Penicillin');
  });
});
