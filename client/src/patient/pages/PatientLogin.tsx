import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n, type Lang } from '../../i18n/I18nProvider';
import { Alert, errorMessage } from '../../components/Feedback';
import { useSubmit } from '../../hooks/useApi';
import { PatientAuthShell } from './PatientAuthShell';

export function PatientLogin() {
  const { t, setLang } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        const u = await login('patient', mobile, password);
        setLang(u.language as Lang);
        navigate('/patient/dashboard', { replace: true });
      } catch (e2) {
        setErr(errorMessage(e2, t));
      }
    });
  };

  return (
    <PatientAuthShell title={t('login.title')}>
      <form className="p-form" onSubmit={submit} noValidate>
        <label htmlFor="mobile">{t('login.mobile')}</label>
        <input id="mobile" type="tel" inputMode="numeric" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
        <label htmlFor="password">{t('login.password')}</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t('common.loading') : t('login.submit')}
        </button>
      </form>
      <p className="p-links">
        <Link to="/patient/register">{t('login.noAccount')}</Link>
        <Link to="/patient/forgot-password">{t('login.forgot')}</Link>
      </p>
    </PatientAuthShell>
  );
}
