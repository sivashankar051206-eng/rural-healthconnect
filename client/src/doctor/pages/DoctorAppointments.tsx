import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { useDoctor } from '../../layouts/DoctorLayout';
import { fmtDateTime, fmtTime, titleCase, todayLocal } from '../../utils/format';

export interface DoctorAppt {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  startsAt: string;
  endsAt: string;
  mode: string;
  status: string;
  reason: string | null;
  consultationId: string | null;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status}`}>{titleCase(status)}</span>;
}

/** Row actions shared by dashboard and appointment list. */
function Actions({ a, onChange }: { a: DoctorAppt; onChange: () => void }) {
  const navigate = useNavigate();
  const { busy, run } = useSubmit();
  const [err, setErr] = useState('');
  const act = (path: string, body?: unknown, then?: (r: { consultation?: { id: string } }) => void) =>
    void run(async () => {
      setErr('');
      try {
        const r = await api.post<{ consultation?: { id: string } }>(`/doctor/appointments/${a.id}/${path}`, body ?? {});
        if (then) then(r);
        else onChange();
      } catch (e) {
        setErr(errorMessage(e));
      }
    });
  return (
    <div className="row-actions">
      {a.status === 'SCHEDULED' && (
        <>
          <button className="btn btn-small btn-primary" disabled={busy} onClick={() => act('accept')}>
            Accept
          </button>
          <button className="btn btn-small btn-secondary" disabled={busy} onClick={() => act('reject', { reason: null })}>
            Reject
          </button>
        </>
      )}
      {a.status === 'CONFIRMED' && (
        <>
          <button className="btn btn-small btn-primary" disabled={busy} onClick={() => act('start', undefined, (r) => r.consultation && navigate(`/doctor/consultations/${r.consultation.id}`))}>
            Start consultation
          </button>
          <button className="btn btn-small btn-secondary" disabled={busy} onClick={() => act('cancel', { reason: null })}>
            Cancel
          </button>
        </>
      )}
      {a.status === 'IN_PROGRESS' && a.consultationId && (
        <Link className="btn btn-small btn-primary" to={`/doctor/consultations/${a.consultationId}`}>
          Open consultation
        </Link>
      )}
      {['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status) && (
        <Link className="btn btn-small btn-ghost" to={`/doctor/patients/${a.patientId}`}>
          Chart
        </Link>
      )}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}

export function AppointmentTable({ rows, onChange, showDate }: { rows: DoctorAppt[]; onChange: () => void; showDate?: boolean }) {
  if (!rows.length) return <Empty>No appointments.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{showDate ? 'Date / time' : 'Time'}</th>
            <th>Patient</th>
            <th>Mode</th>
            <th>Reason</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{showDate ? fmtDateTime(a.startsAt) : fmtTime(a.startsAt)}</td>
              <td>
                {a.patientName}
                <div className="muted mono">{a.patientCode}</div>
              </td>
              <td>{titleCase(a.mode)}</td>
              <td className="clip">{a.reason ?? '—'}</td>
              <td>
                <StatusPill status={a.status} />
              </td>
              <td>
                <Actions a={a} onChange={onChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DoctorDashboard() {
  const doctor = useDoctor();
  const active = doctor?.verificationStatus === 'VERIFIED' && doctor.isActive;
  const { data, loading, error, reload } = useApi<{ counts: Record<string, number>; today: DoctorAppt[] }>(active ? '/doctor/dashboard' : null);

  return (
    <>
      <header className="page-head">
        <h1>Good day, {doctor?.fullName}</h1>
        <p className="muted">
          {doctor?.specialization} · {doctor?.qualification} {doctor?.facilityName ? `· ${doctor.facilityName}` : ''}
        </p>
      </header>
      {!active ? null : loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : data ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span>Today</span>
              <strong>{data.counts.today}</strong>
            </div>
            <div className="stat">
              <span>Awaiting your response</span>
              <strong>{data.counts.pending}</strong>
            </div>
            <div className="stat">
              <span>In progress</span>
              <strong>{data.counts.inProgress}</strong>
            </div>
            <div className="stat">
              <span>Patients under care</span>
              <strong>{data.counts.patients}</strong>
            </div>
          </div>
          <section className="panel">
            <div className="panel-head">
              <h2>Today · {todayLocal()}</h2>
              <Link to="/doctor/appointments?status=SCHEDULED">Pending requests →</Link>
            </div>
            <AppointmentTable rows={data.today} onChange={() => void reload()} />
          </section>
        </>
      ) : null}
    </>
  );
}

export function DoctorAppointments() {
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get('status') ?? '');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(status ? { status } : {}), ...(date ? { date } : {}) });
  const { data, loading, error, reload } = useApi<{ appointments: DoctorAppt[] }>(`/doctor/appointments?${qs}`);
  return (
    <>
      <header className="page-head">
        <h1>Appointments</h1>
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
          Date
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} />
        </label>
      </div>
      {loading && !data ? <Spinner /> : error ? <Alert>{errorMessage(error)}</Alert> : <AppointmentTable rows={data?.appointments ?? []} onChange={() => void reload()} showDate />}
      <Pager page={page} setPage={setPage} hasMore={(data?.appointments.length ?? 0) === 25} />
    </>
  );
}

export function Pager({ page, setPage, hasMore }: { page: number; setPage: (p: number) => void; hasMore: boolean }) {
  return (
    <div className="pager">
      <button className="btn btn-small btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        ← Previous
      </button>
      <span>Page {page}</span>
      <button className="btn btn-small btn-secondary" disabled={!hasMore} onClick={() => setPage(page + 1)}>
        Next →
      </button>
    </div>
  );
}
