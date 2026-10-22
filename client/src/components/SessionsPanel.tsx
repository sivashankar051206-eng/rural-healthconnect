import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Spinner } from './Feedback';

interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${browser}`;
}

/** Lets users see and revoke their active sessions (spec §48). */
export function SessionsPanel({
  labels,
  formatDateTime,
}: {
  labels: { title: string; thisDevice: string; logout: string; lastUsed: (time: string) => string };
  formatDateTime: (d: string) => string;
}) {
  const { data, loading, reload } = useApi<{ sessions: Session[] }>('/auth/sessions');
  const revoke = async (id: string) => {
    await api.del(`/auth/sessions/${id}`);
    void reload();
  };
  return (
    <section className="card">
      <h2>{labels.title}</h2>
      {loading && !data ? (
        <Spinner />
      ) : (
        <ul className="session-list">
          {data?.sessions.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{deviceName(s.userAgent)}</strong>
                {s.current && <span className="badge badge-ok">{labels.thisDevice}</span>}
                <div className="muted">{labels.lastUsed(formatDateTime(s.lastSeenAt))}</div>
              </div>
              {!s.current && (
                <button type="button" className="btn btn-small btn-secondary" onClick={() => void revoke(s.id)}>
                  {labels.logout}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
