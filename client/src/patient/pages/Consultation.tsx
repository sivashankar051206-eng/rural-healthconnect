import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { useApi, useVisiblePolling } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { ChatPanel } from '../../components/ChatPanel';
import { Icon } from '../../components/Icon';

interface Appt {
  id: string;
  doctorName: string;
  startsAt: string;
  status: string;
  consultationId: string | null;
}
interface Consultation {
  id: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  doctorName: string;
  mode: string;
  videoUrl: string | null;
}

/** "Talk to a Doctor": shows a Join button when the doctor has started, otherwise guides to booking. */
export function TalkToDoctor() {
  const { t, formatDateTime } = useI18n();
  const { data, loading, reload } = useApi<{ appointments: Appt[] }>('/patient/appointments?scope=upcoming&pageSize=5');
  useVisiblePolling(() => void reload(), 20_000);
  const live = data?.appointments.find((a) => a.status === 'IN_PROGRESS' && a.consultationId);
  const next = data?.appointments[0];

  return (
    <section>
      <h1 className="p-title">{t('talk.title')}</h1>
      {loading && !data ? (
        <Spinner label={t('common.loading')} />
      ) : live ? (
        <Link className="join-banner" to={`/patient/consultation/${live.consultationId}`}>
          <Icon name="video" /> {t('talk.readyNow')}
        </Link>
      ) : (
        <>
          <p className="p-welcome">{t('talk.intro')}</p>
          {next && (
            <div className="card">
              <h2>{t('talk.upcoming')}</h2>
              <p className="big">{formatDateTime(next.startsAt)}</p>
              <p>{t('appt.with', { doctor: next.doctorName })}</p>
              <p className={`status status-${next.status}`}>{t(`status.${next.status}`)}</p>
            </div>
          )}
          {!next && <Empty>{t('talk.noneReady')}</Empty>}
          <Link className="btn btn-primary btn-block btn-big" to="/patient/doctors">
            <Icon name="calendar" /> {t('talk.bookNew')}
          </Link>
        </>
      )}
    </section>
  );
}

export function ConsultationRoom() {
  const { id } = useParams();
  const { t, formatTime } = useI18n();
  const { data, error, loading, reload } = useApi<{ consultation: Consultation }>(id ? `/patient/consultations/${id}` : null);
  useVisiblePolling(() => void reload(), 15_000, data?.consultation.status === 'IN_PROGRESS');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error || !data) return <Alert>{errorMessage(error, t)}</Alert>;
  const c = data.consultation;
  const open = c.status === 'IN_PROGRESS';

  return (
    <section>
      <h1 className="p-title">{t('consult.title')}</h1>
      <p>{t('appt.with', { doctor: c.doctorName })}</p>
      {open && c.videoUrl && (
        <>
          <a className="btn btn-primary btn-block btn-big" href={c.videoUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="video" /> {t('consult.video')}
          </a>
          <p className="muted">{t('consult.videoNote')}</p>
        </>
      )}
      {!open && <Alert kind="info">{t('consult.ended')}</Alert>}
      <ChatPanel
        consultationId={c.id}
        open={open}
        formatTime={formatTime}
        t={t}
        labels={{ placeholder: t('consult.typeMessage'), send: t('consult.send'), you: t('consult.you'), other: t('consult.doctor'), ended: t('consult.ended') }}
      />
    </section>
  );
}
