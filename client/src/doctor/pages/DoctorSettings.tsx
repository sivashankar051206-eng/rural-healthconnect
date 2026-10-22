import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, errorMessage, Spinner } from '../../components/Feedback';
import { SessionsPanel } from '../../components/SessionsPanel';
import { useDoctor } from '../../layouts/DoctorLayout';
import { fmtDateTime, titleCase } from '../../utils/format';

interface Slot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function Availability() {
  const { data, loading, error } = useApi<{ slots: Slot[] }>('/doctor/availability');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { busy, run } = useSubmit();
  useEffect(() => {
    if (data) setSlots(data.slots);
  }, [data]);

  const update = (i: number, patch: Partial<Slot>) => setSlots(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const save = () =>
    void run(async () => {
      setMsg(null);
      try {
        const r = await api.put<{ slots: Slot[] }>('/doctor/availability', { slots });
        setSlots(r.slots);
        setMsg({ kind: 'success', text: 'Availability saved. Existing appointments are unchanged.' });
      } catch (e) {
        setMsg({ kind: 'error', text: errorMessage(e) });
      }
    });

  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;
  return (
    <>
      <header className="page-head">
        <h1>Weekly availability</h1>
        <p className="muted">Patients can book slots inside these windows (times in IST). Overlapping windows on the same day are rejected.</p>
      </header>
      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>From</th>
              <th>To</th>
              <th>Slot length</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {slots.map((s, i) => (
              <tr key={i}>
                <td>
                  <select value={s.dayOfWeek} onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })} aria-label="Day">
                    {DAYS.map((d, n) => (
                      <option key={d} value={n}>
                        {d}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="time" value={s.startTime} onChange={(e) => update(i, { startTime: e.target.value })} aria-label="From" />
                </td>
                <td>
                  <input type="time" value={s.endTime} onChange={(e) => update(i, { endTime: e.target.value })} aria-label="To" />
                </td>
                <td>
                  <select value={s.slotMinutes} onChange={(e) => update(i, { slotMinutes: Number(e.target.value) })} aria-label="Slot length">
                    {[10, 15, 20, 30, 45, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="link-btn" onClick={() => setSlots(slots.filter((_, idx) => idx !== i))} aria-label="Remove window">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className="btn btn-secondary btn-small" onClick={() => setSlots([...slots, { dayOfWeek: 1, startTime: '09:00', endTime: '13:00', slotMinutes: 15 }])}>
            + Add window
          </button>
          <button className="btn btn-primary btn-small" disabled={busy} onClick={save}>
            Save availability
          </button>
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </section>
    </>
  );
}

export function DoctorProfile() {
  const doctor = useDoctor();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <header className="page-head">
        <h1>Profile</h1>
      </header>
      {doctor && (
        <section className="panel">
          <dl className="kv">
            <dt>Name</dt>
            <dd>{doctor.fullName}</dd>
            <dt>Email</dt>
            <dd>{doctor.email}</dd>
            <dt>Registration no.</dt>
            <dd className="mono">{doctor.registrationNumber}</dd>
            <dt>Specialization</dt>
            <dd>{doctor.specialization}</dd>
            <dt>Qualification</dt>
            <dd>{doctor.qualification}</dd>
            <dt>Verification</dt>
            <dd>
              {titleCase(doctor.verificationStatus)} · {doctor.isActive ? 'Active' : 'Inactive'}
            </dd>
          </dl>
        </section>
      )}
      <SessionsPanel formatDateTime={fmtDateTime} labels={{ title: 'Active sessions', thisDevice: 'This device', logout: 'Revoke', lastUsed: (t) => `Last active ${t}` }} />
      <button
        className="btn btn-secondary"
        onClick={async () => {
          await logout();
          navigate('/doctor/login', { replace: true });
        }}
      >
        Log out
      </button>
    </>
  );
}
