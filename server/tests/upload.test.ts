import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db/pool';
import { redis } from '../src/redis/client';
import { detectAllowedType } from '../src/security/fileSignature';
import { app, confirmedAppointment, ORIGIN, registerDoctor, registerPatient, resetDb, type Client } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);

function upload(c: Client, url: string, file: Buffer, filename: string, contentType: string) {
  const cookie = Object.entries(c.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return request(app)
    .post(url)
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', decodeURIComponent(c.cookies.rhc_csrf))
    .field('title', 'Blood test')
    .attach('file', file, { filename, contentType });
}

beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await redis.quit();
});

describe('File signature detection (unit)', () => {
  it('accepts only allowlisted types whose magic bytes match', () => {
    expect(detectAllowedType(PNG, 'scan.png', 'image/png')).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectAllowedType(EXE, 'report.pdf', 'application/pdf')).toBeNull();
    expect(detectAllowedType(PNG, 'scan.png', 'application/pdf')).toBeNull();
    expect(detectAllowedType(PNG, 'scan.svg', 'image/svg+xml')).toBeNull();
    expect(detectAllowedType(PNG, '../../etc/passwd', 'image/png')).toBeNull();
  });
});

describe('Report uploads', () => {
  it('rejects an executable disguised as a PDF', async () => {
    const p = await registerPatient();
    const res = await upload(p.client, '/api/patient/reports', EXE, 'report.pdf', 'application/pdf');
    expect(res.status).toBe(422);
  });

  it('stores a valid image under a random name and never exposes the path', async () => {
    const p = await registerPatient();
    const res = await upload(p.client, '/api/patient/reports', PNG, '../../evil.png', 'image/png');
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/evil|storage|\/var|uploads/);
    const { rows } = await pool.query(`SELECT storage_key FROM medical_reports`);
    expect(rows[0].storage_key).toMatch(/^[0-9a-f-]{36}\.png$/);

    const file = await p.client.get(`/api/patient/reports/${res.body.report.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers['cache-control']).toMatch(/no-store/);
    expect(file.headers['content-type']).toBe('image/png');
  });

  it("other patients and unassigned doctors cannot fetch a patient's report", async () => {
    const a = await registerPatient('A');
    const b = await registerPatient('B');
    const up = await upload(a.client, '/api/patient/reports', PNG, 'x.png', 'image/png');
    expect((await b.client.get(`/api/patient/reports/${up.body.report.id}/file`)).status).toBe(404);
    const stranger = await registerDoctor();
    expect((await stranger.client.get(`/api/doctor/reports/${up.body.report.id}/file`)).status).toBe(404);
    const treating = await registerDoctor();
    await confirmedAppointment(a.client, treating);
    expect((await treating.client.get(`/api/doctor/reports/${up.body.report.id}/file`)).status).toBe(200);
  });
});
