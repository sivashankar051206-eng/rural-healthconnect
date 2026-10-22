import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AdminRoute, DoctorRoute, PatientRoute } from './auth/RoleRoute';
import { I18nProvider, useI18n } from './i18n/I18nProvider';
import { Spinner } from './components/Feedback';
import { Icon } from './components/Icon';

// Each role's app is a separate lazily-loaded bundle: patients never download doctor/admin code.
const P = {
  Layout: lazy(() => import('./layouts/PatientLayout').then((m) => ({ default: m.PatientLayout }))),
  Login: lazy(() => import('./patient/pages/PatientLogin').then((m) => ({ default: m.PatientLogin }))),
  Register: lazy(() => import('./patient/pages/PatientRegister').then((m) => ({ default: m.PatientRegister }))),
  Forgot: lazy(() => import('./patient/pages/ForgotPassword').then((m) => ({ default: () => <m.ForgotPassword portal="patient" /> }))),
  Dashboard: lazy(() => import('./patient/pages/PatientDashboard').then((m) => ({ default: m.PatientDashboard }))),
  Book: lazy(() => import('./patient/pages/BookAppointment').then((m) => ({ default: m.BookAppointment }))),
  Appointments: lazy(() => import('./patient/pages/MyAppointments').then((m) => ({ default: m.MyAppointments }))),
  Talk: lazy(() => import('./patient/pages/Consultation').then((m) => ({ default: m.TalkToDoctor }))),
  Room: lazy(() => import('./patient/pages/Consultation').then((m) => ({ default: m.ConsultationRoom }))),
  Records: lazy(() => import('./patient/pages/MyRecords').then((m) => ({ default: m.MyRecords }))),
  Medicines: lazy(() => import('./patient/pages/MyMedicines').then((m) => ({ default: m.MyMedicines }))),
  Medicine: lazy(() => import('./patient/pages/MyMedicines').then((m) => ({ default: m.MedicineView }))),
  Help: lazy(() => import('./patient/pages/Other').then((m) => ({ default: m.Help }))),
  Profile: lazy(() => import('./patient/pages/Other').then((m) => ({ default: m.PatientProfile }))),
  Messages: lazy(() => import('./patient/pages/Other').then((m) => ({ default: m.PatientMessages }))),
};
const D = {
  Layout: lazy(() => import('./layouts/DoctorLayout').then((m) => ({ default: m.DoctorLayout }))),
  Login: lazy(() => import('./doctor/pages/DoctorAuth').then((m) => ({ default: m.DoctorLogin }))),
  Register: lazy(() => import('./doctor/pages/DoctorAuth').then((m) => ({ default: m.DoctorRegister }))),
  Forgot: lazy(() => import('./patient/pages/ForgotPassword').then((m) => ({ default: () => <m.ForgotPassword portal="doctor" /> }))),
  Dashboard: lazy(() => import('./doctor/pages/DoctorAppointments').then((m) => ({ default: m.DoctorDashboard }))),
  Appointments: lazy(() => import('./doctor/pages/DoctorAppointments').then((m) => ({ default: m.DoctorAppointments }))),
  Patients: lazy(() => import('./doctor/pages/DoctorPatients').then((m) => ({ default: m.DoctorPatients }))),
  Chart: lazy(() => import('./doctor/pages/DoctorPatients').then((m) => ({ default: m.PatientChart }))),
  Consultation: lazy(() => import('./doctor/pages/DoctorConsultation').then((m) => ({ default: m.DoctorConsultation }))),
  Prescriptions: lazy(() => import('./doctor/pages/Prescriptions').then((m) => ({ default: m.DoctorPrescriptions }))),
  Editor: lazy(() => import('./doctor/pages/Prescriptions').then((m) => ({ default: m.PrescriptionEditor }))),
  Availability: lazy(() => import('./doctor/pages/DoctorSettings').then((m) => ({ default: m.Availability }))),
  Profile: lazy(() => import('./doctor/pages/DoctorSettings').then((m) => ({ default: m.DoctorProfile }))),
};
const A = {
  Layout: lazy(() => import('./layouts/AdminLayout').then((m) => ({ default: m.AdminLayout }))),
  Login: lazy(() => import('./admin/pages/AdminHome').then((m) => ({ default: m.AdminLogin }))),
  Dashboard: lazy(() => import('./admin/pages/AdminHome').then((m) => ({ default: m.AdminDashboard }))),
  Doctors: lazy(() => import('./admin/pages/AdminManage').then((m) => ({ default: m.AdminDoctors }))),
  Patients: lazy(() => import('./admin/pages/AdminManage').then((m) => ({ default: m.AdminPatients }))),
  Appointments: lazy(() => import('./admin/pages/AdminManage').then((m) => ({ default: m.AdminAppointments }))),
  Audit: lazy(() => import('./admin/pages/AdminSystem').then((m) => ({ default: m.AdminAuditLogs }))),
  Facilities: lazy(() => import('./admin/pages/AdminSystem').then((m) => ({ default: m.AdminFacilities }))),
  Issues: lazy(() => import('./admin/pages/AdminSystem').then((m) => ({ default: m.AdminIssues }))),
  Settings: lazy(() => import('./admin/pages/AdminSystem').then((m) => ({ default: m.AdminSettings }))),
  Permissions: lazy(() => import('./admin/pages/AdminSystem').then((m) => ({ default: m.AdminPermissions }))),
};

/** Logged-in users are sent to their own app; otherwise a simple chooser. */
function Landing() {
  const { user } = useAuth();
  const { t } = useI18n();
  if (user === undefined) return <Spinner />;
  if (user) return <Navigate to={`/${user.role.toLowerCase()}/dashboard`} replace />;
  return (
    <div className="landing">
      <div className="landing-card">
        <Icon name="shield" size={56} />
        <h1>{t('app.name')}</h1>
        <p>{t('app.tagline')}</p>
        <Link className="btn btn-primary btn-big" to="/patient/login">
          {t('landing.patient')}
        </Link>
        <Link className="landing-small" to="/doctor/login">
          {t('landing.doctor')}
        </Link>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="landing">
      <div className="landing-card">
        <h1>404</h1>
        <Link to="/">Home</Link>
      </div>
    </div>
  );
}

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<Spinner />}>{children}</Suspense>;

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <S>
            <Routes>
              <Route path="/" element={<Landing />} />

              {/* ---------------- Patient app ---------------- */}
              <Route path="/patient/login" element={<P.Login />} />
              <Route path="/patient/register" element={<P.Register />} />
              <Route path="/patient/forgot-password" element={<P.Forgot />} />
              <Route element={<PatientRoute />}>
                <Route element={<P.Layout />}>
                  <Route path="/patient/dashboard" element={<P.Dashboard />} />
                  <Route path="/patient/doctors" element={<P.Book />} />
                  <Route path="/patient/appointments" element={<P.Appointments />} />
                  <Route path="/patient/consultation" element={<P.Talk />} />
                  <Route path="/patient/consultation/:id" element={<P.Room />} />
                  <Route path="/patient/records" element={<P.Records />} />
                  <Route path="/patient/prescriptions" element={<P.Medicines />} />
                  <Route path="/patient/prescriptions/:id" element={<P.Medicine />} />
                  <Route path="/patient/help" element={<P.Help />} />
                  <Route path="/patient/profile" element={<P.Profile />} />
                  <Route path="/patient/messages" element={<P.Messages />} />
                </Route>
              </Route>

              {/* ---------------- Doctor app ---------------- */}
              <Route path="/doctor/login" element={<D.Login />} />
              <Route path="/doctor/register" element={<D.Register />} />
              <Route path="/doctor/forgot-password" element={<D.Forgot />} />
              <Route element={<DoctorRoute />}>
                <Route element={<D.Layout />}>
                  <Route path="/doctor/dashboard" element={<D.Dashboard />} />
                  <Route path="/doctor/appointments" element={<D.Appointments />} />
                  <Route path="/doctor/patients" element={<D.Patients />} />
                  <Route path="/doctor/patients/:patientId" element={<D.Chart />} />
                  <Route path="/doctor/consultations/:id" element={<D.Consultation />} />
                  <Route path="/doctor/prescriptions" element={<D.Prescriptions />} />
                  <Route path="/doctor/prescriptions/new" element={<D.Editor />} />
                  <Route path="/doctor/prescriptions/:id" element={<D.Editor />} />
                  <Route path="/doctor/availability" element={<D.Availability />} />
                  <Route path="/doctor/profile" element={<D.Profile />} />
                </Route>
              </Route>

              {/* ---------------- Admin app ---------------- */}
              <Route path="/admin/login" element={<A.Login />} />
              <Route element={<AdminRoute />}>
                <Route element={<A.Layout />}>
                  <Route path="/admin/dashboard" element={<A.Dashboard />} />
                  <Route path="/admin/doctors" element={<A.Doctors />} />
                  <Route path="/admin/patients" element={<A.Patients />} />
                  <Route path="/admin/appointments" element={<A.Appointments />} />
                  <Route path="/admin/audit-logs" element={<A.Audit />} />
                  <Route path="/admin/facilities" element={<A.Facilities />} />
                  <Route path="/admin/issues" element={<A.Issues />} />
                  <Route path="/admin/settings" element={<A.Settings />} />
                  <Route path="/admin/permissions" element={<A.Permissions />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </S>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
