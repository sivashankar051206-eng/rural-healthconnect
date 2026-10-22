import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import { useApi } from '../../hooks/useApi';
import { Icon, type IconName } from '../../components/Icon';
import { speak } from '../../voice/speech';

interface Appt {
  id: string;
  doctorName: string;
  startsAt: string;
  status: string;
  consultationId: string | null;
}

const TILES: { to: string; label: string; icon: IconName; tone: string }[] = [
  { to: '/patient/consultation', label: 'home.talkToDoctor', icon: 'doctor', tone: 'green' },
  { to: '/patient/doctors', label: 'home.book', icon: 'calendar', tone: 'blue' },
  { to: '/patient/records', label: 'home.records', icon: 'folder', tone: 'purple' },
  { to: '/patient/prescriptions', label: 'home.medicines', icon: 'pill', tone: 'orange' },
  { to: '/patient/appointments', label: 'home.appointments', icon: 'clock', tone: 'teal' },
  { to: '/patient/help', label: 'home.help', icon: 'help', tone: 'grey' },
];

/** Six large actions, a greeting, and at most one status line. Everything reachable without typing. */
export function PatientDashboard() {
  const { t, speechLocale, formatDateTime } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const firstVisit = Boolean((location.state as { firstVisit?: boolean } | null)?.firstVisit);
  const { data } = useApi<{ appointments: Appt[] }>('/patient/appointments?scope=upcoming&pageSize=3');
  const notif = useApi<{ unread: number }>('/notifications?pageSize=1');
  const live = data?.appointments.find((a) => a.status === 'IN_PROGRESS' && a.consultationId);
  const next = data?.appointments[0];

  useEffect(() => {
    // Spoken welcome on first visit only (guidance, spec §56).
    if (firstVisit) void speak(t('home.welcome'), speechLocale);
  }, [firstVisit, speechLocale, t]);

  return (
    <div className="p-dashboard">
      <h1 className="p-hello">{t('home.hello', { name: user?.fullName ?? '' })}</h1>
      {firstVisit && <p className="p-welcome">{t('home.welcome')}</p>}

      {live && (
        <Link className="join-banner" to={`/patient/consultation/${live.consultationId}`}>
          <Icon name="video" /> {t('talk.readyNow')}
        </Link>
      )}
      {!live && next && (
        <p className="next-appt">
          <Icon name="clock" size={20} /> {t('home.nextAppointment', { doctor: next.doctorName, time: formatDateTime(next.startsAt) })}
        </p>
      )}

      <nav className="tile-grid" aria-label={t('app.name')}>
        {TILES.map((tile) => (
          <Link key={tile.to} to={tile.to} className={`tile tile-${tile.tone}`}>
            <Icon name={tile.icon} size={44} />
            <span>{t(tile.label)}</span>
          </Link>
        ))}
      </nav>

      <Link to="/patient/messages" className="messages-link">
        <Icon name="bell" /> {t('home.messages')}
        {notif.data && notif.data.unread > 0 && <span className="count-badge">{notif.data.unread}</span>}
      </Link>
    </div>
  );
}
