import { createContext, useContext, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../hooks/useApi';
import { NetworkBanner, Spinner } from '../components/Feedback';
import '../styles/staff.css';

export interface DoctorStatus {
  fullName: string;
  email: string | null;
  specialization: string;
  qualification: string;
  registrationNumber: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isActive: boolean;
  facilityName: string | null;
}
const DoctorCtx = createContext<DoctorStatus | null>(null);
export const useDoctor = () => useContext(DoctorCtx);

const NAV = [
  ['/doctor/dashboard', 'Dashboard'],
  ['/doctor/appointments', 'Appointments'],
  ['/doctor/patients', 'Patients'],
  ['/doctor/prescriptions', 'Prescriptions'],
  ['/doctor/availability', 'Availability'],
  ['/doctor/profile', 'Profile'],
] as const;

/** Professional, information-dense clinical shell (distinct from the patient app). */
export function DoctorLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useApi<{ doctor: DoctorStatus }>('/doctor/me');
  const active = data?.doctor.verificationStatus === 'VERIFIED' && data.doctor.isActive;

  return (
    <div className="staff-app doctor-theme">
      <aside className="staff-side">
        <div className="staff-brand">
          RHC <span>Clinician</span>
        </div>
        <nav aria-label="Doctor navigation">
          {NAV.filter(([to]) => active || to === '/doctor/dashboard' || to === '/doctor/profile').map(([to, label]) => (
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
              navigate('/doctor/login', { replace: true });
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
            <DoctorCtx.Provider value={data?.doctor ?? null}>
              {!active && data && <PendingNotice status={data.doctor} />}
              <Outlet />
            </DoctorCtx.Provider>
          )}
        </main>
      </div>
    </div>
  );
}

function PendingNotice({ status }: { status: DoctorStatus }): ReactNode {
  const text =
    status.verificationStatus === 'PENDING'
      ? 'Your registration is awaiting verification by an administrator. Clinical features will be enabled once verified.'
      : status.verificationStatus === 'REJECTED'
        ? 'Your registration was not approved. Please contact the platform administrator.'
        : 'Your account is currently deactivated. Please contact the platform administrator.';
  return (
    <div className="alert alert-warning" role="status">
      {text}
    </div>
  );
}
