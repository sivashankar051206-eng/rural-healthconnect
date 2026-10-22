import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, type SessionUser } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { Alert, errorMessage } from '../../components/Feedback';
import { useSubmit } from '../../hooks/useApi';
import { PatientAuthShell } from './PatientAuthShell';

/** Deliberately short: required details on step 1, optional ones on step 2 (spec §28). */
export function PatientRegister() {
  const { t, lang } = useI18n();
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [f, setF] = useState({
    fullName: '',
    mobile: '',
    dateOfBirth: '',
    password: '',
    gender: '',
    village: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const next = (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!f.fullName.trim() || !f.mobile.trim() || !f.dateOfBirth || f.password.length < 8) {
      setErr(t('errors.VALIDATION_FAILED'));
      return;
    }
    setStep(2);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setErr('');
      try {
        const r = await api.post<{ user: SessionUser }>('/auth/patient/register', {
          fullName: f.fullName,
          mobile: f.mobile,
          password: f.password,
          dateOfBirth: f.dateOfBirth,
          preferredLanguage: lang,
          gender: f.gender || null,
          village: f.village || null,
          emergencyContactName: f.emergencyContactName || null,
          emergencyContactPhone: f.emergencyContactPhone || null,
        });
        setSession(r.user);
        navigate('/patient/dashboard', { replace: true, state: { firstVisit: true } });
      } catch (e2) {
        setErr(errorMessage(e2, t));
        setStep(1);
      }
    });
  };

  return (
    <PatientAuthShell title={t('register.title')}>
      <p className="muted">{step === 1 ? t('register.step1') : t('register.step2')}</p>
      {step === 1 ? (
        <form className="p-form" onSubmit={next} noValidate>
          <label htmlFor="fullName">{t('register.name')}</label>
          <input id="fullName" autoComplete="name" value={f.fullName} onChange={set('fullName')} maxLength={120} required />
          <label htmlFor="mobile">{t('login.mobile')}</label>
          <input id="mobile" type="tel" inputMode="numeric" autoComplete="tel" value={f.mobile} onChange={set('mobile')} required />
          <label htmlFor="dob">{t('register.dob')}</label>
          <input id="dob" type="date" value={f.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={set('dateOfBirth')} required />
          <label htmlFor="password">{t('login.password')}</label>
          <input id="password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} aria-describedby="pw-hint" required />
          <small id="pw-hint" className="hint">
            {t('register.passwordHint')}
          </small>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary btn-block">{t('common.next')}</button>
        </form>
      ) : (
        <form className="p-form" onSubmit={submit} noValidate>
          <fieldset className="choice-row">
            <legend>
              {t('register.gender')} {t('common.optional')}
            </legend>
            {(['FEMALE', 'MALE', 'OTHER'] as const).map((g) => (
              <label key={g} className={`choice ${f.gender === g ? 'active' : ''}`}>
                <input type="radio" name="gender" value={g} checked={f.gender === g} onChange={set('gender')} />
                {t(`register.${g.toLowerCase()}`)}
              </label>
            ))}
          </fieldset>
          <label htmlFor="village">
            {t('register.village')} {t('common.optional')}
          </label>
          <input id="village" value={f.village} onChange={set('village')} maxLength={120} />
          <label htmlFor="ecName">
            {t('register.emergencyName')} {t('common.optional')}
          </label>
          <input id="ecName" value={f.emergencyContactName} onChange={set('emergencyContactName')} maxLength={120} />
          <label htmlFor="ecPhone">
            {t('register.emergencyPhone')} {t('common.optional')}
          </label>
          <input id="ecPhone" type="tel" inputMode="numeric" value={f.emergencyContactPhone} onChange={set('emergencyContactPhone')} />
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('common.loading') : t('register.submit')}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setStep(1)}>
            {t('common.back')}
          </button>
        </form>
      )}
      <p className="p-links">
        <Link to="/patient/login">{t('register.haveAccount')}</Link>
      </p>
    </PatientAuthShell>
  );
}
