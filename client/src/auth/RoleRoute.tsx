import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Role } from './AuthContext';
import { Spinner } from '../components/Feedback';

/**
 * UX-only route guard. Frontend route protection is NOT security:
 * the backend independently rejects any request the user is not authorized for.
 */
function RoleRoute({ role, loginPath }: { role: Role; loginPath: string }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <Spinner />;
  if (!user) return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const PatientRoute = () => <RoleRoute role="PATIENT" loginPath="/patient/login" />;
export const DoctorRoute = () => <RoleRoute role="DOCTOR" loginPath="/doctor/login" />;
export const AdminRoute = () => <RoleRoute role="ADMIN" loginPath="/admin/login" />;
