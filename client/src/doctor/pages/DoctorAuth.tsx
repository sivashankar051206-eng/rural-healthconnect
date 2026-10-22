import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../services/api';
import { useSubmit } from '../../hooks/useApi';
import { Alert, errorMessage } from '../../components/Feedback';
import '../../styles/staff.css';

export function StaffAuthShell({ title, subtitle, theme, children }: { title: string; subtitle: string; theme: 'doctor' | 'admin'; children: ReactNode }) {
  return (
    <div className={`staff-auth ${theme}-theme`}>
      <main className="staff-auth-card">
        <div className="staff-brand">
          RHC <span>{theme === 'doctor' ? 'Clinician' : 'Administration'}</span>
        </div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </main>
    </div>
  );
}

export function DoctorLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        await login('doctor', email, password);
        navigate('/doctor/dashboard', { replace: true });
      } catch (e2) {
        setErr(errorMessage(e2));
      }
    });
  };
  return (
    <StaffAuthShell title="Doctor sign in" subtitle="Rural HealthConnect clinical portal" theme="doctor">
      <form className="staff-form" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="staff-links">
        <Link to="/doctor/register">Register as a doctor</Link> · <Link to="/doctor/forgot-password">Forgot password?</Link>
      </p>
    </StaffAuthShell>
  );
}

export function DoctorRegister() {
  const [f, setF] = useState({ fullName: '', email: '', mobile: '', password: '', registrationNumber: '', specialization: '', qualification: '' });
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        await api.post('/auth/doctor/register', { ...f, mobile: f.mobile || null });
        setDone(true);
      } catch (e2) {
        setErr(errorMessage(e2));
      }
    });
  };

  if (done) {
    return (
      <StaffAuthShell title="Registration received" subtitle="Verification required" theme="doctor">
        <Alert kind="success">
          Thank you. An administrator will verify your medical registration. You can sign in now, but clinical features stay disabled until your account is verified.
        </Alert>
        <Link className="btn btn-primary" to="/doctor/login">
          Go to sign in
        </Link>
      </StaffAuthShell>
    );
  }
  return (
    <StaffAuthShell title="Doctor registration" subtitle="Your details are reviewed before you receive clinical access." theme="doctor">
      <form className="staff-form" onSubmit={submit}>
        <label htmlFor="fullName">Full name</label>
        <input id="fullName" value={f.fullName} onChange={set('fullName')} required maxLength={120} />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={f.email} onChange={set('email')} required />
        <label htmlFor="mobile">Mobile (optional)</label>
        <input id="mobile" type="tel" value={f.mobile} onChange={set('mobile')} />
        <label htmlFor="reg">Medical council registration number</label>
        <input id="reg" value={f.registrationNumber} onChange={set('registrationNumber')} required maxLength={40} />
        <label htmlFor="spec">Specialization</label>
        <input id="spec" value={f.specialization} onChange={set('specialization')} required maxLength={80} placeholder="e.g. General Medicine" />
        <label htmlFor="qual">Qualification</label>
        <input id="qual" value={f.qualification} onChange={set('qualification')} required maxLength={120} placeholder="e.g. MBBS, MD" />
        <label htmlFor="pw">Password (min 12 characters, letters and numbers)</label>
        <input id="pw" type="password" autoComplete="new-password" minLength={12} value={f.password} onChange={set('password')} required />
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit for verification'}
        </button>
      </form>
      <p className="staff-links">
        <Link to="/doctor/login">Back to sign in</Link>
      </p>
    </StaffAuthShell>
  );
}
