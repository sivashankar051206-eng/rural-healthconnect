import { useCallback, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { EmergencyDialog } from '../components/EmergencyDialog';
import { NetworkBanner } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { VoiceAssistant } from '../voice/VoiceAssistant';
import '../styles/patient.css';

/** Simple, friendly, mobile-first shell: big header, emergency button, voice, persistent help. */
export function PatientLayout() {
  const { t } = useI18n();
  const [emergency, setEmergency] = useState(false);
  const openEmergency = useCallback(() => setEmergency(true), []);
  const { pathname } = useLocation();
  const atHome = pathname === '/patient/dashboard';

  return (
    <div className="patient-app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="p-header">
        {atHome ? (
          <span className="p-brand">
            <Icon name="shield" /> {t('app.name')}
          </span>
        ) : (
          <Link to="/patient/dashboard" className="p-home-link">
            <Icon name="home" /> {t('common.home')}
          </Link>
        )}
        <button type="button" className="btn-emergency-small" onClick={openEmergency} aria-label={t('emergency.title')}>
          <Icon name="alert" /> {t('emergency.button')}
        </button>
      </header>
      <NetworkBanner weak={t('common.networkWeak')} offline={t('common.offline')} />
      <main id="main" className="p-main">
        <Outlet />
      </main>
      <nav className="p-bottom" aria-label="Main">
        <Link to="/patient/dashboard" aria-current={atHome ? 'page' : undefined}>
          <Icon name="home" />
          <span>{t('common.home')}</span>
        </Link>
        <Link to="/patient/help">
          <Icon name="help" />
          <span>{t('home.help')}</span>
        </Link>
        <Link to="/patient/profile">
          <Icon name="user" />
          <span>{t('home.profile')}</span>
        </Link>
      </nav>
      <VoiceAssistant onEmergency={openEmergency} />
      <EmergencyDialog
        open={emergency}
        onClose={() => setEmergency(false)}
        labels={{
          title: t('emergency.title'),
          text: t('emergency.text'),
          notReplacement: t('emergency.notReplacement'),
          call108: t('emergency.call108'),
          call112: t('emergency.call112'),
          close: t('common.close'),
        }}
      />
    </div>
  );
}
