import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, errorMessage, Spinner } from '../../components/Feedback';
import { StaffAuthShell } from '../../doctor/pages/DoctorAuth';

export function AdminLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        await login('admin', email, password, totp);
        navigate('/admin/dashboard', { replace: true });
      } catch (e2) {
        setErr(errorMessage(e2));
      }
    });
  };
  return (
    <StaffAuthShell title="Administrator sign in" subtitle="Multi-factor authentication is required. All activity is audited." theme="admin">
      <form className="staff-form" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label htmlFor="totp">Authenticator code</label>
        <input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} required />
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Verifying…' : 'Sign in'}
        </button>
      </form>
    </StaffAuthShell>
  );
}

interface Dashboard {
  stats: Record<string, number>;
  appointmentsByDay: { day: string; total: number }[];
}

const STAT_LABELS: [string, string][] = [
  ['patients', 'Registered patients'],
  ['activeDoctors', 'Active doctors'],
  ['pendingDoctors', 'Doctors awaiting verification'],
  ['appointmentsToday', 'Appointments today'],
  ['completed30d', 'Completed (30 days)'],
  ['cancelled30d', 'Cancelled (30 days)'],
  ['openIssues', 'Open issues'],
  ['activeSessions', 'Active sessions (15 min)'],
  ['failedLogins24h', 'Failed logins (24 h)'],
  ['deniedRequests24h', 'Denied requests (24 h)'],
];

export function AdminDashboard() {
  const { data, loading, error } = useApi<Dashboard>('/admin/dashboard');
  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert>{errorMessage(error)}</Alert>;
  const max = Math.max(1, ...data.appointmentsByDay.map((d) => d.total));
  return (
    <>
      <header className="page-head">
        <h1>Platform overview</h1>
        <p className="muted">Aggregate, non-clinical statistics.</p>
      </header>
      <div className="stat-grid">
        {STAT_LABELS.map(([k, label]) => (
          <div key={k} className={`stat ${/failed|denied/i.test(k) && data.stats[k] > 0 ? 'stat-warn' : ''}`}>
            <span>{label}</span>
            <strong>{data.stats[k] ?? 0}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <h2>Appointments per day (last 14 days)</h2>
        {data.appointmentsByDay.length ? (
          <div className="bar-chart" role="img" aria-label="Appointments per day bar chart">
            {data.appointmentsByDay.map((d) => (
              <div key={d.day} className="bar-col" title={`${d.day}: ${d.total}`}>
                <span className="bar-val">{d.total}</span>
                <div className="bar" style={{ height: `${(d.total / max) * 100}%` }} />
                <span className="bar-label">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No appointments in this period.</p>
        )}
      </section>
    </>
  );
}
