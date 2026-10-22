import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { Alert, errorMessage } from '../../components/Feedback';
import { useSubmit } from '../../hooks/useApi';
import { PatientAuthShell } from './PatientAuthShell';
import { StaffAuthShell } from '../../doctor/pages/DoctorAuth';

/** Shared by patients (mobile) and doctors (email). Responses never reveal whether an account exists. */
export function ForgotPassword({ portal = 'patient' }: { portal?: 'patient' | 'doctor' }) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();

  const request = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        await api.post(`/auth/${portal}/password-reset/request`, { identifier });
        setSent(true);
      } catch (e2) {
        setErr(errorMessage(e2, t));
      }
    });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        await api.post(`/auth/${portal}/password-reset/confirm`, { identifier, code, newPassword: password });
        setDone(true);
      } catch (e2) {
        setErr(errorMessage(e2, t));
      }
    });
  };

  const loginPath = `/${portal}/login`;
  const content = done ? (
    <>
      <Alert kind="success">{t('reset.done')}</Alert>
      <Link className="btn btn-primary btn-block" to={loginPath}>
        {t('login.submit')}
      </Link>
    </>
  ) : !sent ? (
    <form className="p-form" onSubmit={request}>
      <label htmlFor="identifier">{portal === 'patient' ? t('login.mobile') : 'Email'}</label>
      <input id="identifier" type={portal === 'patient' ? 'tel' : 'email'} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {t('reset.sendCode')}
      </button>
    </form>
  ) : (
    <form className="p-form" onSubmit={confirm}>
      <Alert kind="info">{t('reset.codeSent')}</Alert>
      <label htmlFor="code">{t('reset.code')}</label>
      <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
      <label htmlFor="newpw">{t('reset.newPassword')}</label>
      <input id="newpw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <small className="hint">{t('register.passwordHint')}</small>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {t('reset.submit')}
      </button>
    </form>
  );

  const links = (
    <p className="p-links staff-links">
      <Link to={loginPath}>{t('common.back')}</Link>
    </p>
  );
  if (portal === 'doctor') {
    return (
      <StaffAuthShell title="Reset password" subtitle="A one-time code will be sent if the account exists." theme="doctor">
        <div className="staff-form">{content}</div>
        {links}
      </StaffAuthShell>
    );
  }
  return (
    <PatientAuthShell title={t('reset.title')}>
      {content}
      {links}
    </PatientAuthShell>
  );
}
