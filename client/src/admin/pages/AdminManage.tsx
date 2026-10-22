import { useState } from 'react';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { useAdminPermissions, useReauthAction } from '../../layouts/AdminLayout';
import { Pager, StatusPill } from '../../doctor/pages/DoctorAppointments';
import { fmtDate, fmtDateTime, titleCase } from '../../utils/format';

interface DoctorRow {
  id: string;
  fullName: string;
  email: string;
  registrationNumber: string;
  specialization: string;
  qualification: string;
  facilityName: string | null;
  verificationStatus: string;
  isActive: boolean;
  createdAt: string;
}

export function AdminDoctors() {
  const [status, setStatus] = useState('PENDING');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(status ? { status } : {}), ...(q ? { q } : {}) });
  const { data, loading, error, reload } = useApi<{ doctors: DoctorRow[] }>(`/admin/doctors?${qs}`);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { busy, run } = useSubmit();

  const act = (d: DoctorRow, action: 'VERIFY' | 'REJECT' | 'ACTIVATE' | 'DEACTIVATE') =>
    void run(async () => {
      const notes = action === 'VERIFY' ? 'Registration verified' : window.prompt(`Notes for ${titleCase(action)} (${d.fullName})`) ?? null;
      if (action !== 'VERIFY' && notes === null) return;
      try {
        await api.post(`/admin/doctors/${d.id}/action`, { action, notes });
        setMsg({ kind: 'success', text: `${d.fullName}: ${titleCase(action)} done.` });
        void reload();
      } catch (e) {
        setMsg({ kind: 'error', text: errorMessage(e) });
      }
    });

  return (
    <>
      <header className="page-head">
        <h1>Doctors</h1>
        <p className="muted">Verify the medical council registration before approving. Unverified doctors have no clinical access.</p>
      </header>
      <div className="filters">
        <label>
          Verification
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label>
          Search
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name or registration no." maxLength={80} />
        </label>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.doctors.length ? (
        <Empty>No doctors match.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Registration</th>
                <th>Specialization</th>
                <th>Registered</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.doctors.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.fullName}
                    <div className="muted">{d.email}</div>
                  </td>
                  <td className="mono">{d.registrationNumber}</td>
                  <td>
                    {d.specialization}
                    <div className="muted">{d.qualification}</div>
                  </td>
                  <td>{fmtDate(d.createdAt)}</td>
                  <td>
                    <StatusPill status={d.verificationStatus} /> {d.verificationStatus === 'VERIFIED' && (d.isActive ? <span className="pill pill-COMPLETED">Active</span> : <span className="pill pill-CANCELLED">Inactive</span>)}
                  </td>
                  <td className="row-actions">
                    {d.verificationStatus === 'PENDING' && (
                      <>
                        <button className="btn btn-small btn-primary" disabled={busy} onClick={() => act(d, 'VERIFY')}>
                          Verify
                        </button>
                        <button className="btn btn-small btn-secondary" disabled={busy} onClick={() => act(d, 'REJECT')}>
                          Reject
                        </button>
                      </>
                    )}
                    {d.verificationStatus === 'VERIFIED' &&
                      (d.isActive ? (
                        <button className="btn btn-small btn-danger" disabled={busy} onClick={() => act(d, 'DEACTIVATE')}>
                          Deactivate
                        </button>
                      ) : (
                        <button className="btn btn-small btn-primary" disabled={busy} onClick={() => act(d, 'ACTIVATE')}>
                          Activate
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} hasMore={(data?.doctors.length ?? 0) === 25} />
    </>
  );
}

interface PatientRow {
  id: string;
  patientCode: string;
  fullName: string;
  mobile: string | null;
  village: string | null;
  status: string;
  createdAt: string;
}
interface BreakGlass {
  patient: { patientCode: string; fullName: string; dateOfBirth: string };
  records: { id: string; entryType: string; title: string; details: string | null; createdAt: string; createdByName: string }[];
  prescriptions: { id: string; version: number; status: string; doctorName: string; finalizedAt: string | null }[];
}

export function AdminPatients() {
  const perms = useAdminPermissions();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<{ patients: PatientRow[] }>(`/admin/patients?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [bg, setBg] = useState<{ patient: PatientRow; result: BreakGlass | null } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { exec, dialog } = useReauthAction();

  const toggle = async (p: PatientRow) => {
    try {
      await api.post(`/admin/patients/${p.id}/status`, { status: p.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
      void reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  };

  const breakGlass = (p: PatientRow) => {
    const reason = window.prompt(
      `Emergency clinical access for ${p.patientCode}.\n\nThis is strictly audited and the patient will be notified.\nEnter the justification (min 10 characters):`,
    );
    if (!reason || reason.trim().length < 10) return;
    const fn = async () => {
      const r = await api.post<BreakGlass>(`/admin/break-glass/patients/${p.id}`, { reason });
      setBg({ patient: p, result: r });
    };
    void exec(fn, 'Break-glass clinical access requires re-authentication.').catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
  };

  return (
    <>
      {dialog}
      <header className="page-head">
        <h1>Patients</h1>
        <p className="muted">Account data only. Administrators have no clinical access by default; mobile numbers are masked.</p>
      </header>
      <div className="filters">
        <label>
          Search
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name or patient ID" maxLength={80} />
        </label>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.patients.length ? (
        <Empty>No patients found.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient ID</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Village</th>
                <th>Joined</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.patients.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.patientCode}</td>
                  <td>{p.fullName}</td>
                  <td className="mono">{p.mobile}</td>
                  <td>{p.village ?? '—'}</td>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>{p.status === 'ACTIVE' ? <span className="pill pill-COMPLETED">Active</span> : <span className="pill pill-CANCELLED">Disabled</span>}</td>
                  <td className="row-actions">
                    <button className="btn btn-small btn-secondary" onClick={() => void toggle(p)}>
                      {p.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                    </button>
                    {perms.includes('clinical.breakglass') && (
                      <button className="btn btn-small btn-danger" onClick={() => breakGlass(p)}>
                        Break-glass
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} hasMore={(data?.patients.length ?? 0) === 25} />

      {bg?.result && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Emergency clinical access">
            <div className="alert alert-warning">Emergency access — this view has been recorded in the audit log and the patient has been notified.</div>
            <h2>
              {bg.result.patient.fullName} <span className="mono muted">{bg.result.patient.patientCode}</span>
            </h2>
            <h3>Active record entries</h3>
            <ul className="rec-list">
              {bg.result.records.map((r) => (
                <li key={r.id}>
                  <strong>{titleCase(r.entryType)}:</strong> {r.title} {r.details && <span className="muted">— {r.details}</span>}
                </li>
              ))}
            </ul>
            <h3>Prescriptions</h3>
            <ul className="rec-list">
              {bg.result.prescriptions.map((p) => (
                <li key={p.id}>
                  v{p.version} · {p.doctorName} · {p.finalizedAt ? fmtDateTime(p.finalizedAt) : ''} <StatusPill status={p.status} />
                </li>
              ))}
            </ul>
            <button className="btn btn-secondary" onClick={() => setBg(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface ApptRow {
  id: string;
  startsAt: string;
  status: string;
  mode: string;
  doctorName: string;
  patientCode: string;
}

export function AdminAppointments() {
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const { data, loading, error, reload } = useApi<{ appointments: ApptRow[] }>(`/admin/appointments?${qs}`);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const cancel = async (a: ApptRow) => {
    const reason = window.prompt('Reason for cancelling (both parties are notified):');
    if (!reason || reason.trim().length < 3) return;
    try {
      await api.post(`/admin/appointments/${a.id}/cancel`, { reason });
      setMsg({ kind: 'success', text: 'Appointment cancelled.' });
      void reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  };
  return (
    <>
      <header className="page-head">
        <h1>Appointments</h1>
        <p className="muted">Scheduling metadata only — reasons and clinical content are not shown.</p>
      </header>
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED'].map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.appointments.length ? (
        <Empty>No appointments.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Doctor</th>
                <th>Patient ID</th>
                <th>Mode</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.appointments.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.startsAt)}</td>
                  <td>{a.doctorName}</td>
                  <td className="mono">{a.patientCode}</td>
                  <td>{titleCase(a.mode)}</td>
                  <td>
                    <StatusPill status={a.status} />
                  </td>
                  <td>
                    {(a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && (
                      <button className="btn btn-small btn-secondary" onClick={() => void cancel(a)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} hasMore={(data?.appointments.length ?? 0) === 25} />
    </>
  );
}
