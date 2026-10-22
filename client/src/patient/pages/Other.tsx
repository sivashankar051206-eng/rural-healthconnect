import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { LANGUAGES, useI18n, type Lang } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { SessionsPanel } from '../../components/SessionsPanel';
import { Icon } from '../../components/Icon';
import { speak } from '../../voice/speech';

export function Help() {
  const { t, speechLocale } = useI18n();
  const [category, setCategory] = useState('TECHNICAL');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { busy, run } = useSubmit();
  const tips = [t('help.voice'), t('help.book'), t('help.medicines'), t('help.notDoctor')];

  const send = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        await api.post('/issues', { category, description: text });
        setText('');
        setMsg({ kind: 'success', text: t('help.reportSent') });
      } catch (e2) {
        setMsg({ kind: 'error', text: errorMessage(e2, t) });
      }
    });
  };

  return (
    <section>
      <h1 className="p-title">{t('help.title')}</h1>
      <ul className="help-tips">
        {tips.map((tip) => (
          <li key={tip}>
            <span>{tip}</span>
            <button type="button" className="icon-btn" aria-label={`${t('voice.button')}: ${tip}`} onClick={() => void speak(tip, speechLocale)}>
              <Icon name="mic" />
            </button>
          </li>
        ))}
      </ul>
      <div className="card emergency-card">
        <h2>
          <Icon name="alert" /> {t('emergency.title')}
        </h2>
        <p>{t('emergency.text')}</p>
        <a className="btn btn-emergency" href="tel:108">
          <Icon name="phone" /> {t('emergency.call108')}
        </a>
        <p className="muted">{t('emergency.notReplacement')}</p>
      </div>
      <form className="card p-form" onSubmit={send}>
        <h2>{t('help.report')}</h2>
        <label htmlFor="cat">{t('help.category')}</label>
        <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {['TECHNICAL', 'ACCOUNT', 'APPOINTMENT', 'OTHER'].map((c) => (
            <option key={c} value={c}>
              {t(`help.cat${c}`)}
            </option>
          ))}
        </select>
        <label htmlFor="desc" className="sr-only">
          {t('help.reportPlaceholder')}
        </label>
        <textarea id="desc" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('help.reportPlaceholder')} required minLength={3} />
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {t('consult.send')}
        </button>
      </form>
    </section>
  );
}

interface Profile {
  patientCode: string;
  fullName: string;
  mobile: string | null;
  preferredLanguage: string;
}

export function PatientProfile() {
  const { t, lang, setLang, formatDateTime } = useI18n();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useApi<{ profile: Profile }>('/patient/profile');
  const [saved, setSaved] = useState(false);

  const changeLang = async (l: Lang) => {
    setLang(l);
    setSaved(false);
    try {
      await api.patch('/patient/profile', { preferredLanguage: l });
      setSaved(true);
    } catch {
      /* UI language still changes locally */
    }
  };

  return (
    <section>
      <h1 className="p-title">{t('profile.title')}</h1>
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <div className="card">
          <p className="big">{data.profile.fullName}</p>
          <p>
            {t('profile.patientId')}: <code>{data.profile.patientCode}</code>
          </p>
          <p>{data.profile.mobile}</p>
        </div>
      ) : null}
      <fieldset className="card lang-picker">
        <legend>{t('profile.language')}</legend>
        <div className="lang-grid">
          {LANGUAGES.map((l) => (
            <button key={l.code} type="button" lang={l.code} className={`lang-btn ${lang === l.code ? 'active' : ''}`} aria-pressed={lang === l.code} onClick={() => void changeLang(l.code)}>
              {l.name}
            </button>
          ))}
        </div>
        {saved && <Alert kind="success">{t('common.saved')}</Alert>}
      </fieldset>
      <SessionsPanel
        formatDateTime={formatDateTime}
        labels={{ title: t('profile.sessions'), thisDevice: t('profile.thisDevice'), logout: t('profile.logoutDevice'), lastUsed: (time) => t('profile.lastUsed', { time }) }}
      />
      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={async () => {
          await logout();
          navigate('/patient/login', { replace: true });
        }}
      >
        {t('common.logout')}
      </button>
    </section>
  );
}

interface Notification {
  id: string;
  type: string;
  params: Record<string, string>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function PatientMessages() {
  const { t, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const { data, loading, reload } = useApi<{ notifications: Notification[]; unread: number }>('/notifications?pageSize=30');
  const markAll = async () => {
    await api.post('/notifications/read-all');
    void reload();
  };
  const open = async (n: Notification) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    if (n.link?.startsWith('/patient/')) navigate(n.link);
    else void reload();
  };
  return (
    <section>
      <h1 className="p-title">{t('notif.title')}</h1>
      {loading && !data ? (
        <Spinner />
      ) : !data?.notifications.length ? (
        <Empty>{t('notif.none')}</Empty>
      ) : (
        <>
          {data.unread > 0 && (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => void markAll()}>
              {t('notif.markRead')}
            </button>
          )}
          <ul className="notif-list">
            {data.notifications.map((n) => (
              <li key={n.id}>
                <button type="button" className={`notif ${n.readAt ? '' : 'unread'}`} onClick={() => void open(n)}>
                  <span>{t(`notif.${n.type}`)}</span>
                  <span className="muted">{formatDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
