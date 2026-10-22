import { createContext, useContext, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../services/api';
import { useApi, useSubmit } from '../hooks/useApi';
import { Alert, errorMessage, NetworkBanner, Spinner } from '../components/Feedback';
import '../styles/staff.css';

const PermCtx = createContext<string[]>([]);
export const useAdminPermissions = () => useContext(PermCtx);

const NAV: [string, string, string | null][] = [
  ['/admin/dashboard', 'Dashboard', null],
  ['/admin/doctors', 'Doctors', 'admin.doctors.manage'],
  ['/admin/patients', 'Patients', 'admin.patients.manage'],
  ['/admin/appointments', 'Appointments', 'admin.appointments.manage'],
  ['/admin/facilities', 'Facilities', 'admin.facilities.manage'],
  ['/admin/issues', 'Reported issues', 'admin.issues.manage'],
  ['/admin/audit-logs', 'Audit logs', 'admin.audit.view'],
  ['/admin/settings', 'Settings', 'admin.settings.manage'],
  ['/admin/permissions', 'Roles & permissions', 'admin.permissions.manage'],
];

/** Management-focused shell. Menu items reflect permissions, but the API enforces them independently. */
export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useApi<{ permissions: string[] }>('/admin/me');
  const perms = data?.permissions ?? [];
  return (
    <div className="staff-app admin-theme">
      <aside className="staff-side">
        <div className="staff-brand">
          RHC <span>Administration</span>
        </div>
        <nav aria-label="Admin navigation">
          {NAV.filter(([, , p]) => !p || perms.includes(p)).map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="staff-user">
          <div>{user?.fullName}</div>
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              await logout();
              navigate('/admin/login', { replace: true });
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <div className="staff-body">
        <NetworkBanner weak="Internet connection is weak." offline="You are offline." />
        <main id="main" className="staff-main">
          {loading && !data ? (
            <Spinner />
          ) : (
            <PermCtx.Provider value={perms}>
              <Outlet />
            </PermCtx.Provider>
          )}
        </main>
      </div>
    </div>
  );
}

/** Re-authentication (password + TOTP) for highly sensitive admin actions. */
export function ReauthDialog({ onDone, onCancel, purpose }: { onDone: () => void; onCancel: () => void; purpose: string }) {
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        await api.post('/auth/reauth', { password, totp });
        onDone();
      } catch (e2) {
        setErr(errorMessage(e2));
      }
    });
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal staff-form" role="dialog" aria-modal="true" aria-label="Confirm your identity" onSubmit={submit}>
        <h2>Confirm your identity</h2>
        <p className="muted">{purpose}</p>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </label>
        <label>
          Authenticator code
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} required />
        </label>
        {err && <Alert>{err}</Alert>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>
            Confirm
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** Runs an action; if the API asks for re-authentication, shows the dialog and retries once. */
export function useReauthAction() {
  const [pending, setPending] = useState<{ fn: () => Promise<void>; purpose: string } | null>(null);
  const exec = async (fn: () => Promise<void>, purpose: string) => {
    try {
      await fn();
    } catch (e) {
      if ((e as { code?: string }).code === 'REAUTH_REQUIRED') setPending({ fn, purpose });
      else throw e;
    }
  };
  const dialog = pending ? (
    <ReauthDialog
      purpose={pending.purpose}
      onCancel={() => setPending(null)}
      onDone={() => {
        const p = pending;
        setPending(null);
        void p.fn();
      }}
    />
  ) : null;
  return { exec, dialog };
}
