import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';

interface Appt {
  id: string;
  doctorName: string;
  specialization: string;
  startsAt: string;
  status: string;
  mode: string;
  consultationId: string | null;
}

export function MyAppointments() {
  const { t, formatDateTime } = useI18n();
  const location = useLocation();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const { data, loading, error, reload } = useApi<{ appointments: Appt[] }>(`/patient/appointments?scope=${scope}&pageSize=20`);
  const [confirming, setConfirming] = useState<Appt | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    (location.state as { booked?: boolean } | null)?.booked ? { kind: 'success', text: t('book.success') } : null,
  );
  const { busy, run } = useSubmit();

  const cancel = (a: Appt) =>
    void run(async () => {
      try {
        await api.post(`/patient/appointments/${a.id}/cancel`, {});
        setMsg({ kind: 'success', text: t('appt.cancelled') });
        setConfirming(null);
        void reload();
      } catch (e) {
        setMsg({ kind: 'error', text: errorMessage(e, t) });
        setConfirming(null);
      }
    });

  return (
    <section>
      <h1 className="p-title">{t('appt.title')}</h1>
      <div className="tabs" role="tablist">
        {(['upcoming', 'past'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={scope === s} className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>
            {t(`appt.${s}`)}
          </button>
        ))}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {loading ? (
        <Spinner label={t('common.loading')} />
      ) : error ? (
        <Alert>{errorMessage(error, t)}</Alert>
      ) : !data?.appointments.length ? (
        <Empty>{t('appt.none')}</Empty>
      ) : (
        <ul className="appt-list">
          {data.appointments.map((a) => (
            <li key={a.id} className="card">
              <p className="big">{formatDateTime(a.startsAt)}</p>
              <p>{t('appt.with', { doctor: a.doctorName })}</p>
              <p className={`status status-${a.status}`}>{t(`status.${a.status}`)}</p>
              {a.status === 'IN_PROGRESS' && a.consultationId && (
                <Link className="btn btn-primary btn-block" to={`/patient/consultation/${a.consultationId}`}>
                  <Icon name="video" /> {t('appt.join')}
                </Link>
              )}
              {scope === 'upcoming' && (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && (
                confirming?.id === a.id ? (
                  <div className="confirm-box" role="alertdialog" aria-live="assertive">
                    <p>{t('appt.cancelConfirm', { doctor: a.doctorName, time: formatDateTime(a.startsAt) })}</p>
                    <div className="row">
                      <button type="button" className="btn btn-danger" onClick={() => cancel(a)} disabled={busy}>
                        {t('common.yes')}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)}>
                        {t('common.no')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-secondary btn-block" onClick={() => setConfirming(a)}>
                    {t('appt.cancel')}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
