import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, onNetworkChange } from '../services/api';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Maps an API error to a user message; `t` lets the patient UI localize by error code. */
export function errorMessage(err: unknown, t?: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (t) {
      const key = `errors.${err.code}`;
      const translated = t(key);
      if (translated !== key) return translated;
      return err.status >= 500 || err.status === 0 ? t('common.error') : err.message;
    }
    return err.message;
  }
  return t ? t('common.error') : 'Something went wrong. Please try again.';
}

export function NetworkBanner({ weak, offline }: { weak: string; offline: string }) {
  const [state, setState] = useState<'ok' | 'weak' | 'offline'>('ok');
  useEffect(() => {
    const off = onNetworkChange(setState);
    return () => {
      off();
    };
  }, []);
  if (state === 'ok') return null;
  return (
    <div className={`net-banner net-${state}`} role="status" aria-live="polite">
      {state === 'offline' ? offline : weak}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
