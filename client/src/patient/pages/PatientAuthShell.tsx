import type { ReactNode } from 'react';
import { LANGUAGES, useI18n, type Lang } from '../../i18n/I18nProvider';
import { NetworkBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import '../../styles/patient.css';

/** Pre-login shell: language is chosen FIRST so every following screen is in the user's language. */
export function PatientAuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="patient-app auth">
      <header className="p-header">
        <span className="p-brand">
          <Icon name="shield" /> {t('app.name')}
        </span>
      </header>
      <NetworkBanner weak={t('common.networkWeak')} offline={t('common.offline')} />
      <main id="main" className="p-main">
        <fieldset className="lang-picker">
          <legend>{t('lang.choose')}</legend>
          <div className="lang-grid">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                lang={l.code}
                className={`lang-btn ${lang === l.code ? 'active' : ''}`}
                aria-pressed={lang === l.code}
                onClick={() => setLang(l.code as Lang)}
              >
                {l.name}
              </button>
            ))}
          </div>
        </fieldset>
        <h1 className="p-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
