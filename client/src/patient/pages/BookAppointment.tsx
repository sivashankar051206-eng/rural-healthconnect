import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { api, newIdempotencyKey } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';

interface Doctor {
  id: string;
  fullName: string;
  specialization: string;
  qualification: string;
  facilityName: string | null;
  district: string | null;
}
interface Slot {
  startsAt: string;
  endsAt: string;
}

function localDateOffset(days: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + days * 86_400_000));
}

/** Doctor → day → time → confirm. Each step is one screen with big tap targets. */
export function BookAppointment() {
  const { t, formatDate, formatTime, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [mode, setMode] = useState<'VIDEO' | 'AUDIO' | 'CHAT'>('VIDEO');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  // One idempotency key per confirmation screen: retries on a weak network never double-book.
  const idemKey = useMemo(() => newIdempotencyKey(), [slot]); // eslint-disable-line react-hooks/exhaustive-deps

  const doctors = useApi<{ doctors: Doctor[] }>(`/patient/doctors?pageSize=20${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  const slots = useApi<{ slots: Slot[] }>(doctor && day ? `/patient/doctors/${doctor.id}/slots?date=${day}` : null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => localDateOffset(i)), []);

  const book = () =>
    void run(async () => {
      if (!doctor || !slot) return;
      setErr('');
      try {
        await api.post('/patient/appointments', { doctorId: doctor.id, startsAt: slot.startsAt, mode, reason: reason || null }, { 'Idempotency-Key': idemKey });
        navigate('/patient/appointments', { state: { booked: true } });
      } catch (e) {
        setErr(errorMessage(e, t));
        if ((e as { code?: string }).code === 'SLOT_UNAVAILABLE') {
          setSlot(null);
          void slots.reload();
        }
      }
    });

  // Step 4: confirm
  if (doctor && day && slot) {
    return (
      <section>
        <h1 className="p-title">{t('book.confirmTitle')}</h1>
        <div className="card confirm-card">
          <p className="big">{t('book.confirmText', { doctor: doctor.fullName, time: formatDateTime(slot.startsAt) })}</p>
          <fieldset className="choice-row">
            <legend>{t('book.mode')}</legend>
            {(['VIDEO', 'AUDIO', 'CHAT'] as const).map((m) => (
              <label key={m} className={`choice ${mode === m ? 'active' : ''}`}>
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                {t(`book.mode${m.charAt(0) + m.slice(1).toLowerCase()}`)}
              </label>
            ))}
          </fieldset>
          <label htmlFor="reason">{t('book.reason')}</label>
          <textarea id="reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {err && <Alert>{err}</Alert>}
        <button type="button" className="btn btn-primary btn-block btn-big" onClick={book} disabled={busy}>
          <Icon name="check" /> {busy ? t('common.loading') : t('book.submit')}
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setSlot(null)}>
          {t('common.back')}
        </button>
      </section>
    );
  }

  // Step 2/3: day + time
  if (doctor) {
    return (
      <section>
        <h1 className="p-title">{doctor.fullName}</h1>
        <p className="muted">{doctor.specialization}</p>
        <h2>{t('book.chooseDate')}</h2>
        <div className="day-row" role="radiogroup" aria-label={t('book.chooseDate')}>
          {days.map((d, i) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={day === d}
              className={`day-btn ${day === d ? 'active' : ''}`}
              onClick={() => {
                setDay(d);
                setErr('');
              }}
            >
              {i === 0 ? t('book.today') : i === 1 ? t('book.tomorrow') : formatDate(`${d}T12:00:00+05:30`)}
            </button>
          ))}
        </div>
        {day && (
          <>
            <h2>{t('book.chooseTime')}</h2>
            {slots.loading ? (
              <Spinner label={t('common.loading')} />
            ) : slots.data?.slots.length ? (
              <div className="slot-grid">
                {slots.data.slots.map((s) => (
                  <button key={s.startsAt} type="button" className="slot-btn" onClick={() => setSlot(s)}>
                    {formatTime(s.startsAt)}
                  </button>
                ))}
              </div>
            ) : (
              <Empty>{t('book.noSlots')}</Empty>
            )}
          </>
        )}
        {err && <Alert>{err}</Alert>}
        <button type="button" className="btn btn-secondary btn-block" onClick={() => { setDoctor(null); setDay(null); }}>
          {t('common.back')}
        </button>
      </section>
    );
  }

  // Step 1: choose doctor
  return (
    <section>
      <h1 className="p-title">{t('book.title')}</h1>
      <form
        className="search-row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <label htmlFor="q" className="sr-only">
          {t('book.search')}
        </label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('book.search')} maxLength={80} />
        <button className="btn btn-primary">{t('common.next')}</button>
      </form>
      <h2>{t('book.chooseDoctor')}</h2>
      {doctors.loading ? (
        <Spinner label={t('common.loading')} />
      ) : doctors.error ? (
        <Alert>{errorMessage(doctors.error, t)}</Alert>
      ) : doctors.data?.doctors.length ? (
        <ul className="doctor-list">
          {doctors.data.doctors.map((d) => (
            <li key={d.id}>
              <button type="button" className="doctor-card" onClick={() => setDoctor(d)}>
                <Icon name="doctor" size={36} />
                <span>
                  <strong>{d.fullName}</strong>
                  <span className="muted">
                    {d.specialization} · {d.qualification}
                  </span>
                  {d.facilityName && <span className="muted">{[d.facilityName, d.district].filter(Boolean).join(', ')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('book.noDoctors')}</Empty>
      )}
    </section>
  );
}
